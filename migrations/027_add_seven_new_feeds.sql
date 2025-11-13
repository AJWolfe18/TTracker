-- Migration 027: Add 7 New RSS Feeds (Tier 2 & 3)
-- Part of TTRC-264 - Feed expansion with paywalled sources
-- Adds Newsweek, The Atlantic, Reason, Fortune, Vox, Foreign Affairs, The New Yorker

-- Tier 2 Feeds (5 sources)
INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
VALUES
  -- Newsweek Politics
  ('https://www.newsweek.com/politics/rss', 'Newsweek Politics', 'Newsweek', ARRAY['politics','us'], 2, 2, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','Supreme Court','DOJ','federal'],
     'block', ARRAY['city council','mayor','state legislature','gubernatorial']
   )),

  -- The Atlantic Politics (PAYWALL)
  ('https://www.theatlantic.com/feed/channel/politics/', 'The Atlantic Politics', 'The Atlantic', ARRAY['politics'], 2, 2, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal policy'],
     'block', ARRAY['city council','local','state legislature']
   )),

  -- Reason Politics
  ('https://reason.com/tag/politics/feed/', 'Reason Politics', 'Reason', ARRAY['politics','policy'], 2, 2, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','federal','libertarian'],
     'block', ARRAY['city council','local government','state legislature']
   )),

  -- Fortune Politics (PAYWALL)
  ('https://fortune.com/politics/feed/', 'Fortune Politics', 'Fortune', ARRAY['politics','business'], 2, 2, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','federal policy','Treasury','SEC'],
     'block', ARRAY['city council','local business','state regulations']
   )),

  -- Vox Politics
  ('https://www.vox.com/politics/rss/index.xml', 'Vox Politics', 'Vox', ARRAY['politics','policy'], 2, 2, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal','policy explainer'],
     'block', ARRAY['city council','local','state legislature']
   ));

-- Tier 3 Feeds (2 sources)
INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
VALUES
  -- Foreign Affairs (PAYWALL)
  ('https://www.foreignaffairs.com/rss.xml', 'Foreign Affairs', 'Foreign Affairs', ARRAY['foreign-policy','world'], 3, 3, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','White House','State Department','Pentagon','foreign policy','diplomacy'],
     'block', ARRAY['city council','local','state department of']
   )),

  -- The New Yorker News/Politics (PAYWALL)
  ('https://www.newyorker.com/feed/news', 'The New Yorker Politics', 'The New Yorker', ARRAY['politics','culture'], 3, 3, true,
   jsonb_build_object(
     'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal'],
     'block', ARRAY['city council','local','NYC local','state legislature']
   ));

-- Add compliance rules for all 7 new feeds
-- Note: Paywalled sources get special note about excerpt-only access
DO $$
DECLARE
  v_feed_record RECORD;
BEGIN
  FOR v_feed_record IN
    SELECT id, feed_name,
           CASE
             WHEN feed_name IN ('The Atlantic Politics', 'Fortune Politics', 'Foreign Affairs', 'The New Yorker Politics')
             THEN 'PAYWALL - 5K char excerpt cap (RSS provides lead paragraphs only)'
             ELSE '5K char excerpt cap (aligns with scraper excerpt)'
           END AS note_text
    FROM feed_registry
    WHERE feed_name IN ('Newsweek Politics', 'The Atlantic Politics', 'Reason Politics',
                        'Fortune Politics', 'Vox Politics', 'Foreign Affairs', 'The New Yorker Politics')
  LOOP
    INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
    VALUES (v_feed_record.id, 5000, false, v_feed_record.feed_name, v_feed_record.note_text)
    ON CONFLICT (feed_id) DO UPDATE
      SET max_chars = EXCLUDED.max_chars,
          allow_full_text = EXCLUDED.allow_full_text,
          notes = EXCLUDED.notes;
  END LOOP;
END$$;

-- Verify all 7 feeds added successfully
DO $$
DECLARE
  v_new_feed_count INTEGER;
  v_total_active_count INTEGER;
BEGIN
  -- Count newly added feeds
  SELECT COUNT(*) INTO v_new_feed_count
  FROM feed_registry
  WHERE feed_name IN ('Newsweek Politics', 'The Atlantic Politics', 'Reason Politics',
                      'Fortune Politics', 'Vox Politics', 'Foreign Affairs', 'The New Yorker Politics');

  -- Count total active feeds
  SELECT COUNT(*) INTO v_total_active_count
  FROM feed_registry
  WHERE is_active = true;

  RAISE NOTICE 'Migration 027 complete: % new feeds added', v_new_feed_count;
  RAISE NOTICE 'Total active feeds: %', v_total_active_count;

  IF v_new_feed_count < 7 THEN
    RAISE WARNING 'Expected 7 new feeds, found %', v_new_feed_count;
  END IF;

  IF v_total_active_count < 18 THEN
    RAISE WARNING 'Expected 18 total active feeds, found %', v_total_active_count;
  END IF;
END$$;

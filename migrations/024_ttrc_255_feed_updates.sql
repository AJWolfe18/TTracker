-- TTRC-255: Feed Updates (Guardian, Politico, BBC) + Filter Rules + 5K Excerpt Policy
-- Production-hardened with schema resilience and duplicate guards
-- Safe to re-run. Target: TEST first.

-- ==============================
-- Phase 0: Preconditions / Safety
-- ==============================

-- Add filter_config column if needed
ALTER TABLE feed_registry
  ADD COLUMN IF NOT EXISTS filter_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Safe unique constraint with duplicate check (FIX #3)
DO $$
BEGIN
  IF EXISTS (
    SELECT feed_url FROM feed_registry
    GROUP BY feed_url HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Skipped uq_feed_registry_feed_url: duplicates present. Run manual deduplication first.';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_feed_registry_feed_url'
    ) THEN
      ALTER TABLE feed_registry ADD CONSTRAINT uq_feed_registry_feed_url UNIQUE (feed_url);
      RAISE NOTICE 'Added unique constraint: uq_feed_registry_feed_url';
    END IF;
  END IF;
END$$;

-- Add compliance constraints if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_feed_compliance_rules_feed') THEN
    ALTER TABLE feed_compliance_rules ADD CONSTRAINT uq_feed_compliance_rules_feed UNIQUE (feed_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_feed_compliance_rules_feed') THEN
    ALTER TABLE feed_compliance_rules ADD CONSTRAINT fk_feed_compliance_rules_feed
      FOREIGN KEY (feed_id) REFERENCES feed_registry(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Disable BBC Politics (URL pattern primary, topics as helper - FIX #5)
UPDATE feed_registry
SET is_active = FALSE
WHERE is_active = TRUE
  AND (
    feed_url LIKE '%feeds.bbci.co.uk/news/politics%'
    OR feed_name ILIKE '%BBC%Politics%'
  );

-- Disable old Guardian UK feed (URL pattern specific - FIX #5)
UPDATE feed_registry
SET is_active = FALSE
WHERE is_active = TRUE
  AND feed_url = 'https://www.theguardian.com/politics/rss';

-- ===================================================
-- Phase 1: Guardian US Politics (US-only replacement)
-- ===================================================
DO $$
DECLARE
  v_feed_id BIGINT;
  v_has_max_excerpt boolean;
  v_has_source_tier boolean;  -- FIX #2
  v_insert_sql text;
BEGIN
  -- Feature detect optional columns (FIX #2)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='source_tier'
  ) INTO v_has_source_tier;

  -- Build dynamic INSERT based on available columns
  IF v_has_source_tier THEN
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
      VALUES (
        'https://www.theguardian.com/us-news/us-politics/rss',
        'Guardian US Politics',
        'The Guardian',
        ARRAY['politics','us'],
        1, 1, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/us-news/','/politics/','/donaldtrump','/trump'],
          'disallowedUrlIncludes', ARRAY['/uk-news/','/live/','/opinion/','/podcast/','/video/','/culture/'],
          'allow', ARRAY['Congress','Senate','House','White House','Supreme Court','SCOTUS','executive order',
                         'DOJ','FBI','CIA','NSA','DHS','ICE','CBP','DOD','Pentagon','Treasury','State Department',
                         'ATF','DEA','federal','federal court','5th Circuit','DC Circuit'],
          'block', ARRAY['city council','school board','borough','county commission','mayor','mayoral',
                         'gubernatorial','state legislature','town meeting']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET feed_name = EXCLUDED.feed_name,
            source_name = EXCLUDED.source_name,
            topics = EXCLUDED.topics,
            tier = EXCLUDED.tier,
            source_tier = EXCLUDED.source_tier,
            is_active = TRUE,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  ELSE
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, is_active, filter_config)
      VALUES (
        'https://www.theguardian.com/us-news/us-politics/rss',
        'Guardian US Politics',
        'The Guardian',
        ARRAY['politics','us'],
        1, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/us-news/','/politics/','/donaldtrump','/trump'],
          'disallowedUrlIncludes', ARRAY['/uk-news/','/live/','/opinion/','/podcast/','/video/','/culture/'],
          'allow', ARRAY['Congress','Senate','House','White House','Supreme Court','SCOTUS','executive order',
                         'DOJ','FBI','CIA','NSA','DHS','ICE','CBP','DOD','Pentagon','Treasury','State Department',
                         'ATF','DEA','federal','federal court','5th Circuit','DC Circuit'],
          'block', ARRAY['city council','school board','borough','county commission','mayor','mayoral',
                         'gubernatorial','state legislature','town meeting']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET feed_name = EXCLUDED.feed_name,
            source_name = EXCLUDED.source_name,
            topics = EXCLUDED.topics,
            tier = EXCLUDED.tier,
            is_active = TRUE,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  END IF;

  -- Execute dynamic INSERT
  EXECUTE v_insert_sql INTO v_feed_id;

  -- Compliance rule with auto-detect
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_compliance_rules' AND column_name='max_excerpt_chars'
  ) INTO v_has_max_excerpt;

  IF v_has_max_excerpt THEN
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_excerpt_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'The Guardian', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_excerpt_chars = EXCLUDED.max_excerpt_chars,
            allow_full_text   = EXCLUDED.allow_full_text,
            source_name       = EXCLUDED.source_name,
            notes             = EXCLUDED.notes
    $q$, v_feed_id);
  ELSE
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'The Guardian', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_chars       = EXCLUDED.max_chars,
            allow_full_text = EXCLUDED.allow_full_text,
            source_name     = EXCLUDED.source_name,
            notes           = EXCLUDED.notes
    $q$, v_feed_id);
  END IF;

  RAISE NOTICE '✅ Guardian US Politics feed_id: %', v_feed_id;  -- FIX #6
END$$;

-- ==================================
-- Phase 2: Guardian Trump (NEW feed)
-- ==================================
DO $$
DECLARE
  v_feed_id BIGINT;
  v_has_max_excerpt boolean;
  v_has_source_tier boolean;
  v_insert_sql text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='source_tier'
  ) INTO v_has_source_tier;

  IF v_has_source_tier THEN
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
      VALUES (
        'https://www.theguardian.com/us-news/donaldtrump/rss',
        'Guardian Trump',
        'The Guardian',
        ARRAY['politics','trump'],
        1, 1, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/donaldtrump','/trump'],
          'allow', ARRAY['Congress','White House','DOJ','Supreme Court','federal'],
          'block', ARRAY['city council','mayor','state legislature']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET is_active = TRUE,
            feed_name = EXCLUDED.feed_name,
            topics    = EXCLUDED.topics,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  ELSE
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, is_active, filter_config)
      VALUES (
        'https://www.theguardian.com/us-news/donaldtrump/rss',
        'Guardian Trump',
        'The Guardian',
        ARRAY['politics','trump'],
        1, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/donaldtrump','/trump'],
          'allow', ARRAY['Congress','White House','DOJ','Supreme Court','federal'],
          'block', ARRAY['city council','mayor','state legislature']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET is_active = TRUE,
            feed_name = EXCLUDED.feed_name,
            topics    = EXCLUDED.topics,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  END IF;

  EXECUTE v_insert_sql INTO v_feed_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_compliance_rules' AND column_name='max_excerpt_chars'
  ) INTO v_has_max_excerpt;

  IF v_has_max_excerpt THEN
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_excerpt_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'The Guardian', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_excerpt_chars = EXCLUDED.max_excerpt_chars,
            allow_full_text   = EXCLUDED.allow_full_text,
            source_name       = EXCLUDED.source_name,
            notes             = EXCLUDED.notes
    $q$, v_feed_id);
  ELSE
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'The Guardian', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_chars       = EXCLUDED.max_chars,
            allow_full_text = EXCLUDED.allow_full_text,
            source_name     = EXCLUDED.source_name,
            notes           = EXCLUDED.notes
    $q$, v_feed_id);
  END IF;

  RAISE NOTICE '✅ Guardian Trump feed_id: %', v_feed_id;
END$$;

-- ==================================
-- Phase 3: Politico Trump (NEW feed)
-- ==================================
DO $$
DECLARE
  v_feed_id BIGINT;
  v_has_max_excerpt boolean;
  v_has_source_tier boolean;
  v_insert_sql text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='source_tier'
  ) INTO v_has_source_tier;

  IF v_has_source_tier THEN
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
      VALUES (
        'https://rss.politico.com/donald-trump.xml',
        'Politico Trump',
        'Politico',
        ARRAY['politics','trump'],
        1, 2, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/trump','/white-house','/congress','/elections'],
          'disallowedUrlIncludes', ARRAY['/local/','/opinion/','/podcast/','/video/'],
          'allow', ARRAY['Congress','White House','Supreme Court','SCOTUS','executive order','DOJ','DHS','federal'],
          'block', ARRAY['city council','county','mayor','state legislature','gubernatorial']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET is_active = TRUE,
            feed_name = EXCLUDED.feed_name,
            topics    = EXCLUDED.topics,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  ELSE
    v_insert_sql := $sql$
      INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, is_active, filter_config)
      VALUES (
        'https://rss.politico.com/donald-trump.xml',
        'Politico Trump',
        'Politico',
        ARRAY['politics','trump'],
        1, TRUE,
        jsonb_build_object(
          'requiredUrlIncludes', ARRAY['/trump','/white-house','/congress','/elections'],
          'disallowedUrlIncludes', ARRAY['/local/','/opinion/','/podcast/','/video/'],
          'allow', ARRAY['Congress','White House','Supreme Court','SCOTUS','executive order','DOJ','DHS','federal'],
          'block', ARRAY['city council','county','mayor','state legislature','gubernatorial']
        )
      )
      ON CONFLICT (feed_url) DO UPDATE
        SET is_active = TRUE,
            feed_name = EXCLUDED.feed_name,
            topics    = EXCLUDED.topics,
            filter_config = EXCLUDED.filter_config
      RETURNING id
    $sql$;
  END IF;

  EXECUTE v_insert_sql INTO v_feed_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_compliance_rules' AND column_name='max_excerpt_chars'
  ) INTO v_has_max_excerpt;

  IF v_has_max_excerpt THEN
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_excerpt_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'Politico', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_excerpt_chars = EXCLUDED.max_excerpt_chars,
            allow_full_text   = EXCLUDED.allow_full_text,
            source_name       = EXCLUDED.source_name,
            notes             = EXCLUDED.notes
    $q$, v_feed_id);
  ELSE
    EXECUTE format($q$
      INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
      VALUES (%s, 5000, FALSE, 'Politico', '5K char excerpt cap (aligns with scraper excerpt)')
      ON CONFLICT (feed_id) DO UPDATE
        SET max_chars       = EXCLUDED.max_chars,
            allow_full_text = EXCLUDED.allow_full_text,
            source_name     = EXCLUDED.source_name,
            notes           = EXCLUDED.notes
    $q$, v_feed_id);
  END IF;

  RAISE NOTICE '✅ Politico Trump feed_id: %', v_feed_id;
END$$;

-- =========================
-- Phase 4: Verification Queries
-- =========================
-- Feeds present / status
SELECT id, feed_name, feed_url, is_active, topics, tier
FROM feed_registry
WHERE feed_name IN ('Guardian US Politics','Guardian Trump','Politico Trump')
   OR (source_name = 'BBC' AND feed_url LIKE '%politics%')
   OR feed_url = 'https://www.theguardian.com/politics/rss'
ORDER BY is_active DESC, feed_name;

-- Compliance rows OK?
SELECT fr.feed_name, fcr.feed_id, fcr.max_chars, fcr.allow_full_text, fcr.source_name, fcr.notes
FROM feed_registry fr
JOIN feed_compliance_rules fcr ON fcr.feed_id = fr.id
WHERE fr.feed_name IN ('Guardian US Politics','Guardian Trump','Politico Trump')
ORDER BY fr.feed_name;

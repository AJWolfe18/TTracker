-- One-time PROD fix (October 24, 2026): replace the dead Washington Post politics feed with NBC News Politics.
-- Run on PROD only, in the SQL Editor. One guarded block: the WaPo UPDATE must hit exactly 1 row and the
-- NBC INSERT must add exactly 1 row, or the whole block rolls back and changes nothing.
-- A second run raises on the first statement (feed 5 is no longer active) and changes nothing.
--
-- Cause: every feeds.washingtonpost.com feed has returned nginx 502 since October 14, 2026 (checked again
-- October 24 from this PC; www.washingtonpost.com/arcio/rss/* times out for scripts). The last WaPo
-- article on PROD is from October 14; before that the feed gave about 14 articles a day.
-- Replacement checked October 24 with the project's rss-parser and scripts/rss/scorer.js: NBC News
-- Politics returned 25 items from the last day, 21 kept by scoreGovRelevance, average excerpt 206 chars
-- (CBS 23/30 at 158, ABC 24/25 at 147). Feed 5 is switched off, not repointed, so old WaPo articles
-- (articles.feed_id '5') keep pointing at a WaPo row.
-- Compliance: the NBC rule (5000 chars, excerpts only) is inserted in the same block WHEN the
-- feed_compliance_rules table exists. PROD has no such table (checked November 7, 2026: PGRST205),
-- so on PROD no feed has a rule and scripts/rss/fetch_feed.js applies its default of 5000 chars to
-- every feed, NBC included. Whether PROD should get the table is a separate decision (Codex P1,
-- November 7). TEST got the same change plus its compliance row.
--
-- Result: the grid shows both rows (first column: id). Expect feed 5 is_active false and one new
-- NBC News row with is_active true; the last column, compliance_table, is false on PROD. The next PROD RSS run should log "Fetching feed" for NBC News.
--
-- ROLLBACK (paste alone; one guarded block, same all-or-nothing rule):
--   DO $$
--   DECLARE n int;
--   BEGIN
--     IF to_regclass('public.feed_compliance_rules') IS NOT NULL THEN
--       EXECUTE 'DELETE FROM feed_compliance_rules WHERE feed_id IN
--                (SELECT id FROM feed_registry WHERE feed_url = ''https://feeds.nbcnews.com/nbcnews/public/politics'')';
--     END IF;
--     UPDATE feed_registry SET is_active = false
--      WHERE feed_url = 'https://feeds.nbcnews.com/nbcnews/public/politics' AND is_active = true;
--     GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'NBC: expected 1 active row, got %', n; END IF;
--     UPDATE feed_registry SET is_active = true
--      WHERE id = 5 AND is_active = false AND feed_url ILIKE 'https://feeds.washingtonpost.com/%';
--     GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'WaPo: expected 1 inactive row with id 5, got %', n; END IF;
--   END $$;
-- The NBC row is switched off, not deleted, so any NBC articles already ingested keep their feed.

DO $$
DECLARE n int; v_nbc bigint;
BEGIN
  UPDATE feed_registry SET is_active = false
   WHERE id = 5 AND is_active = true
     AND feed_url ILIKE 'https://feeds.washingtonpost.com/%';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'WaPo: expected 1 active row with id 5 and a feeds.washingtonpost.com URL, got %. Nothing changed.', n; END IF;

  INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
  SELECT 'https://feeds.nbcnews.com/nbcnews/public/politics', 'NBC News Politics', 'NBC News',
         ARRAY['politics','congress','executive'], 2, 1, true,
         '{"allow": ["Trump", "Congress", "White House", "Supreme Court", "SCOTUS", "federal", "DOJ"],
           "block": ["city council", "mayor", "state legislature", "gubernatorial"],
           "disallowedUrlIncludes": ["/video/", "/opinion/", "/think/"]}'::jsonb
   WHERE NOT EXISTS (SELECT 1 FROM feed_registry WHERE feed_url ILIKE '%nbcnews.com%')
  RETURNING id INTO v_nbc;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'NBC: expected to add 1 row, added % (an nbcnews.com feed already exists?). Nothing changed.', n; END IF;

  -- dynamic SQL: a static reference to a missing table fails the whole block on PROD
  IF to_regclass('public.feed_compliance_rules') IS NOT NULL THEN
    EXECUTE 'INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
             VALUES ($1, 5000, false, ''NBC News'', ''5K char limit for RSS content - excerpt only'')'
      USING v_nbc;
  END IF;
END $$;

-- compliance_table says whether an NBC compliance rule could be written (false on PROD today:
-- the fetcher's 5000-char default applies, see the header)
SELECT id, source_name, feed_url, is_active, failure_count, tier, source_tier,
       to_regclass('public.feed_compliance_rules') IS NOT NULL AS compliance_table
  FROM feed_registry
 WHERE id = 5 OR feed_url ILIKE '%nbcnews.com%'
 ORDER BY id;

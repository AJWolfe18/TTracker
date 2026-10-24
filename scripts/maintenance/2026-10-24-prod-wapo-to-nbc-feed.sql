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
-- PROD has no feed_compliance_rules table, so there is no compliance INSERT here (it would roll back
-- the block); the fetcher falls back to 5000 chars. TEST got the same change plus its compliance row.
--
-- Result: the grid shows both rows (first column: id). Expect feed 5 is_active false and one new
-- NBC News row with is_active true. The next PROD RSS run should log "Fetching feed" for NBC News.

DO $$
DECLARE n int;
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
   WHERE NOT EXISTS (SELECT 1 FROM feed_registry WHERE feed_url ILIKE '%nbcnews.com%');
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'NBC: expected to add 1 row, added % (an nbcnews.com feed already exists?). Nothing changed.', n; END IF;
END $$;

SELECT id, source_name, feed_url, is_active, failure_count, tier, source_tier
  FROM feed_registry
 WHERE id = 5 OR feed_url ILIKE '%nbcnews.com%'
 ORDER BY id;

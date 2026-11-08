-- One-time PROD fix (November 7, 2026, ADO-637): turn the Washington Post politics feed (PROD feed 5) back on,
-- ALONGSIDE NBC News (feed 23), which stays on.
-- Run on PROD only, in the SQL Editor. One guarded block: the UPDATE must hit exactly 1 row (feed 5, currently
-- off, with a feeds.washingtonpost.com URL) or the block raises and changes nothing. A second run raises too
-- (feed 5 is already on) and changes nothing.
--
-- Why: feed 5 returned nginx 502 from October 14 and was switched off for NBC by
-- scripts/maintenance/2026-10-24-prod-wapo-to-nbc-feed.sql (pasted on PROD November 7). It had recovered by
-- then: PROD stored 6 WaPo articles at about 10 AM CT November 7, and on November 7 at 6:20 PM CT
-- https://feeds.washingtonpost.com/rss/politics answered HTTP 200 with items published that evening.
-- Cost: about 14 more articles a day through the existing GPT-4o-mini entity extraction + embeddings, well
-- under $0.01/day.
-- failure_count is reset to 0: scripts/rss/feed-health.js fetches active feeds every run only while
-- failure_count < 5 (5+ = retried once a day), and any count left from the 502 period must not keep the
-- re-enabled feed in once-a-day mode.
-- This is NOT the rollback in the October 24 script: that one turns NBC off again.
--
-- Result: the grid shows both feeds (first column: id). Expect id 5 is_active true, failure_count 0, and the
-- NBC News row still is_active true. The next PROD RSS run (Netlify trigger, every 2 hours at :47) should log
-- "Fetching feed 5".
--
-- ROLLBACK (paste alone; turns feed 5 off again, NBC untouched):
--   DO $$
--   DECLARE n int;
--   BEGIN
--     UPDATE feed_registry SET is_active = false
--      WHERE id = 5 AND is_active = true AND feed_url ILIKE 'https://feeds.washingtonpost.com/%';
--     GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'WaPo: expected 1 active row with id 5, got %. Nothing changed.', n; END IF;
--   END $$;

DO $$
DECLARE n int;
BEGIN
  UPDATE feed_registry SET is_active = true, failure_count = 0
   WHERE id = 5 AND is_active = false
     AND feed_url ILIKE 'https://feeds.washingtonpost.com/%';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'WaPo: expected 1 inactive row with id 5 and a feeds.washingtonpost.com URL, got %. Nothing changed.', n; END IF;
END $$;

SELECT id, source_name, feed_url, is_active, failure_count, tier, source_tier
  FROM feed_registry
 WHERE id = 5 OR feed_url ILIKE '%nbcnews.com%'
 ORDER BY id;

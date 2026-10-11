-- One-time PROD fix (October 10, 2026, ADO-601): five active feeds produced no PROD articles.
-- Run on PROD only, in the SQL Editor. One guarded block: every UPDATE must hit exactly 1 row
-- (matched on its CURRENT feed_url), or the whole block rolls back and changes nothing.
-- A second run raises on the first statement (the URLs/counts no longer match) and changes nothing.
--
-- Causes (verified October 10, 2026 with the fetcher's User-Agent and the project's rss-parser):
--   CSM, Newsweek   feed is fine; failure_count reached 5, and selectFeeds() in
--                   scripts/rss-tracker-supabase.js never fetches such a feed again (no retry, no alert).
--   Time            /section/politics/feed/ redirects to an HTML page ("not RSS 1 or 2"); Time has no
--                   politics-only feed any more, so the main feed + filter_config does the narrowing.
--   Politico Top    www.politico.com/rss/politicopicks.xml is behind a Cloudflare 403 since July 20, 2026.
--   Reason          /tag/politics/feed/ froze on August 19, 2026 (every run gets 304 Not Modified).
-- New URLs each returned 200, valid RSS, items from the last 96 hours, and items passing filter_config.
-- URL changes clear etag/last_modified so the old feed's cache headers are not sent to the new URL.
--
-- Result: the grid shows the 5 rows after the fix (first column: id). Expect failure_count 0 on all 5.
-- Then the next PROD RSS run should log "Fetching feed" for all five.

DO $$
DECLARE n int;
BEGIN
  UPDATE feed_registry SET failure_count = 0
   WHERE source_name = 'Christian Science Monitor' AND is_active = true
     AND feed_url = 'https://rss.csmonitor.com/feeds/politics' AND failure_count >= 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'CSM: expected 1 row, got %. Nothing changed.', n; END IF;

  UPDATE feed_registry SET failure_count = 0
   WHERE source_name = 'Newsweek' AND is_active = true
     AND feed_url = 'https://www.newsweek.com/rss' AND failure_count >= 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Newsweek: expected 1 row, got %. Nothing changed.', n; END IF;

  -- Time's new feed is site-wide, so only filter_config keeps entertainment/health stories out: refuse
  -- unless the row already has a non-empty allow list (TEST's: Trump, Congress, White House, ...).
  UPDATE feed_registry
     SET feed_url = 'https://time.com/feed/', failure_count = 0, etag = NULL, last_modified = NULL
   WHERE source_name = 'Time' AND is_active = true
     AND feed_url = 'https://time.com/section/politics/feed/'
     AND jsonb_typeof(filter_config->'allow') = 'array'
     AND jsonb_array_length(filter_config->'allow') > 0;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Time: expected 1 row with the old URL and an allow list in filter_config, got %. Nothing changed.', n; END IF;

  UPDATE feed_registry
     SET feed_url = 'https://rss.politico.com/politics-news.xml', failure_count = 0, etag = NULL, last_modified = NULL
   WHERE id = 9 AND source_name = 'Politico Top' AND is_active = true
     AND feed_url = 'https://www.politico.com/rss/politicopicks.xml';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Politico Top: expected 1 row, got %. Nothing changed.', n; END IF;

  UPDATE feed_registry
     SET feed_url = 'https://reason.com/category/politics/feed/', failure_count = 0, etag = NULL, last_modified = NULL
   WHERE id = 4 AND source_name = 'Reason' AND is_active = true
     AND feed_url = 'https://reason.com/tag/politics/feed/';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'Reason: expected 1 row, got %. Nothing changed.', n; END IF;
END $$;

SELECT id, source_name, feed_url, failure_count, is_active
  FROM feed_registry
 WHERE source_name IN ('Christian Science Monitor', 'Newsweek', 'Politico Top', 'Reason', 'Time')
 ORDER BY id;

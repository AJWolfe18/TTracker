-- Migration 131: feed_registry.last_failed_at + last_item_published_at (ADO-625).
--
-- last_failed_at: stamped on every failed fetch (scripts/rss/fetch_feed.js). selectFeeds()
-- (scripts/rss/feed-health.js) skipped any feed with failure_count >= 5 forever, and a failed fetch
-- stamped no time, so nothing could retry it: CSM, Newsweek, Time and Politico Top sat dark for months
-- (ADO-601). A stopped feed is now fetched again once its last failure is more than 24 hours old; a
-- success resets failure_count (unchanged). NULL on a stopped feed = due now.
--
-- last_item_published_at: newest item date in the feed itself, stamped on every 200 fetch. Per-feed
-- liveness that does not depend on article attribution: articles.feed_id is first-feed-wins, so a feed
-- whose items also appear in another feed owns no articles even while it publishes (ADO-600). The
-- daily ingest check names feeds whose newest item is older than its silent window. NULL = not yet
-- fetched since this migration (the check skips it).
--
-- Order-independent: the pipeline writes these columns in separate updates and treats a missing column
-- as "no retries / no stamp", so code and migration can ship in either order.
--
-- Idempotent (IF NOT EXISTS). Nullable, no default: adding them rewrites nothing.
-- Rollback: ALTER TABLE public.feed_registry DROP COLUMN IF EXISTS last_failed_at,
--           DROP COLUMN IF EXISTS last_item_published_at;

ALTER TABLE public.feed_registry ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ;
ALTER TABLE public.feed_registry ADD COLUMN IF NOT EXISTS last_item_published_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';

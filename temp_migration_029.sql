-- =============================================================================
-- Migration 029: Monitoring Views
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- Feed health overview (true 24h window)
CREATE OR REPLACE VIEW admin.feed_health_overview AS
WITH last24 AS (
  SELECT a.feed_id, COUNT(*) AS articles_24h
  FROM public.articles a
  WHERE a.created_at >= (NOW() - INTERVAL '24 hours')
    AND a.feed_id IS NOT NULL
  GROUP BY a.feed_id
),
m24 AS (
  SELECT feed_id,
         SUM(success_count) AS success_24h,
         SUM(fetch_count)   AS fetch_24h,
         SUM(error_count)   AS error_24h,
         SUM(not_modified_count) AS not_modified_24h
  FROM public.feed_metrics
  WHERE metric_date >= (CURRENT_DATE - INTERVAL '1 day')
  GROUP BY feed_id
)
SELECT
  f.id AS feed_id,
  f.feed_name,
  f.is_active,
  COALESCE(l.articles_24h, 0) AS articles_24h,
  COALESCE(m.success_24h, 0)  AS success_fetches_24h,
  COALESCE(m.error_24h, 0)    AS errors_24h,
  COALESCE(m.fetch_24h, 0)    AS fetches_24h,
  CASE
    WHEN COALESCE(m.fetch_24h, 0) > 0
    THEN ROUND((COALESCE(m.error_24h, 0)::numeric / m.fetch_24h) * 100, 2)
    ELSE NULL
  END AS error_rate_24h,
  -- Health status for alerting and dashboards
  CASE
    WHEN COALESCE(f.failure_count, 0) > 10
      OR (COALESCE(m.fetch_24h, 0) > 0 AND (COALESCE(m.error_24h, 0)::numeric / m.fetch_24h) > 0.5)
      THEN 'CRITICAL'
    WHEN COALESCE(f.failure_count, 0) > 3
      OR (COALESCE(m.fetch_24h, 0) > 0 AND (COALESCE(m.error_24h, 0)::numeric / m.fetch_24h) > 0.1)
      THEN 'DEGRADED'
    WHEN COALESCE(l.articles_24h, 0) = 0 AND COALESCE(m.fetch_24h, 0) = 0
      THEN 'INACTIVE'
    ELSE 'HEALTHY'
  END AS health_status
FROM public.feed_registry f
LEFT JOIN last24 l ON l.feed_id = f.id
LEFT JOIN m24 m ON m.feed_id = f.id
WHERE f.is_active = TRUE;

-- Activity hints for scheduler
CREATE OR REPLACE VIEW admin.feed_activity_hints AS
WITH lr AS (
  SELECT feed_id, MAX(processed_at) AS last_run_at
  FROM public.job_queue
  WHERE job_type = 'rss_fetch_feed' 
    AND processed_at IS NOT NULL
    AND feed_id IS NOT NULL
  GROUP BY feed_id
),
a24 AS (
  SELECT feed_id, COUNT(*) AS articles_24h
  FROM public.articles
  WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND feed_id IS NOT NULL
  GROUP BY feed_id
),
m AS (
  SELECT 
    feed_id,
    SUM(CASE WHEN metric_date >= CURRENT_DATE - 1 THEN not_modified_count ELSE 0 END) AS not_modified_24h,
    SUM(CASE WHEN metric_date >= CURRENT_DATE - 1 THEN fetch_count ELSE 0 END) AS fetches_24h
  FROM public.feed_metrics
  GROUP BY feed_id
)
SELECT
  f.id AS feed_id,
  f.feed_name,
  f.is_active,
  f.consecutive_successes,
  f.failure_count,
  COALESCE(a24.articles_24h, 0) AS articles_24h,
  COALESCE(m.not_modified_24h, 0) AS not_modified_24h,
  COALESCE(m.fetches_24h, 0) AS fetches_24h,
  lr.last_run_at,
  -- Adaptive polling interval (scheduler input)
  -- Base: 2 hours, adjust based on activity and health
  CASE
    -- Failed feed: exponential backoff (30m → 1h → 2h → 4h cap)
    WHEN COALESCE(f.failure_count, 0) >= 7 THEN 14400  -- 4 hours
    WHEN COALESCE(f.failure_count, 0) >= 4 THEN 7200   -- 2 hours
    WHEN COALESCE(f.failure_count, 0) >= 2 THEN 3600   -- 1 hour
    WHEN COALESCE(f.failure_count, 0) >= 1 THEN 1800   -- 30 minutes
    -- High 304 rate: reduce polling (feed hasn't changed)
    WHEN COALESCE(m.fetches_24h, 0) > 0
      AND (COALESCE(m.not_modified_24h, 0)::numeric / m.fetches_24h) > 0.8
      THEN 14400  -- 4 hours (mostly 304s)
    -- High activity: more frequent polling
    WHEN COALESCE(a24.articles_24h, 0) > 10 THEN 3600  -- 1 hour (hot feed)
    -- Low activity: less frequent polling
    WHEN COALESCE(a24.articles_24h, 0) = 0 THEN 21600  -- 6 hours (cold feed)
    -- Normal activity: standard interval
    ELSE 7200  -- 2 hours (default)
  END AS suggested_interval_seconds,
  -- Human-readable interval
  CASE
    WHEN COALESCE(f.failure_count, 0) >= 7 THEN '4 hours'
    WHEN COALESCE(f.failure_count, 0) >= 4 THEN '2 hours'
    WHEN COALESCE(f.failure_count, 0) >= 2 THEN '1 hour'
    WHEN COALESCE(f.failure_count, 0) >= 1 THEN '30 minutes'
    WHEN COALESCE(m.fetches_24h, 0) > 0
      AND (COALESCE(m.not_modified_24h, 0)::numeric / m.fetches_24h) > 0.8
      THEN '4 hours'
    WHEN COALESCE(a24.articles_24h, 0) > 10 THEN '1 hour'
    WHEN COALESCE(a24.articles_24h, 0) = 0 THEN '6 hours'
    ELSE '2 hours'
  END AS suggested_interval_human
FROM public.feed_registry f
LEFT JOIN a24 ON a24.feed_id = f.id
LEFT JOIN m ON m.feed_id = f.id
LEFT JOIN lr ON lr.feed_id = f.id
WHERE f.is_active = TRUE;

-- Cost attribution (per-feed budget tracking)
CREATE OR REPLACE VIEW admin.feed_cost_attribution AS
WITH a24 AS (
  SELECT feed_id, COUNT(*) AS articles_24h
  FROM public.articles
  WHERE created_at >= NOW() - INTERVAL '24 hours'
    AND feed_id IS NOT NULL
  GROUP BY feed_id
),
m24 AS (
  SELECT feed_id, SUM(fetch_count) AS fetches_24h
  FROM public.feed_metrics
  WHERE metric_date >= (CURRENT_DATE - INTERVAL '1 day')
  GROUP BY feed_id
)
SELECT
  f.id AS feed_id,
  f.feed_name,
  COALESCE(a24.articles_24h, 0) AS articles_24h,
  COALESCE(m24.fetches_24h, 0) AS fetches_24h,
  -- Cost breakdown:
  -- - OpenAI embeddings: $0.0002 per article
  -- - Story clustering: $0.00015 per article
  -- Total: $0.00035 per article
  ROUND((COALESCE(a24.articles_24h, 0) * 0.00035)::numeric, 4) AS total_cost_24h_usd,
  -- Project to monthly (30 days)
  ROUND((COALESCE(a24.articles_24h, 0) * 0.00035 * 30)::numeric, 2) AS projected_cost_month_usd
FROM public.feed_registry f
LEFT JOIN a24 ON a24.feed_id = f.id
LEFT JOIN m24 ON m24.feed_id = f.id
WHERE f.is_active = TRUE;

GRANT SELECT ON admin.feed_health_overview TO authenticated;
GRANT SELECT ON admin.feed_activity_hints TO authenticated;
GRANT SELECT ON admin.feed_cost_attribution TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 029 completed!';
  RAISE NOTICE 'Next: Verify views are working';
END $$;

-- Migration 025: Feed Filter Monitoring View
-- Part of TTRC-263/264 - RSS feed filtering health monitoring
-- Creates admin.feed_filter_stats view for dashboard visibility

-- Create admin schema if needed
CREATE SCHEMA IF NOT EXISTS admin;

-- Create monitoring view for feed filtering effectiveness
CREATE OR REPLACE VIEW admin.feed_filter_stats AS
WITH recent_logs AS (
  -- Parse worker logs from job_queue metadata
  -- Note: This is a placeholder implementation
  -- Actual DROP logs are in worker stdout, not job_queue
  -- Full implementation requires log aggregation table (see TTRC-265)
  SELECT
    NULL::bigint AS feed_id,
    NULL::text AS status
  WHERE false
),
feed_metrics AS (
  -- Calculate articles processed per feed in last 24h
  SELECT
    a.feed_id,
    COUNT(*) AS articles_24h
  FROM articles a
  WHERE a.created_at > NOW() - INTERVAL '24 hours'
  GROUP BY a.feed_id
)
SELECT
  fr.id AS feed_id,
  fr.source_name AS feed_name,
  fr.feed_url,
  fr.is_active,
  COALESCE(fm.articles_24h, 0) AS articles_24h,
  -- Placeholder for DROP metrics (requires log aggregation)
  0 AS dropped_24h,
  0.0 AS drop_rate_pct,
  fr.last_fetched,
  fr.last_304_at,
  fr.failure_count,
  fr.filter_config
FROM feed_registry fr
LEFT JOIN feed_metrics fm ON fm.feed_id = fr.id
WHERE fr.is_active = true
ORDER BY articles_24h DESC;

-- Add helpful comment
COMMENT ON VIEW admin.feed_filter_stats IS
'Feed filtering health monitoring dashboard. Shows article counts per feed.
DROP metrics require log aggregation table (TTRC-265 scope).
Access via: SELECT * FROM admin.feed_filter_stats;';

-- Grant access (adjust role as needed)
GRANT SELECT ON admin.feed_filter_stats TO authenticated;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 025 complete: admin.feed_filter_stats view created';
  RAISE NOTICE 'Access via: SELECT * FROM admin.feed_filter_stats;';
  RAISE NOTICE 'Note: DROP metrics require log aggregation (TTRC-265)';
END $$;

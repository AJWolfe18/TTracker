-- =============================================================================
-- Verification: Migrations 028 & 029
-- =============================================================================

-- 1. Verify RPCs created (Migration 028)
SELECT 
  proname AS function_name,
  pg_get_function_arguments(oid) AS arguments
FROM pg_proc
WHERE proname IN (
  '_ensure_today_metrics',
  'record_feed_success',
  'record_feed_not_modified', 
  'record_feed_error',
  'enqueue_fetch_job'
)
ORDER BY proname, oid;

-- 2. Verify views created (Migration 029)
SELECT 
  schemaname,
  viewname
FROM pg_views
WHERE viewname IN (
  'feed_health_overview',
  'feed_activity_hints',
  'feed_cost_attribution'
)
ORDER BY schemaname, viewname;

-- 3. Verify index created
SELECT 
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE indexname = 'ux_job_queue_payload_hash_active';

-- 4. Test feed_health_overview view
SELECT * FROM admin.feed_health_overview
ORDER BY feed_id
LIMIT 10;

-- 5. Test feed_activity_hints view
SELECT * FROM admin.feed_activity_hints
ORDER BY feed_id
LIMIT 10;

-- 6. Test feed_cost_attribution view
SELECT * FROM admin.feed_cost_attribution
ORDER BY feed_id
LIMIT 10;

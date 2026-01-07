-- ============================================================================
-- POST-DEPLOYMENT VERIFICATION
-- ============================================================================
-- Purpose: Comprehensive validation of RSS v2 deployment
-- Run after: All migrations (027, 028, 029) and seeds complete
-- Expected Duration: 2 minutes
-- Action Required: Review all results, confirm no issues

-- ============================================================================
-- SECTION 1: Schema Validation
-- ============================================================================

-- 1A) Verify all new columns exist
SELECT 
  'Schema check' as category,
  table_name,
  column_name,
  data_type,
  '✓' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'articles' AND column_name = 'feed_id')
    OR (table_name = 'job_queue' AND column_name = 'feed_id')
    OR (table_name = 'feed_registry' AND column_name IN ('last_response_time_ms', 'consecutive_successes', 'failure_count'))
  )
ORDER BY table_name, column_name;

-- Expected: 6 rows

-- 1B) Verify new tables exist
SELECT 
  'Table check' as category,
  table_name,
  table_type,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count,
  '✓' as status
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('feed_metrics', 'feed_errors', 'feed_compliance_rules')
ORDER BY table_name;

-- Expected: 3 tables

-- 1C) Verify indexes created
SELECT 
  'Index check' as category,
  tablename,
  indexname,
  '✓' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'ix_articles_feed_id',
    'ix_job_queue_feed_id',
    'ix_job_queue_next_active_by_feed',
    'ix_job_queue_feed_id_null',
    'ix_feed_errors_feed_time',
    'ix_feed_errors_created_at',
    'ix_feed_metrics_date',
    'ux_job_queue_payload_hash_active'
  )
ORDER BY tablename, indexname;

-- Expected: 8 indexes

-- 1D) Verify old blocking index removed
SELECT 
  COUNT(*) as blocking_index_count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✓ Removed successfully'
    ELSE '🛑 BLOCKING INDEX STILL EXISTS'
  END as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'job_queue_type_payload_hash_key';

-- Expected: 0 rows, status = '✓ Removed successfully'

-- ============================================================================
-- SECTION 2: Function Validation
-- ============================================================================

-- 2A) Verify all RPCs exist
SELECT 
  'Function check' as category,
  routine_name,
  routine_type,
  CASE routine_name
    WHEN '_ensure_today_metrics' THEN 'Helper'
    WHEN 'record_feed_success' THEN 'Metrics'
    WHEN 'record_feed_not_modified' THEN 'Metrics'
    WHEN 'record_feed_error' THEN 'Metrics'
    WHEN 'enqueue_fetch_job' THEN 'Job queue'
  END as function_category,
  '✓' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    '_ensure_today_metrics',
    'record_feed_success',
    'record_feed_not_modified',
    'record_feed_error',
    'enqueue_fetch_job'
  )
ORDER BY function_category, routine_name;

-- Expected: 6 rows (enqueue_fetch_job has 2 overloads)

-- 2B) Verify trigger exists
SELECT 
  'Trigger check' as category,
  trigger_name,
  event_manipulation,
  event_object_table,
  '✓' as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'trg_job_queue_sync_feed_id';

-- Expected: 1 row

-- ============================================================================
-- SECTION 3: View Validation
-- ============================================================================

-- 3A) Verify views created
SELECT 
  'View check' as category,
  table_name as view_name,
  '✓' as status
FROM information_schema.views
WHERE table_schema = 'admin'
  AND table_name IN (
    'feed_health_overview',
    'feed_activity_hints',
    'feed_cost_attribution'
  )
ORDER BY table_name;

-- Expected: 3 rows

-- 3B) Test view queries (must return without errors)
SELECT 'View query test' as category, 'feed_health_overview' as view_name, COUNT(*) as rows
FROM admin.feed_health_overview;

SELECT 'View query test' as category, 'feed_activity_hints' as view_name, COUNT(*) as rows
FROM admin.feed_activity_hints;

SELECT 'View query test' as category, 'feed_cost_attribution' as view_name, COUNT(*) as rows
FROM admin.feed_cost_attribution;

-- ============================================================================
-- SECTION 4: Data Validation
-- ============================================================================

-- 4A) Article backfill coverage
SELECT 
  'Backfill check' as category,
  CASE 
    WHEN feed_id IS NOT NULL THEN '✓ Mapped to feed'
    ELSE '○ No feed (legacy/manual)'
  END as mapping_status,
  COUNT(*) as article_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM public.articles
GROUP BY CASE WHEN feed_id IS NOT NULL THEN '✓ Mapped to feed' ELSE '○ No feed (legacy/manual)' END
ORDER BY article_count DESC;

-- Expected: ~95% mapped, ~5% unmapped

-- 4B) Compliance rules coverage
SELECT 
  'Compliance check' as category,
  f.id,
  f.feed_name,
  f.is_active,
  CASE 
    WHEN cr.feed_id IS NOT NULL THEN '✓ Has rule'
    ELSE '🛑 MISSING RULE'
  END as compliance_status
FROM public.feed_registry f
LEFT JOIN public.feed_compliance_rules cr ON cr.feed_id = f.id
ORDER BY f.id;

-- Expected: All active feeds have rules

-- 4C) Detailed breakdown by feed
SELECT 
  'Article distribution' as category,
  f.id,
  f.feed_name,
  COUNT(a.id) as article_count,
  MIN(a.created_at) as oldest_article,
  MAX(a.created_at) as newest_article
FROM public.feed_registry f
LEFT JOIN public.articles a ON a.feed_id = f.id
GROUP BY f.id, f.feed_name
ORDER BY article_count DESC;

-- ============================================================================
-- SECTION 5: Operational Health
-- ============================================================================

-- 5A) Feed health dashboard (real-time)
SELECT 
  'Health dashboard' as category,
  feed_name,
  is_active,
  articles_24h,
  fetches_24h,
  error_rate_24h,
  health_status,
  CASE 
    WHEN health_status IN ('HEALTHY', 'INACTIVE') THEN '✓'
    WHEN health_status = 'DEGRADED' THEN '⚠️'
    ELSE '🛑'
  END as status_icon
FROM admin.feed_health_overview
ORDER BY feed_id;

-- 5B) Activity hints (scheduler input)
SELECT 
  'Activity hints' as category,
  feed_name,
  is_active,
  articles_24h,
  suggested_interval_human,
  CASE 
    WHEN is_active AND suggested_interval_seconds IS NOT NULL THEN '✓'
    WHEN NOT is_active THEN '○ Inactive'
    ELSE '⚠️'
  END as status
FROM admin.feed_activity_hints
ORDER BY feed_id;

-- 5C) Legacy job debt (jobs without feed_id)
SELECT 
  'Legacy debt' as category,
  COUNT(*) as jobs_without_feed_id,
  CASE 
    WHEN COUNT(*) = 0 THEN '✓ Clean'
    WHEN COUNT(*) < 10 THEN '○ Acceptable'
    ELSE '⚠️ Review callers'
  END as status
FROM public.job_queue
WHERE feed_id IS NULL 
  AND processed_at IS NULL
  AND created_at > NOW() - INTERVAL '1 hour';

-- Recent jobs only (last hour)

-- ============================================================================
-- SECTION 6: Cost Validation
-- ============================================================================

-- 6A) Projected monthly costs
SELECT 
  'Cost projection' as category,
  SUM(projected_cost_month_usd) as total_projected_monthly_usd,
  CASE 
    WHEN SUM(projected_cost_month_usd) < 50 THEN '✓ Under budget'
    WHEN SUM(projected_cost_month_usd) < 60 THEN '⚠️ Near budget'
    ELSE '🛑 OVER BUDGET'
  END as budget_status
FROM admin.feed_cost_attribution;

-- Expected: Well under $50/month

-- 6B) Per-feed cost breakdown
SELECT 
  'Cost by feed' as category,
  feed_name,
  fetches_24h,
  articles_24h,
  total_cost_24h_usd,
  projected_cost_month_usd
FROM admin.feed_cost_attribution
ORDER BY projected_cost_month_usd DESC
LIMIT 10;

-- ============================================================================
-- SECTION 7: Integration Tests
-- ============================================================================

-- 7A) Test metrics recording (creates test data)
DO $$
DECLARE
  test_feed_id BIGINT := 5; -- Politico feed (Feed 6 was deleted in TTRC-242)
BEGIN
  -- Test success recording
  PERFORM public.record_feed_success(test_feed_id, 250);

  -- Test 304 recording
  PERFORM public.record_feed_not_modified(test_feed_id, 150);

  -- Test error recording
  PERFORM public.record_feed_error(test_feed_id, 'Test error - safe to ignore');

  RAISE NOTICE '✓ Metrics recording test passed';
END$$;

-- Verify test metrics created
SELECT
  'Integration test' as category,
  'Metrics recording' as test_name,
  metric_date,
  feed_id,
  fetch_count,
  success_count,
  error_count,
  not_modified_count,
  CASE
    WHEN fetch_count >= 3 AND success_count >= 2 AND error_count >= 1 AND not_modified_count >= 1
    THEN '✓ Pass'
    ELSE '🛑 Fail'
  END as result
FROM public.feed_metrics
WHERE feed_id = 5 AND metric_date = CURRENT_DATE;

-- 7B) Test job enqueuing (both signatures)
DO $$
DECLARE
  job_id_new BIGINT;
  job_id_legacy BIGINT;
BEGIN
  -- Test new 5-arg signature
  job_id_new := public.enqueue_fetch_job(
    p_feed_id := 5,
    p_job_type := 'test_rss_fetch',
    p_payload := '{"test": "new_signature"}'::jsonb,
    p_run_at := NOW() + INTERVAL '1 hour'
  );

  -- Test legacy 3-arg signature
  job_id_legacy := public.enqueue_fetch_job(
    'test_legacy_job',
    '{"test": "legacy_signature"}'::jsonb
  );

  -- Cleanup test jobs
  DELETE FROM public.job_queue WHERE id IN (job_id_new, job_id_legacy);

  RAISE NOTICE '✓ Job enqueue test passed (job_ids: %, %)', job_id_new, job_id_legacy;
END$$;

-- ============================================================================
-- VERIFICATION COMPLETE
-- ============================================================================
--
-- ✅ All checks should show success indicators (✓)
-- ⚠️ Warnings acceptable for:
--   - Legacy debt (if old jobs exist)
--   - Unmapped articles (test/example data)
--   - Degraded health (if feeds recently errored)
--
-- 🛑 CRITICAL ISSUES if:
--   - Blocking index still exists
--   - Active feeds missing compliance rules
--   - Health status = CRITICAL
--   - Over budget projection
--   - Integration tests fail
--
-- ➡️ Next steps:
--   1. Monitor feed_health_overview for 24 hours
--   2. Add first new feed source (with compliance rule)
--   3. Plan Slack alert integration
--   4. Update Edge Functions to use new RPC signatures
--
-- ============================================================================

-- Verify Migration 027 completed successfully

-- 1. Check new tables exist
SELECT 'Tables Check' as check_type, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('feed_metrics', 'feed_errors', 'feed_compliance_rules')
ORDER BY table_name;

-- 2. Check feed_registry new columns
SELECT 'Feed Registry Columns' as check_type, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'feed_registry'
  AND column_name IN ('last_response_time_ms', 'consecutive_successes', 'failure_count')
ORDER BY column_name;

-- 3. Check blocking constraint was dropped
SELECT
  'Constraint Check' as check_type,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ Blocking constraint dropped'
    ELSE '❌ Blocking constraint still exists'
  END as status
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'job_queue'
  AND constraint_name = 'job_queue_type_payload_hash_key';

-- 4. Check indexes created
SELECT 'Index Check' as check_type, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'ix_articles_feed_id',
    'ix_job_queue_feed_id',
    'ix_job_queue_next_active_by_feed',
    'ix_job_queue_feed_id_null',
    'ix_feed_errors_feed_time',
    'ix_feed_errors_created_at'
  )
ORDER BY indexname;

-- 5. Check trigger exists
SELECT 'Trigger Check' as check_type, trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'trg_job_queue_sync_feed_id';

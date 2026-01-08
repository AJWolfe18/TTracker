-- ============================================================
-- RSS MIGRATION VERIFICATION SCRIPT
-- Run this in Supabase SQL Editor to verify all migrations
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RSS MIGRATION VERIFICATION';
  RAISE NOTICE 'Time: %', NOW();
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
END $$;

-- 1. CHECK TABLES
-- ============================================================
WITH required_tables AS (
  SELECT unnest(ARRAY[
    'articles', 'stories', 'article_story', 
    'feed_registry', 'job_queue', 'review_queue'
  ]) AS table_name
),
existing_tables AS (
  SELECT tablename AS table_name
  FROM pg_tables
  WHERE schemaname = 'public'
)
SELECT 
  'TABLES CHECK:' as check_type,
  CASE 
    WHEN COUNT(CASE WHEN e.table_name IS NULL THEN 1 END) = 0 
    THEN '✅ All required tables exist'
    ELSE '❌ Missing tables: ' || string_agg(
      CASE WHEN e.table_name IS NULL THEN r.table_name END, ', '
    )
  END as result
FROM required_tables r
LEFT JOIN existing_tables e ON r.table_name = e.table_name;

-- 2. CHECK JOB_QUEUE CRITICAL COLUMNS
-- ============================================================
SELECT 
  'JOB_QUEUE COLUMNS:' as check_type,
  string_agg(
    column_name || ' (' || data_type || ')', 
    ', ' ORDER BY ordinal_position
  ) as result
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'job_queue';

-- Check specific critical columns
WITH critical_columns AS (
  SELECT unnest(ARRAY[
    'started_at', 'completed_at', 'job_type', 'run_at', 
    'attempts', 'max_attempts', 'payload_hash', 'last_error'
  ]) AS col_name
),
existing_cols AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'job_queue'
)
SELECT 
  'CRITICAL COLUMNS:' as check_type,
  CASE 
    WHEN COUNT(CASE WHEN e.column_name IS NULL THEN 1 END) = 0 
    THEN '✅ All critical columns exist'
    ELSE '❌ MISSING: ' || string_agg(
      CASE WHEN e.column_name IS NULL THEN c.col_name END, ', '
    )
  END as result
FROM critical_columns c
LEFT JOIN existing_cols e ON c.col_name = e.column_name;

-- 3. CHECK FOR OLD COLUMN NAMES (should not exist)
-- ============================================================
SELECT 
  'OLD COLUMNS CHECK:' as check_type,
  CASE 
    WHEN COUNT(*) > 0 
    THEN '⚠️ Old columns still exist: ' || string_agg(column_name, ', ')
    ELSE '✅ No old column names found'
  END as result
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'job_queue'
  AND column_name IN ('type', 'run_after', 'error');

-- 4. CHECK ATOMIC FUNCTIONS
-- ============================================================
SELECT 
  'ATOMIC FUNCTIONS:' as check_type,
  string_agg(proname || '()', ', ') as result
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('claim_next_job', 'finish_job', 'reset_failed_jobs');

-- Check article upsert function
SELECT 
  'ARTICLE UPSERT:' as check_type,
  CASE 
    WHEN COUNT(*) > 0 
    THEN '✅ Function upsert_article_and_enqueue_jobs exists'
    ELSE '❌ Function upsert_article_and_enqueue_jobs MISSING'
  END as result
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'upsert_article_and_enqueue_jobs';

-- 5. CHECK JOB QUEUE STATUS VALUES
-- ============================================================
SELECT 
  'JOB STATUS VALUES:' as check_type,
  string_agg(DISTINCT status, ', ' ORDER BY status) as result
FROM job_queue
WHERE status IS NOT NULL;

-- Check for old 'completed' status
SELECT 
  'OLD STATUS CHECK:' as check_type,
  CASE 
    WHEN COUNT(*) > 0 
    THEN '⚠️ Found ' || COUNT(*) || ' jobs with old "completed" status - should be "done"'
    ELSE '✅ No old "completed" status found'
  END as result
FROM job_queue
WHERE status = 'completed';

-- 6. CHECK FEED REGISTRY
-- ============================================================
SELECT 
  'ACTIVE FEEDS:' as check_type,
  CASE 
    WHEN COUNT(*) > 0 
    THEN '✅ ' || COUNT(*) || ' active feeds: ' || string_agg(feed_name, ', ' ORDER BY feed_name)
    ELSE '⚠️ No active feeds found - need to seed'
  END as result
FROM feed_registry
WHERE is_active = true;

-- 7. CHECK PENDING/PROCESSING JOBS
-- ============================================================
SELECT 
  'JOB QUEUE STATUS:' as check_type,
  'Pending: ' || COUNT(CASE WHEN status = 'pending' THEN 1 END) || 
  ', Processing: ' || COUNT(CASE WHEN status = 'processing' THEN 1 END) ||
  ', Done: ' || COUNT(CASE WHEN status = 'done' THEN 1 END) ||
  ', Failed: ' || COUNT(CASE WHEN status = 'failed' THEN 1 END) as result
FROM job_queue;

-- Check for stuck jobs (processing > 30 minutes)
SELECT 
  'STUCK JOBS:' as check_type,
  CASE 
    WHEN COUNT(*) > 0 
    THEN '⚠️ ' || COUNT(*) || ' jobs stuck in processing > 30 min'
    ELSE '✅ No stuck jobs'
  END as result
FROM job_queue
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes';

-- 8. CHECK ARTICLES TABLE
-- ============================================================
SELECT 
  'ARTICLES (24h):' as check_type,
  COUNT(*) || ' articles created in last 24 hours' as result
FROM articles
WHERE created_at > NOW() - INTERVAL '24 hours';

-- 9. CHECK GENERATED COLUMNS
-- ============================================================
SELECT 
  'GENERATED COLUMNS:' as check_type,
  column_name || ' (' || generation_expression || ')' as result
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_queue'
  AND is_generated = 'ALWAYS';

-- 10. CHECK UNIQUE CONSTRAINTS
-- ============================================================
SELECT 
  'UNIQUE CONSTRAINTS:' as check_type,
  conname || ' on (' || 
  string_agg(a.attname, ', ' ORDER BY a.attnum) || ')' as result
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'u'
  AND c.conrelid IN ('job_queue'::regclass, 'articles'::regclass)
GROUP BY c.conname;

-- FINAL SUMMARY
-- ============================================================
DO $$
DECLARE
  missing_count INTEGER;
  function_count INTEGER;
  feed_count INTEGER;
  stuck_count INTEGER;
BEGIN
  -- Count missing columns
  SELECT COUNT(*) INTO missing_count
  FROM (
    SELECT unnest(ARRAY['started_at', 'completed_at', 'job_type', 'run_at']) AS col
  ) required
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'job_queue' 
      AND column_name = required.col
  );
  
  -- Count functions
  SELECT COUNT(*) INTO function_count
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('claim_next_job', 'finish_job', 'upsert_article_and_enqueue_jobs');
  
  -- Count active feeds
  SELECT COUNT(*) INTO feed_count
  FROM feed_registry
  WHERE is_active = true;
  
  -- Count stuck jobs
  SELECT COUNT(*) INTO stuck_count
  FROM job_queue
  WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '30 minutes';
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'VERIFICATION SUMMARY';
  RAISE NOTICE '========================================';
  
  IF missing_count = 0 THEN
    RAISE NOTICE '✅ All critical columns exist';
  ELSE
    RAISE NOTICE '❌ Missing % critical columns', missing_count;
  END IF;
  
  IF function_count >= 3 THEN
    RAISE NOTICE '✅ All critical functions exist';
  ELSE
    RAISE NOTICE '❌ Only % of 3 critical functions exist', function_count;
  END IF;
  
  IF feed_count > 0 THEN
    RAISE NOTICE '✅ % active feeds configured', feed_count;
  ELSE
    RAISE NOTICE '⚠️ No active feeds - need to seed';
  END IF;
  
  IF stuck_count > 0 THEN
    RAISE NOTICE '⚠️ % stuck jobs need attention', stuck_count;
  END IF;
  
  RAISE NOTICE '';
  
  IF missing_count = 0 AND function_count >= 3 THEN
    RAISE NOTICE '🎉 SYSTEM READY FOR TESTING!';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. If no feeds, run seed script';
    RAISE NOTICE '2. Run E2E test or trigger GitHub Actions';
    RAISE NOTICE '3. Monitor job_queue for results';
  ELSE
    RAISE NOTICE '⚠️ MIGRATIONS INCOMPLETE!';
    RAISE NOTICE '';
    RAISE NOTICE 'Required migrations to apply:';
    IF missing_count > 0 THEN
      RAISE NOTICE '- 008_job_queue_critical_columns.sql';
    END IF;
    IF function_count < 3 THEN
      RAISE NOTICE '- 009_atomic_job_claiming.sql';
      RAISE NOTICE '- 010_fix_rpc_generated_column.sql';
    END IF;
  END IF;
  
  RAISE NOTICE '========================================';
END $$;
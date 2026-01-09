-- Verification Script for Migration 019
-- Run this after applying the migration to verify all objects created correctly

-- ============================================================================
-- 1. CHECK INDEXES EXIST
-- ============================================================================
SELECT 
  'INDEXES' as check_type,
  COUNT(*) as found,
  5 as expected
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname IN (
    'uq_job_payload',
    'idx_article_story_story', 
    'idx_articles_published_at',
    'idx_article_story_story_order',
    'idx_job_queue_pending_run_at'
  );

-- Details of each index
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND indexname IN (
    'uq_job_payload',
    'idx_article_story_story', 
    'idx_articles_published_at',
    'idx_article_story_story_order',
    'idx_job_queue_pending_run_at'
  )
ORDER BY indexname;

-- ============================================================================
-- 2. CHECK RPC FUNCTION EXISTS
-- ============================================================================
SELECT 
  'RPC FUNCTION' as check_type,
  COUNT(*) as found,
  1 as expected
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'increment_budget';

-- Function details
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type,
  l.lanname as language
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'increment_budget';

-- ============================================================================
-- 3. CHECK TODAY'S BUDGET ROW EXISTS
-- ============================================================================
SELECT 
  'BUDGET ROW' as check_type,
  COUNT(*) as found,
  1 as expected
FROM public.budgets
WHERE day = CURRENT_DATE;

-- Budget row details
SELECT 
  day,
  cap_usd,
  spent_usd,
  openai_calls,
  created_at,
  updated_at
FROM public.budgets
WHERE day = CURRENT_DATE;

-- ============================================================================
-- 4. TEST IDEMPOTENCY CONSTRAINT
-- ============================================================================
-- This should succeed (insert a test job)
INSERT INTO public.job_queue (type, payload, payload_hash, status)
VALUES ('test.verify', '{"test": true}', 'test_hash_001', 'pending')
RETURNING id, type, payload_hash, status;

-- This should FAIL with unique constraint violation (duplicate hash while pending)
-- Uncomment to test:
-- INSERT INTO public.job_queue (type, payload, payload_hash, status)
-- VALUES ('test.verify', '{"test": true}', 'test_hash_001', 'pending');

-- Cleanup test job
DELETE FROM public.job_queue 
WHERE type = 'test.verify' 
  AND payload_hash = 'test_hash_001';

-- ============================================================================
-- 5. TEST RPC FUNCTION
-- ============================================================================
-- This will be tested via Supabase client in the worker
-- Manual test example:
-- SELECT increment_budget(CURRENT_DATE, 0.001, 1);
-- SELECT * FROM budgets WHERE day = CURRENT_DATE;

-- ============================================================================
-- 6. VERIFY SPENT_USD PRECISION
-- ============================================================================
-- Confirm spent_usd can store 6 decimal places
SELECT 
  'COLUMN PRECISION' as check_type,
  column_name,
  numeric_precision as total_digits,
  numeric_scale as decimal_places,
  CASE WHEN numeric_scale >= 6 THEN 'PASS' ELSE 'FAIL' END as status
FROM information_schema.columns
WHERE table_name = 'budgets'
  AND column_name = 'spent_usd';

-- ============================================================================
-- 7. SUMMARY
-- ============================================================================
SELECT 
  'Migration 019 Verification Complete' as status,
  CURRENT_TIMESTAMP as checked_at;

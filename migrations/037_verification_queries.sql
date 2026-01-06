-- ============================================================================
-- Migration 037: Verification Queries
-- ============================================================================
-- Run these after applying migration 037 to verify success
-- Copy/paste each query into Supabase SQL Editor
-- ============================================================================

-- 1. Verify last_enriched_at added to stories
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'stories' AND column_name = 'last_enriched_at';
-- Expected: 1 row, data_type = 'timestamp with time zone', is_nullable = 'YES'

-- 2. Verify enrichment_failed added to run_stats  
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'admin' AND table_name = 'run_stats' 
  AND column_name = 'enrichment_failed';
-- Expected: 1 row, is_nullable = 'NO', column_default = '0'

-- 3. Verify RPC upgraded to 15 params
SELECT pronargs FROM pg_proc WHERE proname = 'log_run_stats';
-- Expected: 15

-- 4. Verify no function overloads exist
SELECT COUNT(*) FROM pg_proc WHERE proname = 'log_run_stats';
-- Expected: 1 (only the 15-param version)

-- 5. Verify service_role grants only
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'log_run_stats';
-- Expected: Only 'service_role' with 'EXECUTE'

-- ============================================================================
-- All 5 checks should pass before proceeding to code changes
-- ============================================================================

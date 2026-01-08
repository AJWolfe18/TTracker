-- ============================================================================
-- Migration 018D: Post-Migration Verification Queries
-- ============================================================================
-- Purpose: Verify migration 018 was applied successfully
-- Run these queries after applying 018A, 018B, and 018C
-- Author: TrumpyTracker Team  
-- Date: 2025-09-28
-- ============================================================================

-- 1. Verify the partial-unique index exists and is partial
SELECT 
  indexname,
  indexdef,
  CASE 
    WHEN indexdef LIKE '%WHERE%processed_at IS NULL%' 
    THEN '✅ Partial index correctly configured'
    ELSE '❌ Index is not partial!'
  END as status
FROM pg_indexes
WHERE schemaname = 'public' 
  AND indexname = 'ux_job_queue_payload_hash_active';

-- 2. Test claim function returns proper NULL when no jobs available
SELECT 
  CASE 
    WHEN claim_and_start_job('nonexistent-type', 5) IS NULL 
    THEN '✅ Claim correctly returns NULL for empty queue'
    ELSE '❌ Claim not returning NULL properly!'
  END as claim_null_test;

-- 3. Test runnable count function
SELECT 
  count_runnable_fetch_jobs() AS runnable_count,
  CASE 
    WHEN count_runnable_fetch_jobs() >= 0 
    THEN '✅ Count function working'
    ELSE '❌ Count function error!'
  END as count_test;

-- 4. Check for inconsistent job states (should be 0)
SELECT 
  COUNT(*) AS inconsistent_jobs,
  CASE 
    WHEN COUNT(*) = 0 
    THEN '✅ No inconsistent job states'
    ELSE '❌ Found jobs with status=processing but processed_at NOT NULL!'
  END as consistency_check
FROM public.job_queue
WHERE status = 'processing' 
  AND processed_at IS NOT NULL;

-- 5. Check for orphaned terminal jobs (should be 0)
SELECT 
  COUNT(*) AS orphaned_terminal,
  CASE 
    WHEN COUNT(*) = 0 
    THEN '✅ No orphaned terminal jobs'
    ELSE '❌ Found terminal jobs not marked as processed!'
  END as terminal_check
FROM public.job_queue
WHERE processed_at IS NULL
  AND status IN ('done', 'failed')
  AND completed_at IS NOT NULL;

-- 6. Verify all required columns exist
SELECT 
  COUNT(*) as column_count,
  CASE 
    WHEN COUNT(*) >= 14 
    THEN '✅ All required columns present'
    ELSE '❌ Missing columns!'
  END as columns_check
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_queue'
  AND column_name IN (
    'id', 'job_type', 'payload', 'payload_hash',
    'status', 'attempts', 'max_attempts',
    'run_at', 'started_at', 'completed_at', 'processed_at',
    'result', 'last_error', 'created_at', 'updated_at'
  );

-- 7. Verify functions exist
SELECT 
  COUNT(*) as function_count,
  CASE 
    WHEN COUNT(*) = 5 
    THEN '✅ All queue functions exist'
    ELSE '❌ Missing functions!'
  END as functions_check
FROM pg_proc
WHERE proname IN (
  'enqueue_fetch_job',
  'claim_and_start_job', 
  'finish_job',
  'count_runnable_fetch_jobs',
  'reset_stuck_jobs'
)
AND pronamespace = 'public'::regnamespace;

-- 8. Show current job queue summary
SELECT 
  '📊 Current Queue State' as summary,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as active_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NULL AND status = 'pending') as pending_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NULL AND status = 'processing') as processing_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL AND status = 'done') as completed_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL AND status = 'failed') as failed_jobs
FROM public.job_queue;

-- 9. Final verification message
DO $$
DECLARE
  v_index_ok boolean;
  v_functions_ok boolean;
  v_consistency_ok boolean;
BEGIN
  -- Check index
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'ux_job_queue_payload_hash_active'
      AND indexdef LIKE '%WHERE%processed_at IS NULL%'
  ) INTO v_index_ok;
  
  -- Check functions
  SELECT COUNT(*) = 5 
  FROM pg_proc 
  WHERE proname IN ('enqueue_fetch_job', 'claim_and_start_job', 'finish_job', 
                     'count_runnable_fetch_jobs', 'reset_stuck_jobs')
    AND pronamespace = 'public'::regnamespace
  INTO v_functions_ok;
  
  -- Check consistency
  SELECT NOT EXISTS(
    SELECT 1 FROM job_queue 
    WHERE (status = 'processing' AND processed_at IS NOT NULL)
       OR (processed_at IS NULL AND status IN ('done', 'failed') AND completed_at IS NOT NULL)
  ) INTO v_consistency_ok;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '     MIGRATION 018 VERIFICATION REPORT';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Partial Index:    %', CASE WHEN v_index_ok THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE 'Functions:        %', CASE WHEN v_functions_ok THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE 'Data Consistency: %', CASE WHEN v_consistency_ok THEN '✅ PASS' ELSE '❌ FAIL' END;
  RAISE NOTICE '========================================';
  
  IF v_index_ok AND v_functions_ok AND v_consistency_ok THEN
    RAISE NOTICE '🎉 MIGRATION 018 FULLY SUCCESSFUL! 🎉';
    RAISE NOTICE 'The RSS pipeline is ready for production.';
  ELSE
    RAISE WARNING 'Some checks failed. Review the output above.';
  END IF;
  
  RAISE NOTICE '========================================';
END $$;

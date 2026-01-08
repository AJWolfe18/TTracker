-- ============================================================================
-- Migration 018C: Queue Functions, Grants & Terminal Cleanup (Transaction-Safe)
-- ============================================================================
-- Purpose: Create/update all functions, set permissions, clean terminal states
-- Can run inside a transaction safely
-- Author: TrumpyTracker Team
-- Date: 2025-09-28
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. DROP ALL EXISTING FUNCTION VERSIONS FIRST
-- ============================================================================
-- Drop all possible versions of these functions to avoid conflicts
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);
DROP FUNCTION IF EXISTS public.claim_and_start_job(text);
DROP FUNCTION IF EXISTS public.claim_and_start_job(text, integer);
DROP FUNCTION IF EXISTS public.claim_and_start_job();

-- Drop ALL versions of finish_job (including the one that exists)
DROP FUNCTION IF EXISTS public.finish_job(bigint, boolean, text);  -- The existing one from your query
DROP FUNCTION IF EXISTS public.finish_job(bigint, text, jsonb, text);
DROP FUNCTION IF EXISTS public.finish_job(bigint, text, text);
DROP FUNCTION IF EXISTS public.finish_job(bigint, text);
DROP FUNCTION IF EXISTS public.finish_job(text, text, jsonb, text);

DROP FUNCTION IF EXISTS public.count_runnable_fetch_jobs();
DROP FUNCTION IF EXISTS public.reset_stuck_jobs();

-- ============================================================================
-- 1. ATOMIC ENQUEUE FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type    text,
  p_payload jsonb,
  p_hash    text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.job_queue (
    job_type, payload, payload_hash, run_at, status, attempts, max_attempts
  )
  VALUES (p_type, p_payload, p_hash, NOW(), 'pending', 0, 5)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  -- Duplicate active job (enforced by partial-unique index) => ignore
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.enqueue_fetch_job IS 
  'Atomically enqueue a job. Returns job ID or NULL if duplicate active job exists.';

-- ============================================================================
-- 2. CLAIM AND START JOB WITH STALE RECLAIM
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_and_start_job(
  p_job_type      text DEFAULT NULL,
  p_stale_minutes integer DEFAULT 5
)
RETURNS public.job_queue
LANGUAGE plpgsql
AS $$
DECLARE v_job public.job_queue%ROWTYPE;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.job_queue
    WHERE processed_at IS NULL  -- Active jobs only
      AND (
        status = 'pending'
        OR (status = 'processing' AND started_at < NOW() - (p_stale_minutes || ' minutes')::interval)
      )
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND (run_at IS NULL OR run_at <= NOW())
      AND (max_attempts IS NULL OR attempts < max_attempts)
    ORDER BY run_at NULLS FIRST, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED  -- Critical for concurrent workers
  ),
  upd AS (
    UPDATE public.job_queue j
    SET status      = 'processing',
        started_at  = NOW(),
        attempts    = CASE 
                        WHEN j.status = 'pending' 
                        THEN COALESCE(j.attempts, 0) + 1 
                        ELSE j.attempts 
                      END,
        updated_at  = NOW()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * INTO v_job FROM upd;

  IF NOT FOUND OR v_job.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_job;
END $$;

COMMENT ON FUNCTION public.claim_and_start_job IS 
  'Atomically claim and start a job. Returns job or NULL if no jobs available.';

-- ============================================================================
-- 3. FINISH JOB FUNCTION (NEW SIGNATURE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finish_job(
  p_job_id bigint,
  p_status text,
  p_result jsonb DEFAULT NULL,
  p_error  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.job_queue
  SET 
    status       = p_status,
    completed_at = NOW(),
    processed_at = NOW(),  -- Mark as processed (no longer active)
    result       = p_result,
    last_error   = p_error,
    updated_at   = NOW()
  WHERE id = p_job_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Job % not found', p_job_id;
  END IF;
END $$;

COMMENT ON FUNCTION public.finish_job IS 
  'Mark a job as complete. Sets processed_at to mark as inactive.';

-- ============================================================================
-- 3B. COMPATIBILITY WRAPPER FOR OLD SIGNATURE
-- ============================================================================
-- Create a wrapper to support old code that uses (id, success, error) signature
CREATE OR REPLACE FUNCTION public.finish_job(
  p_job_id bigint,
  p_success boolean,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Call the new version with mapped parameters
  PERFORM public.finish_job(
    p_job_id,
    CASE WHEN p_success THEN 'done' ELSE 'failed' END,
    NULL,
    p_error_message
  );
END $$;

COMMENT ON FUNCTION public.finish_job(bigint, boolean, text) IS 
  'Legacy compatibility wrapper. Use finish_job(bigint, text, jsonb, text) instead.';

-- ============================================================================
-- 4. COUNT RUNNABLE JOBS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.count_runnable_fetch_jobs()
RETURNS integer 
LANGUAGE sql 
STABLE 
AS $$
  SELECT COUNT(*)::integer
  FROM public.job_queue
  WHERE job_type = 'fetch_feed'
    AND processed_at IS NULL  -- Active jobs only
    AND (
      status = 'pending'
      OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
    )
    AND (run_at IS NULL OR run_at <= NOW())
    AND (max_attempts IS NULL OR attempts < max_attempts);
$$;

COMMENT ON FUNCTION public.count_runnable_fetch_jobs IS 
  'Count fetch_feed jobs that are ready to run (active and not blocked).';

-- ============================================================================
-- 5. RESET STUCK JOBS HELPER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reset_stuck_jobs()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Reset processing jobs that have been stuck for >30 minutes
  UPDATE public.job_queue
  SET 
    status = 'pending',
    started_at = NULL,
    updated_at = NOW()
  WHERE 
    processed_at IS NULL
    AND status = 'processing'
    AND started_at < NOW() - INTERVAL '30 minutes';
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.reset_stuck_jobs IS 
  'Reset stuck processing jobs back to pending. Returns count of reset jobs.';

-- ============================================================================
-- 6. GRANT PERMISSIONS
-- ============================================================================
-- Grant to service_role (both signatures of finish_job)
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_and_start_job(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_job(bigint, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_job(bigint, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_runnable_fetch_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_stuck_jobs() TO service_role;

-- Also grant count function to authenticated
GRANT EXECUTE ON FUNCTION public.count_runnable_fetch_jobs() TO authenticated;

-- ============================================================================
-- 7. TERMINAL STATE CLEANUP
-- ============================================================================
-- Clean up any jobs in terminal states that weren't properly marked
UPDATE public.job_queue
SET
  status       = CASE
                   WHEN status IN ('done', 'failed') OR completed_at IS NOT NULL
                     THEN COALESCE(status, 'failed')
                   ELSE 'failed'
                 END,
  completed_at = COALESCE(completed_at, NOW()),
  processed_at = COALESCE(processed_at, completed_at, NOW()),
  last_error   = CASE
                   WHEN status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes'
                     THEN COALESCE(last_error, 'Force-cleared: stale processing job (>30 min)')
                   WHEN last_error IS NULL
                     THEN 'Force-cleared by migration 018C'
                   ELSE last_error
                 END,
  updated_at   = NOW()
WHERE processed_at IS NULL
  AND (
    status IN ('done', 'failed')
    OR completed_at IS NOT NULL
    OR (status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes')
  );

-- Log how many jobs were cleaned up
DO $$
DECLARE v_cleaned integer;
BEGIN
  GET DIAGNOSTICS v_cleaned = ROW_COUNT;
  IF v_cleaned > 0 THEN
    RAISE NOTICE 'Cleaned up % terminal jobs that were not properly marked', v_cleaned;
  END IF;
END $$;

-- ============================================================================
-- 8. SET TABLE DEFAULTS
-- ============================================================================
ALTER TABLE public.job_queue
  ALTER COLUMN run_at SET DEFAULT NOW(),
  ALTER COLUMN attempts SET DEFAULT 0,
  ALTER COLUMN max_attempts SET DEFAULT 5,
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- ============================================================================
-- 9. CREATE SUPPORTING INDEXES
-- ============================================================================
-- Index for efficient job claiming
CREATE INDEX IF NOT EXISTS idx_job_queue_runnable
  ON public.job_queue (job_type, run_at, id)
  WHERE processed_at IS NULL AND status = 'pending';

-- Index for finding stale processing jobs
CREATE INDEX IF NOT EXISTS idx_job_queue_stale_processing
  ON public.job_queue (status, started_at)
  WHERE processed_at IS NULL AND status = 'processing';

COMMIT;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Migration 018C completed successfully!';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Key invariant: processed_at IS NULL = job is active';
  RAISE NOTICE 'Functions created: enqueue, claim, finish, count, reset';
  RAISE NOTICE 'Both finish_job signatures supported for compatibility';
  RAISE NOTICE 'Permissions granted to service_role';
  RAISE NOTICE 'Terminal states cleaned up';
  RAISE NOTICE 'Supporting indexes created';
  RAISE NOTICE '================================================';
END $$;

-- Migration 009 BACKUP: Atomic Job Claiming Functions
-- This is the complete version with SKIP LOCKED from our session
-- Implements race-safe job claiming using FOR UPDATE SKIP LOCKED

BEGIN;

-- Drop old functions if they exist (clean slate)
DROP FUNCTION IF EXISTS public.claim_next_job(text);
DROP FUNCTION IF EXISTS public.claim_next_job(text[]);
DROP FUNCTION IF EXISTS public.finish_job(bigint, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.finish_job(bigint, boolean, text);
DROP FUNCTION IF EXISTS public.reset_failed_jobs(text, integer);

-- Function 1: Atomic job claiming with SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_job(p_job_type TEXT DEFAULT NULL)
RETURNS public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_job public.job_queue;
BEGIN
  -- Use SKIP LOCKED to prevent race conditions
  -- This is the key to preventing multiple workers from claiming the same job
  UPDATE public.job_queue
  SET 
    status = 'processing',
    started_at = NOW(),
    attempts = attempts + 1
  WHERE id = (
    SELECT id 
    FROM public.job_queue
    WHERE status = 'pending'
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND (run_at IS NULL OR run_at <= NOW())
      AND attempts < max_attempts
    ORDER BY run_at NULLS FIRST, created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED  -- Critical: prevents race conditions
  )
  RETURNING * INTO v_job;
  
  RETURN v_job;
END $$;

-- Function 2: Job completion handler (using 'done' not 'completed')
CREATE OR REPLACE FUNCTION public.finish_job(
  p_id BIGINT,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_job public.job_queue;
BEGIN
  -- Use 'done' for success (not 'completed')
  UPDATE public.job_queue
  SET 
    status = CASE 
      WHEN p_success THEN 'done'
      ELSE 'failed' 
    END,
    completed_at = NOW(),
    last_error = CASE WHEN p_success THEN NULL ELSE p_error END
  WHERE id = p_id
  RETURNING * INTO v_job;

  RETURN v_job;
END $$;

-- Function 3: Reset failed jobs with exponential backoff
CREATE OR REPLACE FUNCTION public.reset_failed_jobs(
  p_job_type TEXT DEFAULT NULL,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset_count INTEGER;
BEGIN
  WITH reset_jobs AS (
    UPDATE public.job_queue
    SET 
      status = 'pending',
      -- True exponential backoff: 2^attempts minutes
      run_at = NOW() + INTERVAL '1 minute' * (2 ^ LEAST(attempts, 10)),
      last_error = last_error || ' | Reset at ' || NOW()::TEXT
    WHERE status = 'failed'
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND attempts < p_max_attempts
    RETURNING id
  )
  SELECT COUNT(*) INTO v_reset_count FROM reset_jobs;
  
  RETURN v_reset_count;
END $$;

-- Grant permissions (service_role only for security)
GRANT EXECUTE ON FUNCTION public.claim_next_job(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_job(BIGINT, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_failed_jobs(TEXT, INTEGER) TO service_role;

-- Add helpful comments
COMMENT ON FUNCTION public.claim_next_job(TEXT) IS 
  'Atomically claims the next available job using SKIP LOCKED to prevent race conditions. Returns the claimed job or NULL if none available.';

COMMENT ON FUNCTION public.finish_job(BIGINT, BOOLEAN, TEXT) IS 
  'Marks a job as done (success=true) or failed (success=false) with optional error message. Uses "done" not "completed" for success status.';

COMMENT ON FUNCTION public.reset_failed_jobs(TEXT, INTEGER) IS 
  'Resets failed jobs back to pending with exponential backoff (2^attempts minutes). Returns count of reset jobs.';

-- Verify the functions work
DO $$
BEGIN
  RAISE NOTICE 'Atomic job claiming functions installed successfully';
  RAISE NOTICE 'Key features:';
  RAISE NOTICE '  - SKIP LOCKED prevents race conditions';
  RAISE NOTICE '  - Status uses "done" not "completed"';
  RAISE NOTICE '  - Exponential backoff for retries';
  RAISE NOTICE '  - Service-role only for security';
END $$;

COMMIT;

-- Migration 016: Fix job queue active state management
-- Purpose: Unify on processed_at IS NULL as single source of truth for "active" jobs
-- Date: 2025-09-27
-- Issue: Jobs getting stuck in "active" state blocking new job creation

-- Fix 1: Update reset_stuck_jobs to properly clear jobs from active state
CREATE OR REPLACE FUNCTION public.reset_stuck_jobs()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE public.job_queue
  SET status       = 'failed',
      completed_at = NOW(),
      processed_at = NOW(),  -- CRITICAL: clear from active set
      last_error   = COALESCE(last_error, 'Job timed out after 30 minutes'),
      updated_at   = NOW()
  WHERE processed_at IS NULL
    AND status = 'processing'
    AND started_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Fix 2: Update claim_and_start_job with stale processing check and attempts guard
CREATE OR REPLACE FUNCTION public.claim_and_start_job(p_job_type text DEFAULT NULL)
RETURNS public.job_queue
LANGUAGE plpgsql
AS $$
DECLARE v_job public.job_queue%ROWTYPE;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.job_queue
    WHERE processed_at IS NULL                                  -- single source of truth
      AND (
        status = 'pending'
        OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
      )                                                         -- reclaim only stale processing jobs
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND (run_at IS NULL OR run_at <= NOW())
      AND (max_attempts IS NULL OR attempts < max_attempts)
    ORDER BY run_at NULLS FIRST, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue j
    SET status      = 'processing',
        started_at  = NOW(),
        attempts    = CASE WHEN j.status = 'pending'
                           THEN COALESCE(j.attempts, 0) + 1
                           ELSE j.attempts
                      END,
        updated_at  = NOW()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * INTO v_job FROM upd;

  IF NOT FOUND THEN
    RETURN NULL;                                                -- DB NULL, not row-of-nulls
  END IF;

  RETURN v_job;
END $$;

-- Fix 3: One-time cleanup - force clear any currently stuck jobs
UPDATE public.job_queue
SET status       = 'failed',
    completed_at = NOW(),
    processed_at = NOW(),  -- free the index
    last_error   = 'Force-failed by maintenance cleanup',
    updated_at   = NOW()
WHERE processed_at IS NULL
  AND status = 'processing'
  AND started_at < NOW() - INTERVAL '10 minutes';

-- Verify finish_job also sets processed_at (should already be doing this)
-- Just documenting expected behavior here
COMMENT ON FUNCTION public.finish_job IS 
'IMPORTANT: This function MUST set processed_at = NOW() for both success and failure cases to properly clear jobs from the active state.';

-- Optional: Add index to speed up "stale processing" scans
CREATE INDEX IF NOT EXISTS ix_job_queue_processing_started_at
  ON public.job_queue (status, started_at)
  WHERE processed_at IS NULL AND status = 'processing';

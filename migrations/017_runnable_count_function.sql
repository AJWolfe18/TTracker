-- Migration 017: Add server-side runnable count function
-- Purpose: Single source of truth for counting runnable jobs
-- Fixes PostgREST limitation of only one .or() group per query
-- Date: 2025-09-28

-- Create function to count runnable fetch_feed jobs
-- This matches EXACTLY the claim predicate in claim_and_start_job
CREATE OR REPLACE FUNCTION public.count_runnable_fetch_jobs()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM public.job_queue
  WHERE job_type = 'fetch_feed'
    AND processed_at IS NULL
    AND (
      status = 'pending'
      OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
    )
    AND (run_at IS NULL OR run_at <= NOW())
    AND (max_attempts IS NULL OR attempts < max_attempts);
$$;

-- Grant execute permission to authenticated and service role
GRANT EXECUTE ON FUNCTION public.count_runnable_fetch_jobs() TO authenticated, service_role;

-- Optional: Function to list runnable jobs (for debugging)
CREATE OR REPLACE FUNCTION public.list_runnable_fetch_jobs()
RETURNS TABLE(
  id bigint,
  job_type text,
  status text,
  attempts integer,
  max_attempts integer,
  run_at timestamptz,
  started_at timestamptz,
  processed_at timestamptz,
  last_error text
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, job_type, status, attempts, max_attempts, 
         run_at, started_at, processed_at, last_error
  FROM public.job_queue
  WHERE job_type = 'fetch_feed'
    AND processed_at IS NULL
    AND (
      status = 'pending'
      OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
    )
    AND (run_at IS NULL OR run_at <= NOW())
    AND (max_attempts IS NULL OR attempts < max_attempts)
  ORDER BY run_at NULLS FIRST, id;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.list_runnable_fetch_jobs() TO authenticated, service_role;

-- Diagnostic: Show what's actually in the queue
CREATE OR REPLACE FUNCTION public.diagnose_job_queue()
RETURNS TABLE(
  id bigint,
  job_type text,
  status text,
  attempts integer,
  max_attempts integer,
  run_at timestamptz,
  started_at timestamptz,
  processed_at timestamptz,
  is_active boolean,
  is_runnable boolean,
  blocker text
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    id, 
    job_type, 
    status, 
    attempts, 
    max_attempts,
    run_at, 
    started_at, 
    processed_at,
    (processed_at IS NULL) as is_active,
    (processed_at IS NULL 
     AND (status = 'pending' OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes'))
     AND (run_at IS NULL OR run_at <= NOW())
     AND (max_attempts IS NULL OR attempts < max_attempts)) as is_runnable,
    CASE 
      WHEN processed_at IS NOT NULL THEN 'already_processed'
      WHEN status = 'processing' AND started_at >= NOW() - INTERVAL '5 minutes' THEN 'processing_fresh'
      WHEN run_at IS NOT NULL AND run_at > NOW() THEN 'future_run_at'
      WHEN max_attempts IS NOT NULL AND attempts >= max_attempts THEN 'max_attempts_reached'
      ELSE 'runnable'
    END as blocker
  FROM public.job_queue
  WHERE job_type = 'fetch_feed'
  ORDER BY processed_at IS NULL DESC, status, run_at NULLS FIRST, id
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_job_queue() TO authenticated, service_role;

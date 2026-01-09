BEGIN;

-- 0. ENSURE PARTIAL UNIQUE INDEX EXISTS (prerequisite)
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- 1. ATOMIC SEEDING - Remove race condition by making enqueue_fetch_job truly atomic
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);

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
  -- Try the insert; if a duplicate active job (processed_at IS NULL) exists,
  -- the partial unique index raises unique_violation.
  INSERT INTO public.job_queue (
    job_type, payload, payload_hash, run_at, status, attempts, max_attempts
  ) VALUES (
    p_type, p_payload, p_hash, NOW(), 'pending', 0, 5
  )
  RETURNING id INTO v_id;

  RETURN v_id;

EXCEPTION
  WHEN unique_violation THEN
    -- Another process just enqueued the same active job. That's fine.
    RETURN NULL;
END $$;

-- 2. BETTER CLAIM FUNCTION - Configurable stale window
DROP FUNCTION IF EXISTS public.claim_and_start_job(text);
DROP FUNCTION IF EXISTS public.claim_and_start_job(text, integer);

CREATE OR REPLACE FUNCTION public.claim_and_start_job(
  p_job_type     text DEFAULT NULL,
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
    WHERE processed_at IS NULL
      AND (
        status = 'pending'
        OR (status = 'processing' AND started_at < NOW() - (p_stale_minutes || ' minutes')::interval)
      )
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
                           ELSE j.attempts END,
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

-- 3. ENSURE COUNT FUNCTION EXISTS
CREATE OR REPLACE FUNCTION public.count_runnable_fetch_jobs()
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::integer
  FROM public.job_queue
  WHERE job_type = 'fetch_feed'
    AND processed_at IS NULL
    AND ( status = 'pending'
          OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes') )
    AND (run_at IS NULL OR run_at <= NOW())
    AND (max_attempts IS NULL OR attempts < max_attempts);
$$;

-- 4. DYNAMIC GRANTS - Handle any function signature
-- Note: Only granting enqueue_fetch_job to service_role for security
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname IN ('finish_job','claim_and_start_job','count_runnable_fetch_jobs','enqueue_fetch_job')
      AND pronamespace = 'public'::regnamespace
  LOOP
    -- Grant to service_role for all functions
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    
    -- Grant to authenticated ONLY for read-only functions
    IF r.sig::text LIKE '%count_runnable%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    
    -- NOT granting enqueue to authenticated (security: only service_role should enqueue)
  END LOOP;
END $$;

-- 5. COMPLETE TERMINAL CLEANUP - Handle all cases coherently
UPDATE public.job_queue
SET
  status       = CASE
                   WHEN status IN ('done','failed') OR completed_at IS NOT NULL
                     THEN status
                   ELSE 'failed'  -- Mark stale processing as failed
                 END,
  completed_at = COALESCE(completed_at, NOW()),
  processed_at = COALESCE(processed_at, completed_at, NOW()),
  last_error   = CASE
                   WHEN status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes'
                     THEN COALESCE(last_error, 'Force-cleared: stale processing job (>30 min)')
                   WHEN last_error IS NULL
                     THEN 'Force-cleared by migration 020'
                   ELSE last_error
                 END,
  updated_at   = NOW()
WHERE processed_at IS NULL
  AND (
    status IN ('done','failed')
    OR completed_at IS NOT NULL
    OR (status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes')
  );

-- 6. TABLE DEFAULTS for consistency
ALTER TABLE public.job_queue
  ALTER COLUMN run_at SET DEFAULT NOW(),
  ALTER COLUMN attempts SET DEFAULT 0,
  ALTER COLUMN max_attempts SET DEFAULT 5;

-- 7. VERIFY everything works (with proper cleanup)
DO $$
DECLARE v_id bigint;
BEGIN
  -- Test atomic enqueue (create, then delete)
  SELECT enqueue_fetch_job('test', '{"test":true}'::jsonb, 'test-verify-' || md5(random()::text)) INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_fetch_job should return an ID for new jobs';
  END IF;
  
  -- Verify it was created
  PERFORM 1 FROM public.job_queue WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test job was not created';
  END IF;
  
  -- Clean up test job immediately
  DELETE FROM public.job_queue WHERE id = v_id;
  
  -- Test claim returns NULL for nonexistent
  IF (SELECT claim_and_start_job('nonexistent-type', 5)) IS NOT NULL THEN
    RAISE EXCEPTION 'claim_and_start_job should return NULL for no jobs';
  END IF;
  
  -- Test count function returns a number
  IF (SELECT count_runnable_fetch_jobs()) IS NULL THEN
    RAISE EXCEPTION 'count_runnable_fetch_jobs should return a number';
  END IF;
  
  RAISE NOTICE '✓ All functions verified and test data cleaned up';
END $$;

-- 8. Show final state
SELECT 
  'Migration 020 complete' as status,
  count_runnable_fetch_jobs() as runnable_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as active_jobs,
  COUNT(*) FILTER (WHERE status = 'done') as completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs
FROM job_queue
WHERE job_type = 'fetch_feed';

-- 9. Final verification: No orphaned test data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM job_queue WHERE job_type = 'test' AND processed_at IS NULL) THEN
    RAISE WARNING 'Found orphaned test jobs - cleaning up';
    UPDATE job_queue 
    SET processed_at = NOW(), 
        status = 'failed',
        last_error = 'Test job - auto cleaned'
    WHERE job_type = 'test' AND processed_at IS NULL;
  END IF;
END $$;

COMMIT;

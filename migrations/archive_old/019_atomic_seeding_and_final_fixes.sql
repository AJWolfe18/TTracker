BEGIN;

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

-- 3. ENSURE COUNT FUNCTION EXISTS (from migration 018)
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
    
    -- Grant to authenticated for read-only functions
    IF r.sig::text LIKE '%count_runnable%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    
    -- Also grant enqueue to authenticated for CI
    IF r.sig::text LIKE '%enqueue_fetch_job%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- 5. COMPLETE TERMINAL CLEANUP - Handle all cases
UPDATE public.job_queue
SET processed_at = COALESCE(processed_at, completed_at, NOW())
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

-- 7. VERIFY everything works
DO $$
BEGIN
  -- Test atomic enqueue
  IF (SELECT enqueue_fetch_job('test', '{"test":true}'::jsonb, 'test-' || NOW()::text)) IS NULL THEN
    RAISE EXCEPTION 'enqueue_fetch_job should return an ID for new jobs';
  END IF;
  
  -- Test claim returns NULL for nonexistent
  IF (SELECT claim_and_start_job('nonexistent-type', 5)) IS NOT NULL THEN
    RAISE EXCEPTION 'claim_and_start_job should return NULL for no jobs';
  END IF;
  
  -- Test count function
  IF (SELECT count_runnable_fetch_jobs()) IS NULL THEN
    RAISE EXCEPTION 'count_runnable_fetch_jobs should return a number';
  END IF;
  
  RAISE NOTICE '✓ All functions working correctly';
END $$;

-- 8. Show final state
SELECT 
  'Migration 019 complete' as status,
  count_runnable_fetch_jobs() as runnable_jobs,
  COUNT(*) FILTER (WHERE processed_at IS NULL) as active_jobs,
  COUNT(*) FILTER (WHERE status = 'done') as completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs
FROM job_queue
WHERE job_type = 'fetch_feed';

COMMIT;

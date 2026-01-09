-- Migration 012: Robust job lifecycle (claim/start/finish/timeout) + indexes
-- Fixes TTRC-172: jobs completing but staying 'pending'
-- Fixed version - PostgreSQL compatible

BEGIN;

-- 0) Ensure required columns exist (idempotent)
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS status       TEXT,
  ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error        TEXT,
  ADD COLUMN IF NOT EXISTS last_error   TEXT,
  ADD COLUMN IF NOT EXISTS result       JSONB,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts     INTEGER,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER,
  ADD COLUMN IF NOT EXISTS run_at       TIMESTAMPTZ;

-- Defaults / backfill (do not overwrite existing values)
UPDATE public.job_queue
SET status = COALESCE(status, 'pending')
WHERE status IS NULL;

UPDATE public.job_queue
SET attempts = COALESCE(attempts, 0)
WHERE attempts IS NULL;

UPDATE public.job_queue
SET max_attempts = COALESCE(max_attempts, 5)
WHERE max_attempts IS NULL;

UPDATE public.job_queue
SET run_at = COALESCE(run_at, NOW())
WHERE run_at IS NULL;

UPDATE public.job_queue
SET updated_at = COALESCE(updated_at, NOW())
WHERE updated_at IS NULL;

-- Status constraint (pending|processing|done|failed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_queue_status_check'
      AND conrelid = 'public.job_queue'::regclass
  ) THEN
    ALTER TABLE public.job_queue
    ADD CONSTRAINT job_queue_status_check
      CHECK (status IN ('pending','processing','done','failed'));
  END IF;
END $$;

-- 1) finish_job: ALWAYS update status and timestamps coherently
CREATE OR REPLACE FUNCTION public.finish_job(
  p_job_id  BIGINT,
  p_status  TEXT,                    -- 'done' | 'failed'
  p_result  JSONB DEFAULT NULL,
  p_error   TEXT  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_status NOT IN ('done','failed') THEN
    RAISE EXCEPTION 'finish_job: invalid status %, expected done|failed', p_status;
  END IF;

  UPDATE public.job_queue j
  SET
    status       = p_status,
    completed_at = NOW(),
    processed_at = COALESCE(j.processed_at, NOW()),
    -- keep one canonical error; mirror into both for backward-compat
    last_error   = CASE WHEN p_status = 'failed'
                        THEN COALESCE(p_error, j.last_error, j.error, 'Job failed')
                        ELSE NULL
                   END,
    error        = CASE WHEN p_status = 'failed'
                        THEN COALESCE(p_error, j.error, 'Job failed')
                        ELSE NULL
                   END,
    result       = COALESCE(p_result, j.result),
    started_at   = CASE WHEN p_status IN ('done','failed') THEN NULL ELSE j.started_at END,
    updated_at   = NOW()
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE WARNING 'finish_job: No job found with id %', p_job_id;
  END IF;
END $$;

-- 2) reset_stuck_jobs: timeout processing/pending older than 30 minutes since start
CREATE OR REPLACE FUNCTION public.reset_stuck_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total  INTEGER := 0;
  v_fixed  INTEGER := 0;
BEGIN
  -- Fix 1: Jobs that already have completed_at but wrong status -> normalize
  UPDATE public.job_queue
  SET status = CASE WHEN error IS NULL THEN 'done' ELSE 'failed' END,
      updated_at = NOW()
  WHERE status IN ('pending','processing')
    AND completed_at IS NOT NULL;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  v_total := v_total + v_fixed;
  IF v_fixed > 0 THEN
    RAISE NOTICE 'Fixed % jobs with completed_at but wrong status', v_fixed;
  END IF;

  -- Fix 2: Jobs stuck in processing/pending (claimed) > 30 minutes
  UPDATE public.job_queue
  SET 
    status       = 'failed',
    completed_at = NOW(),
    processed_at = COALESCE(processed_at, NOW()),
    last_error   = COALESCE(last_error, 'Job timed out after 30 minutes'),
    error        = COALESCE(error, 'Job timed out after 30 minutes'),
    updated_at   = NOW()
  WHERE status IN ('processing','pending')
    AND started_at IS NOT NULL
    AND completed_at IS NULL
    AND started_at < NOW() - INTERVAL '30 minutes';

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  v_total := v_total + v_fixed;
  IF v_fixed > 0 THEN
    RAISE NOTICE 'Timed out % stuck jobs', v_fixed;
  END IF;

  RETURN v_total;
END $$;

COMMENT ON FUNCTION public.reset_stuck_jobs() IS
  'Call at worker start (or via pg_cron) to normalize and time out stuck jobs.';

-- 3) claim_and_start_job: race-safe claim with SKIP LOCKED and return full row
-- Fixed: Using table return type instead of %ROWTYPE
CREATE OR REPLACE FUNCTION public.claim_and_start_job(
  p_job_type TEXT DEFAULT NULL
)
RETURNS job_queue
LANGUAGE plpgsql
AS $$
DECLARE
  v_job job_queue;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'pending'
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND (run_at IS NULL OR run_at <= NOW())
      AND (max_attempts IS NULL OR attempts < max_attempts)
    ORDER BY run_at, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue j
    SET
      status     = 'processing',
      started_at = NOW(),
      attempts   = COALESCE(attempts, 0) + 1,
      updated_at = NOW()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * INTO v_job FROM upd;

  RETURN v_job;  -- NULL if none available
END $$;

-- 4) Helpful partial indexes for queue operations
CREATE INDEX IF NOT EXISTS ix_job_queue_pending_run
  ON public.job_queue (run_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ix_job_queue_processing_started
  ON public.job_queue (started_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS ix_job_queue_processed_at
  ON public.job_queue (processed_at);

-- 5) Run cleanup immediately (safe)
SELECT public.reset_stuck_jobs();

-- 6) Show current state (fixed DO block with DECLARE)
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE 'Current job queue summary (by status):';
  FOR r IN
    SELECT status, COUNT(*) AS cnt
    FROM public.job_queue
    GROUP BY status
    ORDER BY status
  LOOP
    RAISE NOTICE '  %: %', r.status, r.cnt;
  END LOOP;
END $$;

COMMIT;

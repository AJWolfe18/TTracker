-- Migration 013: Partial unique index on active jobs only
-- Allows re-queuing same feed after completion while preventing duplicate active jobs

BEGIN;

-- Drop existing constraints
ALTER TABLE public.job_queue 
  DROP CONSTRAINT IF EXISTS job_queue_type_payload_unique;

DROP INDEX IF EXISTS ux_job_queue_payload_hash;
DROP INDEX IF EXISTS idx_job_queue_type_payload_unique;
DROP INDEX IF EXISTS ux_job_queue_payload_hash_active;

-- Create partial unique index - only blocks duplicates where processed_at IS NULL
CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

COMMIT;

-- RPC for atomic job enqueue
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type   text,
  p_payload jsonb,
  p_hash    text
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.job_queue (job_type, payload, payload_hash, run_at, status, attempts, max_attempts)
  VALUES (p_type, p_payload, p_hash, NOW(), 'pending', 0, 5)
  ON CONFLICT ON CONSTRAINT ux_job_queue_payload_hash_active DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL if an active job already exists
END $$;

-- Migration 006: P1 Critical Fixes - Align job_queue schema for production
-- SR Dev approved migration to fix all schema issues
-- MUST RUN THIS BEFORE TTRC-137 WILL WORK!

BEGIN;

-- Enable pgcrypto for hash generation if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Align columns (non-destructive) - keeping old columns for 1 week
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS job_type TEXT,
  ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ;

-- Backfill from legacy fields if present
UPDATE public.job_queue
SET job_type = COALESCE(job_type, type),
    run_at = COALESCE(run_at, run_after)
WHERE job_type IS NULL OR run_at IS NULL;

-- Make job_type NOT NULL after backfill
ALTER TABLE public.job_queue 
  ALTER COLUMN job_type SET NOT NULL;

-- Add idempotency hash as GENERATED column (sha256)
ALTER TABLE public.job_queue
  DROP COLUMN IF EXISTS payload_hash;

ALTER TABLE public.job_queue
  ADD COLUMN payload_hash TEXT
  GENERATED ALWAYS AS (encode(digest(COALESCE(payload::text, ''), 'sha256'), 'hex')) STORED;

-- Drop old constraint if exists
ALTER TABLE public.job_queue 
  DROP CONSTRAINT IF EXISTS job_queue_type_payload_hash_key,
  DROP CONSTRAINT IF EXISTS job_queue_jobtype_payload_hash_key;

-- Create unique index for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_jobtype_phash
  ON public.job_queue(job_type, payload_hash);

-- Worker readiness indexes
DROP INDEX IF EXISTS idx_queue_pending;
DROP INDEX IF EXISTS idx_queue_pending_v2;

CREATE INDEX IF NOT EXISTS idx_job_queue_ready
  ON public.job_queue(status, run_at) 
  WHERE status = 'pending';

-- Stats aggregation index
CREATE INDEX IF NOT EXISTS idx_job_queue_status_type
  ON public.job_queue(status, job_type);

-- Update the claim_next_job function to use new column names
CREATE OR REPLACE FUNCTION claim_next_job(job_types text[])
RETURNS TABLE (
  id bigint,
  job_type text,
  payload jsonb,
  attempts int
) AS $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Select and lock the next available job
  SELECT jq.id INTO v_job_id
  FROM job_queue jq
  WHERE jq.status = 'pending'
    AND jq.job_type = ANY(job_types)
    AND (jq.run_at IS NULL OR jq.run_at <= NOW())
  ORDER BY jq.run_at, jq.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Update job status
  UPDATE job_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE job_queue.id = v_job_id;
  
  -- Return job details with correct column names
  RETURN QUERY
  SELECT jq.id, jq.job_type, jq.payload, jq.attempts
  FROM job_queue jq
  WHERE jq.id = v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION claim_next_job(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_next_job(text[]) TO service_role;

COMMENT ON FUNCTION claim_next_job(text[]) IS 'Claims next available job for processing with proper locking';

-- Add comment about old columns removal
COMMENT ON COLUMN job_queue.type IS 'DEPRECATED: Will be removed after 2025-09-25. Use job_type instead';
COMMENT ON COLUMN job_queue.run_after IS 'DEPRECATED: Will be removed after 2025-09-25. Use run_at instead';

-- Add stats function for queue monitoring
CREATE OR REPLACE FUNCTION get_queue_stats()
RETURNS TABLE (
  job_type TEXT,
  pending BIGINT,
  processing BIGINT,
  completed BIGINT,
  failed BIGINT,
  next_run_at TIMESTAMPTZ,
  oldest_pending TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jq.job_type,
    COUNT(*) FILTER (WHERE jq.status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE jq.status = 'processing') AS processing,
    COUNT(*) FILTER (WHERE jq.status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE jq.status = 'failed') AS failed,
    MIN(jq.run_at) FILTER (WHERE jq.status = 'pending') AS next_run_at,
    MIN(jq.run_at) FILTER (WHERE jq.status = 'pending') AS oldest_pending
  FROM job_queue jq
  GROUP BY jq.job_type
  ORDER BY jq.job_type;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission for anon users (read-only stats)
GRANT EXECUTE ON FUNCTION get_queue_stats() TO anon;

COMMENT ON FUNCTION get_queue_stats() IS 'Returns job queue statistics grouped by job type for monitoring';

COMMIT;

-- Verification query (run after migration):
-- SELECT 
--   column_name,
--   data_type,
--   is_nullable,
--   generation_expression IS NOT NULL as is_generated
-- FROM information_schema.columns 
-- WHERE table_name = 'job_queue' 
--   AND column_name IN ('job_type', 'run_at', 'payload_hash')
-- ORDER BY column_name;

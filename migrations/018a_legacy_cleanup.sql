-- ============================================================================
-- Migration 018A: Legacy Cleanup (Transaction-Safe)
-- ============================================================================
-- Purpose: Clean up old indexes and ensure columns exist
-- Can run inside a transaction safely
-- Author: TrumpyTracker Team
-- Date: 2025-09-28
-- ============================================================================

BEGIN;

-- Drop legacy indexes/constraints from previous migration attempts
DROP INDEX IF EXISTS ux_job_queue_payload_hash;
DROP INDEX IF EXISTS idx_job_queue_payload_hash_active;
DROP INDEX IF EXISTS ux_job_queue_payload_hash_active; -- Drop old version if exists

ALTER TABLE public.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_type_payload_unique;

-- Ensure all required columns exist (handle schema drift)
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS job_type       text,
  ADD COLUMN IF NOT EXISTS processed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS status         text,
  ADD COLUMN IF NOT EXISTS attempts       int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts   int DEFAULT 5,
  ADD COLUMN IF NOT EXISTS payload        jsonb,
  ADD COLUMN IF NOT EXISTS payload_hash   text,
  ADD COLUMN IF NOT EXISTS run_at         timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS result         jsonb,
  ADD COLUMN IF NOT EXISTS last_error     text,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT NOW();

-- Add CHECK constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_queue_status_check'
      AND conrelid = 'public.job_queue'::regclass
  ) THEN
    ALTER TABLE public.job_queue
      ADD CONSTRAINT job_queue_status_check
      CHECK (status IN ('pending', 'processing', 'done', 'failed'));
  END IF;
END $$;

COMMIT;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 018A completed: Legacy cleanup successful';
END $$;

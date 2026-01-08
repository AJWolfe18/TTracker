-- Migration 008 BACKUP: Job Queue Critical Columns
-- This is the complete version with all fixes from our session
-- Fixes column naming issues and adds missing fields

BEGIN;

-- Add job_type column (rename from type or add new)
DO $$
BEGIN
  -- Check if job_type column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_queue' 
    AND column_name = 'job_type'
  ) THEN
    -- If type column exists, rename it to job_type
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'type'
    ) THEN
      ALTER TABLE job_queue RENAME COLUMN type TO job_type;
    ELSE
      -- If neither exists, add job_type column
      ALTER TABLE job_queue ADD COLUMN job_type TEXT NOT NULL DEFAULT 'fetch_feed';
    END IF;
  END IF;
END $$;

-- Add all critical columns if they don't exist
ALTER TABLE job_queue 
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT GENERATED ALWAYS AS (encode(sha256(payload::text::bytea), 'hex')) STORED,
  ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Rename run_after to run_at if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_queue' 
    AND column_name = 'run_after'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_queue' 
    AND column_name = 'run_at'
  ) THEN
    ALTER TABLE job_queue RENAME COLUMN run_after TO run_at;
  END IF;
END $$;

-- Fix status values: 'completed' -> 'done'
UPDATE job_queue 
SET status = 'done' 
WHERE status = 'completed';

-- Update the check constraint to use correct status values
ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS job_queue_status_check;
ALTER TABLE job_queue ADD CONSTRAINT job_queue_status_check 
  CHECK (status IN ('pending', 'processing', 'done', 'failed'));

-- Create indexes for efficient job claiming
CREATE INDEX IF NOT EXISTS idx_job_queue_pending_runAt 
  ON job_queue(status, run_at) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_queue_processing 
  ON job_queue(status, started_at) 
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_job_queue_type_status
  ON job_queue(job_type, status);

-- Create unique constraint for deduplication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'job_queue_type_payload_unique'
  ) THEN
    BEGIN
      ALTER TABLE job_queue 
      ADD CONSTRAINT job_queue_type_payload_unique 
      UNIQUE(job_type, payload_hash);
    EXCEPTION WHEN OTHERS THEN
      -- Ignore if it fails due to duplicates
      RAISE NOTICE 'Could not create unique constraint - duplicates may exist';
    END;
  END IF;
END $$;

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_job_queue_updated_at ON job_queue;
CREATE TRIGGER update_job_queue_updated_at 
  BEFORE UPDATE ON job_queue 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;

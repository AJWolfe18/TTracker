-- Job Queue Claim Function for Worker
-- This function allows the worker to atomically claim jobs
-- Run this in Supabase SQL Editor on TEST environment

-- Create the claim_next_job function
CREATE OR REPLACE FUNCTION claim_next_job(job_types text[])
RETURNS TABLE (
  id bigint,
  type text,
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
    AND jq.type = ANY(job_types)
    AND (jq.next_retry_at IS NULL OR jq.next_retry_at <= NOW())
  ORDER BY jq.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Update job status to processing
  UPDATE job_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE job_queue.id = v_job_id;
  
  -- Return job details
  RETURN QUERY
  SELECT jq.id, jq.type, jq.payload, jq.attempts
  FROM job_queue jq
  WHERE jq.id = v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION claim_next_job(text[]) TO service_role;

-- Create helper function to enqueue jobs with idempotency
CREATE OR REPLACE FUNCTION enqueue_job(
  p_type text,
  p_payload jsonb,
  p_priority int DEFAULT 5
) RETURNS bigint AS $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Try to insert with idempotency check
  INSERT INTO job_queue (type, payload, priority)
  VALUES (p_type, p_payload, p_priority)
  ON CONFLICT (type, payload) DO UPDATE
    SET updated_at = NOW()
  RETURNING id INTO v_job_id;
  
  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION enqueue_job(text, jsonb, int) TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_job(text, jsonb, int) TO anon;

-- Create index for efficient job claiming
CREATE INDEX IF NOT EXISTS idx_job_queue_pending 
ON job_queue(status, created_at) 
WHERE status = 'pending';

-- Create index for retry scheduling
CREATE INDEX IF NOT EXISTS idx_job_queue_retry 
ON job_queue(next_retry_at) 
WHERE status = 'pending' AND next_retry_at IS NOT NULL;

-- Add missing columns if they don't exist
ALTER TABLE job_queue 
ADD COLUMN IF NOT EXISTS priority int DEFAULT 5,
ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
ADD COLUMN IF NOT EXISTS result jsonb,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- Create unique constraint for idempotency if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'job_queue_type_payload_key'
  ) THEN
    ALTER TABLE job_queue 
    ADD CONSTRAINT job_queue_type_payload_key 
    UNIQUE(type, payload);
  END IF;
END $$;

-- Test the functions
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Enqueue a test job
  v_job_id := enqueue_job(
    'story.summarize',
    '{"story_id": "test-story-1", "mode": "neutral"}'::jsonb
  );
  RAISE NOTICE 'Test job enqueued with ID: %', v_job_id;
END $$;

-- Verify job queue is ready
SELECT 
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs
FROM job_queue;

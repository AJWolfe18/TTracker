-- ============================================================================
-- Migration 018E: Fix GENERATED payload_hash column
-- ============================================================================
-- Purpose: Convert GENERATED column to regular column to allow manual insertion
-- Author: TrumpyTracker Team
-- Date: 2025-09-28
-- ============================================================================

BEGIN;

-- Step 1: Drop the existing partial unique index (will be recreated)
DROP INDEX IF EXISTS ux_job_queue_payload_hash_active;

-- Step 2: Create a new regular column with temporary name
ALTER TABLE public.job_queue 
  ADD COLUMN payload_hash_new text;

-- Step 3: Copy existing hash values to new column
UPDATE public.job_queue 
SET payload_hash_new = payload_hash;

-- Step 4: Drop the GENERATED column
ALTER TABLE public.job_queue 
  DROP COLUMN payload_hash;

-- Step 5: Rename new column to original name
ALTER TABLE public.job_queue 
  RENAME COLUMN payload_hash_new TO payload_hash;

-- Step 6: Recreate the partial unique index
CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- Step 7: Update enqueue function to generate hash when needed
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type    text,
  p_payload jsonb,
  p_hash    text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE 
  v_id bigint;
  v_hash text;
BEGIN
  -- Generate hash if not provided (using md5 to match previous GENERATED column)
  v_hash := COALESCE(p_hash, md5(p_payload::text));
  
  INSERT INTO public.job_queue (
    job_type, 
    payload, 
    payload_hash, 
    run_at, 
    status, 
    attempts, 
    max_attempts
  )
  VALUES (
    p_type, 
    p_payload, 
    v_hash, 
    NOW(), 
    'pending', 
    0, 
    5
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
  
EXCEPTION WHEN unique_violation THEN
  -- Duplicate active job (enforced by partial-unique index) => ignore
  RETURN NULL;
END $$;

-- Grant permission
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb, text) TO service_role;

COMMIT;

-- Verify the fix
DO $$
DECLARE
  v_generated text;
BEGIN
  SELECT is_generated 
  INTO v_generated
  FROM information_schema.columns 
  WHERE table_name = 'job_queue' 
    AND column_name = 'payload_hash';
    
  IF v_generated = 'NEVER' OR v_generated IS NULL THEN
    RAISE NOTICE '✅ SUCCESS: payload_hash is now a regular column';
    RAISE NOTICE 'RSS seeding should work properly now!';
  ELSE
    RAISE WARNING '❌ Column is still GENERATED: %', v_generated;
  END IF;
END $$;

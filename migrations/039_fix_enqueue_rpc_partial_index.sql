-- Migration 039: Fix enqueue_fetch_job RPC syntax for partial unique index
-- Fixes: QA idempotency test failure
-- Root causes:
-- 1. Migration 013 used ON CONFLICT ON CONSTRAINT which doesn't work with indexes
-- 2. Migration 013 tried to INSERT into payload_hash, but it's a GENERATED ALWAYS column
-- This migration uses the correct syntax and removes the payload_hash insert

BEGIN;

-- Drop and recreate the function with corrected syntax
-- REMOVED: p_hash parameter - payload_hash is auto-generated from payload
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type    text,
  p_payload jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_id BIGINT;
BEGIN
  -- Note: payload_hash is GENERATED ALWAYS from payload, so we don't insert it
  INSERT INTO public.job_queue (job_type, payload, run_at, status, attempts, max_attempts)
  VALUES (p_type, p_payload, NOW(), 'pending', 0, 5)
  -- FIXED: Use column list with WHERE clause instead of constraint name
  -- The partial unique index is: (job_type, payload_hash) WHERE processed_at IS NULL
  ON CONFLICT (job_type, payload_hash) WHERE processed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL if an active job already exists
END $$;

-- Grant execute permission (new signature: 2 params instead of 3)
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO service_role;

-- Drop the old 3-param version if it exists
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);

COMMIT;

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'Migration 039 complete: enqueue_fetch_job RPC fixed';
  RAISE NOTICE 'The function now correctly uses ON CONFLICT with partial index';
END $$;

-- Migration 014: Fix claim_and_start_job to return NULL properly
-- Date: 2025-09-27
-- Issue: Function was returning row with null fields instead of database NULL
-- Run after: 013_fix_payload_hash_partial_unique.sql

CREATE OR REPLACE FUNCTION public.claim_and_start_job(p_job_type text DEFAULT NULL)
RETURNS public.job_queue
LANGUAGE plpgsql
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
BEGIN
  WITH candidate AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'pending'
      AND processed_at IS NULL                 -- aligns with "active" semantics
      AND (p_job_type IS NULL OR job_type = p_job_type)
      AND (run_at IS NULL OR run_at <= NOW())
      AND (max_attempts IS NULL OR attempts < max_attempts)
    ORDER BY run_at NULLS FIRST, id            -- ensure NULL run_at are chosen first
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue j
    SET status      = 'processing',
        started_at  = NOW(),
        attempts    = COALESCE(attempts, 0) + 1,
        updated_at = NOW()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * INTO v_job FROM upd;

  -- Return database NULL when nothing was claimed
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_job;
END $$;

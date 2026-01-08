-- Migration 015: Add monitoring indexes and helper functions
-- Date: 2025-09-27
-- Purpose: Performance optimization and maintenance functions
-- Run after: 014_fix_claim_returns_null.sql

-- ============================================
-- MONITORING INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS ix_job_queue_type_created
  ON public.job_queue (job_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_job_queue_status_completed_at
  ON public.job_queue (status, completed_at);

CREATE INDEX IF NOT EXISTS ix_articles_created_source
  ON public.articles (created_at DESC, source_name);

-- ============================================
-- RESET_STUCK_JOBS FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.reset_stuck_jobs(p_timeout_minutes INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_reset_count INTEGER;
BEGIN
  UPDATE public.job_queue
  SET status = 'pending',
      started_at = NULL,
      attempts = GREATEST(0, attempts - 1),  -- Give it another chance
      updated_at = NOW()
  WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '1 minute' * p_timeout_minutes
    AND processed_at IS NULL;
    
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN v_reset_count;
END $$;

-- ============================================
-- CLEANUP OLD JOBS FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.cleanup_old_jobs()
RETURNS INTEGER 
LANGUAGE plpgsql 
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.job_queue
  WHERE id IN (
    SELECT id 
    FROM public.job_queue
    WHERE completed_at < NOW() - INTERVAL '30 days'
      AND status IN ('done', 'failed')
      AND processed_at IS NOT NULL
    LIMIT 10000
  );
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

-- ============================================
-- VERIFICATION: Check all functions exist
-- ============================================
DO $$
BEGIN
  -- Check if all required functions exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'claim_and_start_job'
  ) THEN
    RAISE WARNING 'claim_and_start_job function not found!';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'finish_job'
  ) THEN
    RAISE WARNING 'finish_job function not found!';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enqueue_fetch_job'
  ) THEN
    RAISE WARNING 'enqueue_fetch_job function not found!';
  END IF;
  
  RAISE NOTICE 'Migration 015 completed successfully';
END $$;

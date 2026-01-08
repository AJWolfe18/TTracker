-- ============================================================================
-- Migration 018B: Create Partial-Unique Index (TWO OPTIONS)
-- ============================================================================
-- Purpose: Create partial unique index for active jobs only
-- Author: TrumpyTracker Team
-- Date: 2025-09-28
-- ============================================================================

-- ============================================================================
-- OPTION 1: WITHOUT CONCURRENTLY (Recommended for Supabase)
-- ============================================================================
-- This version works in Supabase SQL Editor but will briefly lock the table
-- For small tables (< 100k rows), this is perfectly fine

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- Add comment to document the invariant
COMMENT ON INDEX ux_job_queue_payload_hash_active IS
  'Active = processed_at IS NULL. Partial unique prevents duplicate active jobs only.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 018B completed: Partial unique index created successfully';
  RAISE NOTICE 'Remember: processed_at IS NULL = job is active';
END $$;

-- ============================================================================
-- OPTION 2: Using Supabase CLI (If you need CONCURRENTLY)
-- ============================================================================
-- If you absolutely need CONCURRENTLY (for large tables), use the Supabase CLI:
-- 
-- 1. Save this command to a file called create_index.sql:
--    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
--    ON public.job_queue (job_type, payload_hash)
--    WHERE processed_at IS NULL;
--
-- 2. Run via Supabase CLI:
--    supabase db push --db-url "postgresql://postgres:[password]@[host]/postgres" < create_index.sql
--
-- ============================================================================

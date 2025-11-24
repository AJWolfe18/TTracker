-- ============================================================================
-- Migration 038: Smart Error Tracking & Retry Logic
-- JIRA: TTRC-278 (Error Categorization), TTRC-279 (Per-Story Failure Tracking)
-- Date: 2025-11-23
-- Description: Adds per-story error tracking and intelligent retry categorization
--              to story enrichment. Reduces wasted OpenAI retries by ~50% by
--              distinguishing transient errors from permanent failures.
-- ============================================================================

-- Section 1: Add Error Tracking Columns to Stories Table
-- ============================================================================
-- These columns track enrichment retry state and error history per story

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enrichment_failure_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_category TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT DEFAULT NULL;

-- Status constraint (NULL allowed for never-attempted stories)
-- Drop first in case re-running migration
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS chk_enrichment_status;
ALTER TABLE public.stories
  ADD CONSTRAINT chk_enrichment_status
  CHECK (enrichment_status IN ('pending', 'success', 'permanent_failure'));

-- Index for filtering by status (partial index excludes NULLs)
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_status
  ON public.stories(enrichment_status)
  WHERE enrichment_status IS NOT NULL;

-- Section 2: Create Error Log Table
-- ============================================================================
-- Stores detailed error history for observability and debugging

CREATE TABLE IF NOT EXISTS admin.enrichment_error_log (
  id BIGSERIAL PRIMARY KEY,
  story_id BIGINT NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  error_category TEXT NOT NULL,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count INT NOT NULL,
  job_id BIGINT
);

-- Category constraint (MUST match categorizeEnrichmentError() in job-queue-worker.js)
ALTER TABLE admin.enrichment_error_log DROP CONSTRAINT IF EXISTS chk_enrichment_error_category;
ALTER TABLE admin.enrichment_error_log
  ADD CONSTRAINT chk_enrichment_error_category
  CHECK (
    error_category IN (
      'rate_limit',        -- OpenAI 429 errors
      'budget_exceeded',   -- Daily cap hit (our budget) or OpenAI quota
      'network_timeout',   -- ECONNRESET, ETIMEDOUT, 5xx
      'json_parse',        -- Invalid JSON response
      'content_policy',    -- OpenAI content violation
      'token_limit',       -- Story too large for model
      'infra_auth',        -- Auth/permission/org errors (don't blame story)
      'invalid_request',   -- Malformed request (code bug)
      'unknown'            -- Uncategorized errors
    )
  );

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_enrichment_error_story_time
  ON admin.enrichment_error_log(story_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_error_category
  ON admin.enrichment_error_log(error_category, occurred_at DESC);

-- Section 3: Atomic Failure Increment RPC
-- ============================================================================
-- Atomically increments failure count and determines story status
-- SECURITY: Matches log_run_stats pattern (DEFINER + search_path)
-- CRITICAL: Budget errors don't increment counters (infinite retry)

CREATE OR REPLACE FUNCTION public.increment_enrichment_failure(
  p_story_id BIGINT,
  p_is_budget_error BOOLEAN DEFAULT FALSE,
  p_max_retries INT DEFAULT 5,
  p_error_category TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS TABLE (
  enrichment_failure_count INT,
  enrichment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
DECLARE
  v_count INT;
  v_status TEXT;
BEGIN
  -- ========================================
  -- Budget Error Path: Update error info but don't increment counters
  -- ========================================
  IF p_is_budget_error THEN
    SELECT
      s.enrichment_failure_count,
      s.enrichment_status
    INTO v_count, v_status
    FROM public.stories s
    WHERE s.id = p_story_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Story % not found', p_story_id;
    END IF;

    -- Maintain cooldown, record error, but don't count it
    UPDATE public.stories
    SET
      last_enriched_at = NOW(),
      last_error_category = p_error_category,
      last_error_message = p_error_message
    WHERE id = p_story_id;

    RETURN QUERY SELECT v_count, v_status;
    RETURN;
  END IF;

  -- ========================================
  -- Normal Failure Path: Atomically increment counter and set status
  -- ========================================
  -- OPTIMIZED: Single UPDATE with CASE (instead of two UPDATEs)
  UPDATE public.stories
  SET
    enrichment_failure_count = enrichment_failure_count + 1,
    last_enriched_at = NOW(),
    last_error_category = p_error_category,
    last_error_message = p_error_message,
    enrichment_status = CASE
      WHEN enrichment_failure_count + 1 >= p_max_retries THEN 'permanent_failure'
      ELSE 'pending'
    END
  WHERE id = p_story_id
  RETURNING enrichment_failure_count, enrichment_status
  INTO v_count, v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id;
  END IF;

  RETURN QUERY SELECT v_count, v_status;
END;
$func$;

-- Security hardening: Only service_role can call this
REVOKE ALL ON FUNCTION public.increment_enrichment_failure(
  BIGINT, BOOLEAN, INT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.increment_enrichment_failure(
  BIGINT, BOOLEAN, INT, TEXT, TEXT
) TO service_role;

-- Section 4: Error Log RPC
-- ============================================================================
-- Public wrapper for admin.enrichment_error_log table
-- SECURITY: Matches log_run_stats pattern (DEFINER + search_path)

CREATE OR REPLACE FUNCTION public.log_enrichment_error(
  p_story_id BIGINT,
  p_error_category TEXT,
  p_error_message TEXT,
  p_retry_count INT,
  p_job_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
BEGIN
  INSERT INTO admin.enrichment_error_log (
    story_id,
    error_category,
    error_message,
    retry_count,
    job_id
  )
  VALUES (
    p_story_id,
    p_error_category,
    p_error_message,
    p_retry_count,
    p_job_id
  );
END;
$func$;

-- Security hardening: Only service_role can call this
REVOKE ALL ON FUNCTION public.log_enrichment_error(
  BIGINT, TEXT, TEXT, INT, BIGINT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_enrichment_error(
  BIGINT, TEXT, TEXT, INT, BIGINT
) TO service_role;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Next Steps:
--   1. Verify schema with: SELECT * FROM information_schema.columns WHERE table_name = 'stories' AND column_name LIKE 'enrichment%';
--   2. Update job-queue-worker.js with smart retry logic
--   3. Test error categories manually
--   4. Monitor error logs: SELECT * FROM admin.enrichment_error_log ORDER BY occurred_at DESC LIMIT 10;
-- ============================================================================

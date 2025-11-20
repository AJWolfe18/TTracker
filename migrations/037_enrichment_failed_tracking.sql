-- ============================================================================
-- Migration 037: Add enrichment_failed Tracking + last_enriched_at Column
-- ============================================================================
-- Ticket: TTRC-280
-- Purpose: Track enrichment failures for observability and retry logic
-- Blockers Fixed:
--   - Missing last_enriched_at column (code already references it)
--   - Missing enrichment_failed column in run_stats
--   - RPC signature mismatch (14 → 15 params)
-- Date: 2025-11-18
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 0: Add last_enriched_at Column to Stories Table
-- ============================================================================
-- CRITICAL: Code already references this column at lines 322, 324, 551
-- Without this, queries will crash with "column does not exist"

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

COMMENT ON COLUMN stories.last_enriched_at IS
  'Timestamp of last enrichment attempt (success OR failure). Used for 12h cooldown (ENRICHMENT_COOLDOWN_HOURS). Prevents retry storms by marking failed stories as "recently attempted". NULL = never attempted.';

-- ============================================================================
-- SECTION 1: Add enrichment_failed Column to run_stats
-- ============================================================================

ALTER TABLE admin.run_stats 
  ADD COLUMN IF NOT EXISTS enrichment_failed INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN admin.run_stats.enrichment_failed IS 
  'Count of stories that failed enrichment (OpenAI errors, parsing failures, network timeouts, etc.)';

-- ============================================================================
-- SECTION 2: Drop old 14-parameter RPC version
-- ============================================================================
-- Prevents function overload confusion

DROP FUNCTION IF EXISTS public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT
);

-- ============================================================================
-- SECTION 3: Create new 15-parameter RPC version
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_run_stats(
  p_environment TEXT,
  p_run_started_at TIMESTAMPTZ,
  p_run_finished_at TIMESTAMPTZ,
  p_status TEXT,
  p_feeds_total INT,
  p_feeds_processed INT,
  p_feeds_succeeded INT,
  p_feeds_failed INT,
  p_feeds_skipped_lock INT,
  p_feeds_304_cached INT,
  p_stories_clustered INT,
  p_stories_enriched INT,
  p_total_openai_cost_usd NUMERIC,
  p_enrichment_skipped_budget INT,
  p_enrichment_failed INT  -- NEW PARAMETER (15th)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
BEGIN
  INSERT INTO admin.run_stats (
    environment, run_started_at, run_finished_at, status,
    feeds_total, feeds_processed, feeds_succeeded, feeds_failed,
    feeds_skipped_lock, feeds_304_cached,
    stories_clustered, stories_enriched,
    total_openai_cost_usd, enrichment_skipped_budget,
    enrichment_failed  -- NEW FIELD
  )
  VALUES (
    p_environment, p_run_started_at, p_run_finished_at, p_status,
    p_feeds_total, p_feeds_processed, p_feeds_succeeded, p_feeds_failed,
    p_feeds_skipped_lock, p_feeds_304_cached,
    p_stories_clustered, p_stories_enriched,
    p_total_openai_cost_usd, p_enrichment_skipped_budget,
    p_enrichment_failed  -- NEW VALUE
  );
END;
$func$;

-- ============================================================================
-- SECTION 4: Add function comment
-- ============================================================================

COMMENT ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
) IS
'Wrapper for inserting into admin.run_stats. Uses SECURITY DEFINER to bypass PostgREST schema restrictions.
Updated in migration 037 to track enrichment failures (TTRC-280).';

-- ============================================================================
-- SECTION 5: Revoke public permissions
-- ============================================================================

REVOKE ALL ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
) FROM PUBLIC;

-- ============================================================================
-- SECTION 6: Grant to service_role only
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
) TO service_role;

COMMIT;

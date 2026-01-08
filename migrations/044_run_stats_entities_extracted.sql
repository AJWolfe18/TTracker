-- ============================================================================
-- Migration 044: Add entities_extracted to run_stats
-- ============================================================================
-- Ticket: TTRC-298 (Article-level entity extraction)
-- Purpose: Track entity extraction count per pipeline run for observability
-- Date: 2025-12-08
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: Add entities_extracted Column to run_stats
-- ============================================================================

ALTER TABLE admin.run_stats
  ADD COLUMN IF NOT EXISTS entities_extracted INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN admin.run_stats.entities_extracted IS
  'Count of articles that had entities successfully extracted in this run (TTRC-298)';

-- ============================================================================
-- SECTION 2: Drop old 15-parameter RPC version
-- ============================================================================

DROP FUNCTION IF EXISTS public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
);

-- ============================================================================
-- SECTION 3: Create new 16-parameter RPC version
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
  p_enrichment_failed INT DEFAULT 0,
  p_entities_extracted INT DEFAULT 0  -- NEW PARAMETER (16th)
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
    enrichment_failed,
    entities_extracted  -- NEW FIELD
  )
  VALUES (
    p_environment, p_run_started_at, p_run_finished_at, p_status,
    p_feeds_total, p_feeds_processed, p_feeds_succeeded, p_feeds_failed,
    p_feeds_skipped_lock, p_feeds_304_cached,
    p_stories_clustered, p_stories_enriched,
    p_total_openai_cost_usd, p_enrichment_skipped_budget,
    p_enrichment_failed,
    p_entities_extracted  -- NEW VALUE
  );
END;
$func$;

-- ============================================================================
-- SECTION 4: Add function comment
-- ============================================================================

COMMENT ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT, INT
) IS
'Wrapper for inserting into admin.run_stats. Uses SECURITY DEFINER to bypass PostgREST schema restrictions.
Updated in migration 044 to track entity extraction count (TTRC-298).';

-- ============================================================================
-- SECTION 5: Revoke public permissions
-- ============================================================================

REVOKE ALL ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT, INT
) FROM PUBLIC;

-- ============================================================================
-- SECTION 6: Grant to service_role only
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT, INT
) TO service_role;

COMMIT;

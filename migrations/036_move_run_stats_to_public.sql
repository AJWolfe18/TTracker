-- ============================================================================
-- Migration 036: Add RPC Wrapper for admin.run_stats
-- ============================================================================
-- Ticket: TTRC-266 (RSS inline automation fix)
-- Issue: PostgREST blocks admin schema access (not configurable in hosted Supabase)
-- Fix: Create public.log_run_stats RPC with SECURITY DEFINER to write to admin.run_stats
-- Security: RPC in public (callable via REST API), table in admin (isolated)
--           SECURITY DEFINER allows RPC to access admin schema
--           Only service role can execute (REVOKE from PUBLIC)
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
  p_enrichment_skipped_budget INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
BEGIN
  INSERT INTO admin.run_stats (
    environment,
    run_started_at,
    run_finished_at,
    status,
    feeds_total,
    feeds_processed,
    feeds_succeeded,
    feeds_failed,
    feeds_skipped_lock,
    feeds_304_cached,
    stories_clustered,
    stories_enriched,
    total_openai_cost_usd,
    enrichment_skipped_budget
  )
  VALUES (
    p_environment,
    p_run_started_at,
    p_run_finished_at,
    p_status,
    p_feeds_total,
    p_feeds_processed,
    p_feeds_succeeded,
    p_feeds_failed,
    p_feeds_skipped_lock,
    p_feeds_304_cached,
    p_stories_clustered,
    p_stories_enriched,
    p_total_openai_cost_usd,
    p_enrichment_skipped_budget
  );
END;
$$;

COMMENT ON FUNCTION public.log_run_stats IS
'Wrapper for inserting into admin.run_stats. Uses SECURITY DEFINER to bypass PostgREST schema restrictions.
Only callable by service role key. Created in migration 036 for TTRC-266.';

-- Revoke public access, explicitly grant to service_role only
REVOKE ALL ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT
) TO service_role;

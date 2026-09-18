-- ============================================================================
-- Migration 117: Stories agent candidate pool - re-enrich only on new articles
-- ADO-584. September 18, 2026.
-- ============================================================================
-- WHY: the Stories Enrichment Agent's Step 2 (docs/features/stories-claude-agent/
-- prompt-v1.md) treated every Claude-enriched active story older than 12 hours
-- as "stale", with no check that anything changed. PROD has ~15,000 active
-- stories that never close, so every 2-hour run spent its spare slots rewriting
-- the oldest stories forever (the September 18, 2026 run rewrote July/August
-- stories with no new sources) and retried no-source stories every 12 hours
-- (story 12675 reached 21 failures). PostgREST cannot compare two columns of the
-- same row, so the "new article since last enrichment" rule needs an RPC.
--
-- WHAT: stories_needing_enrichment(p_limit, p_cooldown_hours, p_max_failures)
--   Returns the stories the agent should touch this run, oldest-enriched first,
--   never-enriched first of all:
--     1. never enriched (last_enriched_at IS NULL) - always eligible
--     2. Claude-agent-enriched (enrichment_meta->>'source' = 'claude-agent'),
--        cooldown passed, AND at least one article_story row attached
--        (matched_at) AFTER last_enriched_at - the cluster grew
--   Excluded:
--     - legacy GPT-enriched stories (no source marker) - frozen, out of scope
--     - stories with no linked articles (nothing to enrich from)
--     - stories at or above p_max_failures attempts (hard stop for pathological
--       rows; a failed story below the cap is retried only when a new article
--       attaches, because case 2 requires it)
--   new_article_count and pool_size are diagnostics for the run log.
--   service_role only. The agent's Step 6 concurrency guard still uses the
--   returned last_enriched_at verbatim.
--
-- Deploy order: apply this BEFORE the prompt change reaches the branch a routine
-- reads (test for the TEST routine, main for PROD) - the prompt calls this RPC
-- and stops with no writes if it is missing (PGRST202).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stories_needing_enrichment(
  p_limit          INTEGER DEFAULT 40,
  p_cooldown_hours INTEGER DEFAULT 12,
  p_max_failures   INTEGER DEFAULT 10
)
RETURNS TABLE (
  id                       BIGINT,
  primary_headline         TEXT,
  last_enriched_at         TIMESTAMPTZ,
  enrichment_failure_count INTEGER,
  enrichment_meta          JSONB,
  new_article_count        INTEGER,
  pool_size                INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT s.id,
         s.primary_headline,
         s.last_enriched_at,
         COALESCE(s.enrichment_failure_count, 0)::integer,
         s.enrichment_meta,
         (SELECT COUNT(*)
            FROM public.article_story a
           WHERE a.story_id = s.id
             AND (s.last_enriched_at IS NULL OR a.matched_at > s.last_enriched_at))::integer,
         COUNT(*) OVER ()::integer
    FROM public.stories s
   WHERE s.status = 'active'
     AND COALESCE(s.enrichment_failure_count, 0) < GREATEST(COALESCE(p_max_failures, 10), 1)
     AND EXISTS (SELECT 1 FROM public.article_story a WHERE a.story_id = s.id)
     AND (
           s.last_enriched_at IS NULL
        OR (
               s.enrichment_meta->>'source' = 'claude-agent'
           AND s.last_enriched_at < NOW() - make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 12), 0))
           AND EXISTS (SELECT 1
                         FROM public.article_story a
                        WHERE a.story_id = s.id
                          AND a.matched_at > s.last_enriched_at)
           )
         )
   ORDER BY s.last_enriched_at ASC NULLS FIRST, s.id ASC
   LIMIT GREATEST(COALESCE(p_limit, 40), 1);
$$;

COMMENT ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) IS
  'ADO-584: candidate pool for the Stories Enrichment Agent. Never-enriched active stories first, then Claude-agent-enriched stories past the cooldown that gained at least one article_story row (matched_at) after last_enriched_at. Excludes legacy GPT output (no enrichment_meta.source marker), stories with no linked articles, and stories at or above p_max_failures attempts. pool_size = total before LIMIT. service_role only. Prompt: docs/features/stories-claude-agent/prompt-v1.md Step 2.';

REVOKE ALL ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) TO service_role;

-- Idempotency / smoke check (service_role): expect never-enriched rows first,
-- then rows whose new_article_count > 0. A story with new_article_count = 0 and
-- last_enriched_at NOT NULL must never appear.
-- SELECT id, last_enriched_at, enrichment_failure_count, new_article_count, pool_size
--   FROM public.stories_needing_enrichment(40, 12, 10);

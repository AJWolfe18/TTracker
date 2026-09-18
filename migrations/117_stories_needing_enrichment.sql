-- ============================================================================
-- Migration 117: Stories agent candidate pool - re-enrich only on new evidence
-- ADO-584. September 18, 2026. v2 (same day, after review: evidence watermark, merge
-- re-qualification, failed-attempt retry). Idempotent via DROP IF EXISTS + CREATE.
-- v1 was never applied on PROD.
-- ============================================================================
-- WHY: the Stories Enrichment Agent's Step 2 (docs/features/stories-claude-agent/
-- prompt-v1.md) treated every Claude-enriched active story older than 12 hours
-- as "stale", with no check that anything changed. PROD has ~15,000 active
-- stories that never close, so every 2-hour run spent its spare slots rewriting
-- the oldest stories forever (the September 18, 2026 run rewrote July/August
-- stories with no new sources) and retried no-source stories every 12 hours
-- (story 12675 reached 21 failures). PostgREST cannot compare two columns of the
-- same row, so the "new evidence since last enrichment" rule needs an RPC.
--
-- WHAT: stories_needing_enrichment(p_limit, p_cooldown_hours, p_max_failures)
--   Returns the stories the agent should touch this run, oldest-enriched first,
--   never-enriched first of all. A story qualifies when:
--     never_enriched  last_enriched_at IS NULL (always eligible)
--     new_articles    Claude-agent-enriched, cooldown passed, and at least one
--                     article_story row attached (matched_at) after the
--                     EVIDENCE WATERMARK - the cluster grew
--     merged          Claude-agent-enriched, cooldown passed, and a Judge
--                     merge/unmerge (story_merge_audit) changed this story's
--                     membership after the watermark (merge_stories repoints
--                     article_story rows without touching matched_at, so
--                     the new_articles test alone would never see it)
--     retry_failed    Claude-agent-enriched, cooldown passed, the last attempt
--                     failed OR the story still has no summary_neutral, and
--                     fewer than p_max_failures attempts so far (a transient
--                     write failure on a one-article story must not hide it
--                     from the site forever; the cap stops the pathological
--                     no-source rows)
--   The evidence watermark is DB-issued: the RPC returns evidence_as_of =
--   MAX(article_story.matched_at) at read time; the agent echoes it verbatim
--   into enrichment_meta.evidence_as_of on every write (success or failure),
--   and the RPC compares matched_at against that instead of last_enriched_at.
--   last_enriched_at is the agent's write-time clock, minutes after it read the
--   articles, so an article attached mid-enrichment would otherwise look
--   "already seen" (same race migration 106 fixed for the Judge). Rows without
--   the key (v1 writes, failures) fall back to last_enriched_at.
--   Excluded: legacy GPT-enriched stories (no source marker, frozen), stories
--   with no linked articles, and the retry_failed branch past the cap.
--   reason, new_article_count and pool_size are diagnostics for the run log.
--   service_role only. The agent's Step 6 concurrency guard still uses the
--   returned last_enriched_at verbatim.
--
-- NOTE: the legacy name get_stories_needing_enrichment (documented for the old
-- GPT pipeline) does not exist on TEST (PGRST202) and is unrelated.
--
-- Deploy order: apply this BEFORE the prompt change reaches the branch a routine
-- reads (test for the TEST routine, main for PROD) - the prompt calls this RPC
-- and stops with no writes if it is missing (PGRST202).
-- ============================================================================

-- v2 changed the return type (added evidence_as_of, reason), which CREATE OR REPLACE cannot do (42P13).
DROP FUNCTION IF EXISTS public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.stories_needing_enrichment(
  p_limit          INTEGER DEFAULT 40,
  p_cooldown_hours INTEGER DEFAULT 12,
  p_max_failures   INTEGER DEFAULT 3
)
RETURNS TABLE (
  id                       BIGINT,
  primary_headline         TEXT,
  last_enriched_at         TIMESTAMPTZ,
  enrichment_failure_count INTEGER,
  enrichment_meta          JSONB,
  evidence_as_of           TIMESTAMPTZ,
  new_article_count        INTEGER,
  reason                   TEXT,
  pool_size                INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pool AS (
    SELECT s.id,
           s.primary_headline,
           s.last_enriched_at,
           COALESCE(s.enrichment_failure_count, 0)::integer AS enrichment_failure_count,
           s.enrichment_meta,
           m.max_matched                                  AS evidence_as_of,
           m.new_cnt::integer                             AS new_article_count,
           CASE
             WHEN s.last_enriched_at IS NULL THEN 'never_enriched'
             WHEN m.new_cnt > 0              THEN 'new_articles'
             WHEN mg.changed                 THEN 'merged'
             ELSE                                 'retry_failed'
           END                                            AS reason
      FROM public.stories s
      -- evidence watermark: what the last enrichment actually saw (DB-issued,
      -- echoed by the agent), falling back to the write-time stamp
      CROSS JOIN LATERAL (
        SELECT COALESCE(
                 CASE WHEN s.enrichment_meta->>'evidence_as_of' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                      THEN (s.enrichment_meta->>'evidence_as_of')::timestamptz END,
                 s.last_enriched_at) AS watermark
      ) w
      -- one pass over the story's members: total, newest attach, attaches after the watermark
      CROSS JOIN LATERAL (
        SELECT COUNT(*)                                                     AS total,
               MAX(a.matched_at)                                            AS max_matched,
               COUNT(*) FILTER (WHERE w.watermark IS NULL OR a.matched_at > w.watermark) AS new_cnt
          FROM public.article_story a
         WHERE a.story_id = s.id
      ) m
      -- Judge merge/unmerge touched this story's membership after the watermark
      CROSS JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
            FROM public.story_merge_audit ma
           WHERE ma.survivor_id = s.id
             AND (ma.merged_at > w.watermark OR ma.unmerged_at > w.watermark)
        ) AS changed
      ) mg
     WHERE s.status = 'active'
       AND m.total > 0
       AND (
             s.last_enriched_at IS NULL
          OR (
                 s.enrichment_meta->>'source' = 'claude-agent'
             AND s.last_enriched_at < NOW() - make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 12), 0))
             AND (
                   m.new_cnt > 0
                OR mg.changed
                OR (
                       (s.enrichment_meta->>'last_attempt_status' = 'failed' OR s.summary_neutral IS NULL)
                   AND COALESCE(s.enrichment_failure_count, 0) < GREATEST(COALESCE(p_max_failures, 3), 1)
                   )
                 )
             )
           )
  )
  SELECT p.id,
         p.primary_headline,
         p.last_enriched_at,
         p.enrichment_failure_count,
         p.enrichment_meta,
         p.evidence_as_of,
         p.new_article_count,
         p.reason,
         COUNT(*) OVER ()::integer AS pool_size
    FROM pool p
   ORDER BY p.last_enriched_at ASC NULLS FIRST, p.id ASC
   LIMIT GREATEST(COALESCE(p_limit, 40), 1);
$$;

COMMENT ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) IS
  'ADO-584: candidate pool for the Stories Enrichment Agent. never_enriched first; then Claude-agent-enriched stories past the cooldown that (a) gained an article_story row after the evidence watermark (enrichment_meta.evidence_as_of, DB-issued and echoed by the agent; falls back to last_enriched_at), (b) were changed by a Judge merge/unmerge (story_merge_audit) after the watermark, or (c) failed their last attempt / still have no summary_neutral and are under p_max_failures attempts. Excludes legacy GPT output (no enrichment_meta.source marker) and stories with no linked articles. pool_size = total before LIMIT. service_role only. Prompt: docs/features/stories-claude-agent/prompt-v1.md Step 2.';

REVOKE ALL ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) TO service_role;

-- Smoke check (service_role): never-enriched rows first; every other row has
-- reason in (new_articles, merged, retry_failed). A row with reason
-- 'new_articles' and new_article_count = 0 must never appear.
-- SELECT id, reason, new_article_count, enrichment_failure_count, evidence_as_of, pool_size
--   FROM public.stories_needing_enrichment(40, 12, 3);

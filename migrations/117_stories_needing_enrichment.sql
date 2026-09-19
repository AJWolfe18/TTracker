-- ============================================================================
-- Migration 117: Stories agent candidate pool - re-enrich only on new evidence
-- ADO-584. September 18, 2026. v3 (same day, after review). v2: evidence watermark, merge
-- re-qualification, failed-attempt retry. v3: the watermark also covers merge/unmerge
-- times (v2 re-qualified every merged survivor forever), and new_article_ids names
-- the evidence the agent must read. Idempotent via DROP IF EXISTS + CREATE.
-- v1 and v2 were never applied on PROD.
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
--   GREATEST(MAX(article_story.matched_at), newest story_merge_audit merged_at /
--   unmerged_at for this survivor) at read time. It must cover merges too: a
--   merge newer than the newest attach would otherwise stay "after the watermark"
--   forever and the survivor would be rewritten every cooldown (seen on TEST with
--   v2: stories 16981 and 17024). The agent echoes it verbatim
--   into enrichment_meta.evidence_as_of on every write (success or failure),
--   and the RPC compares matched_at against that instead of last_enriched_at.
--   last_enriched_at is the agent's write-time clock, minutes after it read the
--   articles, so an article attached mid-enrichment would otherwise look
--   "already seen" (same race migration 106 fixed for the Judge). Rows without
--   the key (v1 writes, failures) fall back to last_enriched_at.
--   Excluded: legacy GPT-enriched stories (no source marker, frozen), stories
--   with no linked articles, and the retry_failed branch past the cap.
--   new_article_ids = the evidence that re-qualified the story (newest 6: attaches
--   after the watermark plus articles a still-standing merge brought in). The
--   agent fetches these by id on top of its usual top-6-by-similarity read, which
--   can miss a low-similarity new article while the watermark still advances past
--   it. More than 6 new articles in one cooldown = a hot story that re-qualifies
--   again on its next attach, so the cap loses nothing for long.
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

-- v2/v3 changed the return type (evidence_as_of, reason, new_article_ids), which CREATE OR REPLACE cannot do (42P13).
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
  new_article_ids          TEXT[],
  reason                   TEXT,
  pool_size                INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH merge_change AS (
    -- newest Judge merge/unmerge per survivor (one scan, hash-joined below)
    SELECT ma.survivor_id,
           MAX(GREATEST(ma.merged_at, ma.unmerged_at)) AS max_change
      FROM public.story_merge_audit ma
     GROUP BY ma.survivor_id
  ),
  pool AS (
    SELECT s.id,
           s.primary_headline,
           s.last_enriched_at,
           COALESCE(s.enrichment_failure_count, 0)::integer AS enrichment_failure_count,
           s.enrichment_meta,
           w.watermark,
           -- the watermark the agent echoes back must cover BOTH kinds of evidence:
           -- a merge newer than the newest attach would otherwise stay "after the
           -- watermark" forever and re-qualify the survivor every cooldown
           GREATEST(m.max_matched, mc.max_change)         AS evidence_as_of,
           m.new_cnt::integer                             AS new_article_count,
           CASE
             WHEN s.last_enriched_at IS NULL THEN 'never_enriched'
             WHEN m.new_cnt > 0              THEN 'new_articles'
             WHEN COALESCE(mc.max_change > w.watermark, FALSE) THEN 'merged'
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
      LEFT JOIN merge_change mc ON mc.survivor_id = s.id
     WHERE s.status = 'active'
       AND m.total > 0
       AND (
             s.last_enriched_at IS NULL
          OR (
                 s.enrichment_meta->>'source' = 'claude-agent'
             AND s.last_enriched_at < NOW() - make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 12), 0))
             AND (
                   m.new_cnt > 0
                OR COALESCE(mc.max_change > w.watermark, FALSE)
                OR (
                       (s.enrichment_meta->>'last_attempt_status' = 'failed' OR s.summary_neutral IS NULL)
                   AND COALESCE(s.enrichment_failure_count, 0) < GREATEST(COALESCE(p_max_failures, 3), 1)
                   )
                 )
             )
           )
  ),
  picked AS (
    SELECT p.*, COUNT(*) OVER ()::integer AS pool_size
      FROM pool p
     ORDER BY p.last_enriched_at ASC NULLS FIRST, p.id ASC
     LIMIT GREATEST(COALESCE(p_limit, 40), 1)
  )
  SELECT k.id,
         k.primary_headline,
         k.last_enriched_at,
         k.enrichment_failure_count,
         k.enrichment_meta,
         k.evidence_as_of,
         k.new_article_count,
         -- the evidence that re-qualified the story (newest 6): attaches after the
         -- watermark plus articles a still-standing merge brought in after it. The
         -- agent fetches these explicitly - its top-6-by-similarity read can miss them.
         -- Computed for the returned rows only.
         (SELECT COALESCE(ARRAY_AGG(x.article_id ORDER BY x.matched_at DESC, x.article_id), ARRAY[]::text[])
            FROM (SELECT a.article_id, a.matched_at
                    FROM public.article_story a
                   WHERE a.story_id = k.id
                     AND k.last_enriched_at IS NOT NULL
                     AND (   a.matched_at > k.watermark
                          OR EXISTS (SELECT 1
                                       FROM public.story_merge_audit ma
                                      WHERE ma.survivor_id = k.id
                                        AND ma.unmerged_at IS NULL
                                        AND ma.merged_at > k.watermark
                                        AND a.article_id = ANY (ma.loser_article_ids)))
                   ORDER BY a.matched_at DESC, a.article_id
                   LIMIT 6) x)                            AS new_article_ids,
         k.reason,
         k.pool_size
    FROM picked k
   ORDER BY k.last_enriched_at ASC NULLS FIRST, k.id ASC;
$$;

COMMENT ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) IS
  'ADO-584: candidate pool for the Stories Enrichment Agent. never_enriched first; then Claude-agent-enriched stories past the cooldown that (a) gained an article_story row after the evidence watermark (enrichment_meta.evidence_as_of = newest attach or merge/unmerge time at read, DB-issued and echoed by the agent; falls back to last_enriched_at), (b) were changed by a Judge merge/unmerge (story_merge_audit) after the watermark, or (c) failed their last attempt / still have no summary_neutral and are under p_max_failures attempts. Excludes legacy GPT output (no enrichment_meta.source marker) and stories with no linked articles. new_article_ids = the post-watermark evidence (newest 6) the agent must fetch. pool_size = total before LIMIT. service_role only. Prompt: docs/features/stories-claude-agent/prompt-v1.md Step 2.';

REVOKE ALL ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) TO service_role;

-- Smoke check (service_role): never-enriched rows first; every other row has
-- reason in (new_articles, merged, retry_failed). A row with reason
-- 'new_articles' and new_article_count = 0 must never appear, and a story the
-- agent just enriched must not come back when p_cooldown_hours = 0.
-- SELECT id, reason, new_article_count, new_article_ids, enrichment_failure_count, evidence_as_of, pool_size
--   FROM public.stories_needing_enrichment(40, 12, 3);

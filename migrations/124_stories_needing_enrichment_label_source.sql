-- ============================================================================
-- Migration 124: stories_needing_enrichment returns action_label_source (ADO-594 S2, PRD 14.7)
-- ============================================================================
-- WHAT: the Stories agent's queue RPC (migration 117 v5) gets one more output
-- column, action_label_source (agent | backfill | human | NULL, migration 123),
-- appended last. Nothing else changes: the body is 117 v5 verbatim plus that
-- column, so the pool, the order, the watermark and new_article_ids are identical.
-- WHY: prompt claude-v1.1 writes action_label / action_actor on every success and
-- must leave all three label fields out of its PATCH when a human locked the
-- label. It can only see the lock if Step 2 returns it. (The trigger from 123
-- restores a human label anyway; this keeps the agent's run log honest.)
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST first, then
-- PROD). Needs migration 123 (the column). Idempotent: safe to re-run. One
-- transaction; if anything errors, run ROLLBACK; alone before retrying.
-- DEPLOY ORDER: apply on PROD BEFORE prompt claude-v1.1 reaches main.
-- ROLLBACK: re-run migration 117 (restores the old return type; the v1.1 prompt
--   then sees no action_label_source and treats the label as unlocked, which the
--   123 trigger still makes safe).
-- Last statement is a read-only check whose first column is
-- `rpc_has_label_source` (expect 1; then rpc_versions = 1, anon_can_execute = false).
-- ============================================================================

BEGIN;

-- Adding an output column changes the return type, which CREATE OR REPLACE cannot do (42P13).
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
  prior_evidence_as_of     TIMESTAMPTZ,
  new_article_count        INTEGER,
  new_article_ids          TEXT[],
  reason                   TEXT,
  pool_size                INTEGER,
  action_label_source      TEXT
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
           -- DB-issued copy of the watermark this read used: a FAILED attempt echoes it
           -- back into enrichment_meta.evidence_as_of so the watermark does not move (v4)
           w.watermark                                    AS prior_evidence_as_of,
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
           END                                            AS reason,
           -- 124 (ADO-594 S2): 'human' = locked label, the agent leaves the label fields out
           s.action_label_source
      FROM public.stories s
      -- evidence watermark: what the last enrichment actually saw (DB-issued,
      -- echoed by the agent), falling back to the write-time stamp
      CROSS JOIN LATERAL (
        SELECT CASE
                 -- key present with JSON null = a failed first attempt: nothing has been seen (v5)
                 WHEN jsonb_typeof(s.enrichment_meta->'evidence_as_of') = 'null' THEN NULL::timestamptz
                 -- key missing (legacy writes) or unreadable: the write-time stamp
                 ELSE COALESCE(
                        CASE WHEN s.enrichment_meta->>'evidence_as_of' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                             THEN (s.enrichment_meta->>'evidence_as_of')::timestamptz END,
                        s.last_enriched_at)
               END AS watermark
      ) w
      -- what the last ATTEMPT saw: a failed attempt records the Step-2 watermark here without
      -- moving the real one (v4). GREATEST ignores NULLs; a success write drops the key.
      CROSS JOIN LATERAL (
        SELECT GREATEST(
                 w.watermark,
                 CASE WHEN s.enrichment_meta->>'attempt_evidence_as_of' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
                      THEN (s.enrichment_meta->>'attempt_evidence_as_of')::timestamptz END) AS attempt_mark
      ) aw
      -- one pass over the story's members: total, newest attach, attaches after the watermark
      -- (pending evidence) and attaches after the last attempt (fresh evidence)
      CROSS JOIN LATERAL (
        SELECT COUNT(*)                                                     AS total,
               MAX(a.matched_at)                                            AS max_matched,
               COUNT(*) FILTER (WHERE w.watermark IS NULL OR a.matched_at > w.watermark) AS new_cnt,
               COUNT(*) FILTER (WHERE aw.attempt_mark IS NULL OR a.matched_at > aw.attempt_mark) AS fresh_cnt
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
                   -- uncapped: evidence the last attempt (failed or not) has not seen
                   m.fresh_cnt > 0
                OR COALESCE(mc.max_change > aw.attempt_mark, FALSE)
                   -- capped: retry a failed attempt (its pending evidence is still listed)
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
         k.prior_evidence_as_of,
         k.new_article_count,
         -- the evidence that re-qualified the story, all of it, newest first: attaches
         -- after the watermark plus articles a still-standing merge brought in after it.
         -- The agent fetches these explicitly - its top-6-by-similarity read can miss
         -- them. No LIMIT (v4): the watermark advances past every one of them, so every
         -- one must be offered. Computed for the returned rows only.
         (SELECT COALESCE(ARRAY_AGG(x.article_id ORDER BY x.matched_at DESC, x.article_id), ARRAY[]::text[])
            FROM (SELECT a.article_id, a.matched_at
                    FROM public.article_story a
                   WHERE a.story_id = k.id
                     AND k.last_enriched_at IS NOT NULL
                     AND (   k.watermark IS NULL
                          OR a.matched_at > k.watermark
                          OR EXISTS (SELECT 1
                                       FROM public.story_merge_audit ma
                                      WHERE ma.survivor_id = k.id
                                        AND ma.unmerged_at IS NULL
                                        AND ma.merged_at > k.watermark
                                        AND a.article_id = ANY (ma.loser_article_ids)))
                   ) x)                                   AS new_article_ids,
         k.reason,
         k.pool_size,
         k.action_label_source
    FROM picked k
   ORDER BY k.last_enriched_at ASC NULLS FIRST, k.id ASC;
$$;

COMMENT ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) IS
  'ADO-584: candidate pool for the Stories Enrichment Agent. never_enriched first; then Claude-agent-enriched stories past the cooldown that (a) gained an article_story row after the evidence watermark (enrichment_meta.evidence_as_of = newest attach or merge/unmerge time read by the last SUCCESSFUL enrichment, DB-issued and echoed by the agent; a failed attempt echoes prior_evidence_as_of instead and records what it saw in attempt_evidence_as_of; a JSON-null evidence_as_of = nothing seen yet; a missing key falls back to last_enriched_at), (b) were changed by a Judge merge/unmerge (story_merge_audit) after the watermark, or (c) failed their last attempt / still have no summary_neutral and are under p_max_failures attempts. Excludes legacy GPT output (no enrichment_meta.source marker) and stories with no linked articles. new_article_ids = ALL post-watermark evidence, newest first, which the agent must fetch. pool_size = total before LIMIT. action_label_source (migration 124, ADO-594 S2) = who wrote the story''s action label; human = locked, the agent leaves the label fields out of its PATCH. service_role only. Prompt: docs/features/stories-claude-agent/prompt-v1.md Step 2.';

REVOKE ALL ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stories_needing_enrichment(INTEGER, INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Read-only check. Expect: rpc_has_label_source = 1, rpc_versions = 1, anon_can_execute = false.
SELECT
  (SELECT count(*) FROM pg_proc p
    WHERE p.proname = 'stories_needing_enrichment'
      AND 'action_label_source' = ANY (p.proargnames))::int AS rpc_has_label_source,
  (SELECT count(*) FROM pg_proc p WHERE p.proname = 'stories_needing_enrichment')::int AS rpc_versions,
  has_function_privilege('anon', 'public.stories_needing_enrichment(integer,integer,integer)', 'execute') AS anon_can_execute;

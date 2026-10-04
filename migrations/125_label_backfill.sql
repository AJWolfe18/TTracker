-- ============================================================================
-- Migration 125: one-time action label backfill - pool + writer (ADO-594 S3, PRD 14.8)
-- ============================================================================
-- WHY: the Stories agent labels new and re-enriched stories (S2), but migration
-- 117's queue never hands back an unchanged story, so every story already on the
-- site needs a one-time label pass from its headline + neutral summary + primary
-- actor. Routine prompt: docs/features/events-tracker/label-backfill-prompt.md,
-- through scripts/maintenance/label-backfill-db.js (candidates / record).
--
-- WHAT:
--   A) label_backfill_candidates(p_limit 1-50, default 50): active enriched
--      stories with no label yet, newest first, five small columns + pool_size.
--      Never content or embeddings (egress rule). Each call is a page; a recorded
--      page leaves the pool, so "call until empty" needs no OFFSET.
--   B) record_action_labels(p_run_id, p_rows jsonb): one page (1-50 rows) in one
--      atomic call. Checks EVERY row first (one bad row = exception, nothing
--      written), then writes action_label + action_actor + source 'backfill' ONLY
--      where action_label IS NULL, so a label the Stories agent or Josh wrote in
--      the meantime is never overwritten. Every row not written leaves a
--      pipeline_skips row (label_backfill / already_labeled | story_not_found),
--      and every uncertain label one more (label_backfill / label_uncertain) so
--      Josh can review those first (PRD 14.2 edge case 12). Returns one row per
--      input: story_id, outcome (written | already_labeled | not_found), uncertain.
--      Touches nothing else on stories: no summary, alarm or watermark column.
--
-- DEPENDS ON: migration 123 (the label columns + lock trigger) and pipeline_skips.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, later PROD),
-- BEFORE the prompt runs against that environment. Idempotent (CREATE OR REPLACE,
-- re-issued grants). One transaction; if anything errors, run ROLLBACK; alone
-- before retrying. Last statement is a read-only check whose first column is
-- `backfill_pool` (750 on TEST on October 4, 2026, before any run).
-- ROLLBACK (manual): DROP FUNCTION public.record_action_labels(text, jsonb);
--   DROP FUNCTION public.label_backfill_candidates(integer);
--   Labels already written stay; to undo them: UPDATE public.stories SET
--   action_label = NULL, action_actor = NULL, action_label_source = NULL
--   WHERE action_label_source = 'backfill';
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: label_backfill_candidates(p_limit)
-- ----------------------------------------------------------------------------
-- pool_size repeats on every row (COUNT(*) OVER () runs before LIMIT), same as
-- migration 116, so the routine can log "labeled 400 of 15,000" without a
-- second query. Every column is table-qualified (42702 shadowing).
CREATE OR REPLACE FUNCTION public.label_backfill_candidates(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id               BIGINT,
  primary_headline TEXT,
  summary_neutral  TEXT,
  primary_actor    TEXT,
  alarm_level      INTEGER,
  pool_size        INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT st.id,
         st.primary_headline,
         st.summary_neutral,
         st.primary_actor::text,
         st.alarm_level::integer,
         COUNT(*) OVER ()::integer
    FROM public.stories st
   WHERE st.status = 'active'
     AND st.summary_neutral IS NOT NULL
     AND st.action_label IS NULL
   ORDER BY st.first_seen_at DESC, st.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
$$;

COMMENT ON FUNCTION public.label_backfill_candidates(INTEGER) IS
  'ADO-594 S3: candidate pool for the one-time action label backfill - active stories with summary_neutral and no action_label, newest first (first_seen_at desc, id desc), 1-50 rows. Returns id, primary_headline, summary_neutral, primary_actor, alarm_level, pool_size (total before LIMIT). Never content or embeddings. service_role only. Prompt: docs/features/events-tracker/label-backfill-prompt.md';

REVOKE ALL ON FUNCTION public.label_backfill_candidates(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.label_backfill_candidates(INTEGER) TO service_role;

-- ----------------------------------------------------------------------------
-- PART B: record_action_labels(p_run_id, p_rows)
-- ----------------------------------------------------------------------------
-- p_rows: [{"id": 17240, "action_label": "did", "action_actor": "administration",
--           "uncertain": false}, ...]   (uncertain optional, a JSON boolean)
-- Scalar variables only (no %ROWTYPE: the SQL Editor's RLS helper mangles it).
-- The skip strings match PIPELINES.LABEL_BACKFILL and REASONS.ALREADY_LABELED /
-- STORY_NOT_FOUND / LABEL_UNCERTAIN in scripts/lib/skip-reasons.js.
CREATE OR REPLACE FUNCTION public.record_action_labels(
  p_run_id TEXT,
  p_rows   JSONB
)
RETURNS TABLE (story_id BIGINT, outcome TEXT, uncertain BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem   jsonb;
  v_pos    int := -1;
  v_id     bigint;
  v_label  text;
  v_actor  text;
  v_unsure boolean;
  v_seen   bigint[] := '{}';
  v_source text;
BEGIN
  IF p_run_id IS NULL OR p_run_id !~ '^[A-Za-z0-9_.:-]{1,80}$' THEN
    RAISE EXCEPTION 'record_action_labels: p_run_id must be 1-80 chars of [A-Za-z0-9_.:-]';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'record_action_labels: p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'record_action_labels: p_rows must hold 1-50 rows, got %', jsonb_array_length(p_rows);
  END IF;

  -- Pass 1: check every row before writing anything.
  FOR v_elem IN SELECT t.e FROM jsonb_array_elements(p_rows) AS t(e) LOOP
    v_pos := v_pos + 1;
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'record_action_labels: rows[%] must be an object', v_pos;
    END IF;
    IF jsonb_typeof(v_elem->'id') IS DISTINCT FROM 'number'
       OR (v_elem->>'id') !~ '^[1-9][0-9]{0,17}$' THEN
      RAISE EXCEPTION 'record_action_labels: rows[%].id must be a positive integer', v_pos;
    END IF;
    v_id := (v_elem->>'id')::bigint;
    IF v_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'record_action_labels: story % appears twice', v_id;
    END IF;
    v_seen := v_seen || v_id;
    IF jsonb_typeof(v_elem->'action_label') IS DISTINCT FROM 'string'
       OR (v_elem->>'action_label') NOT IN ('did', 'said', 'coverage') THEN
      RAISE EXCEPTION 'record_action_labels: rows[%].action_label must be did, said or coverage', v_pos;
    END IF;
    IF jsonb_typeof(v_elem->'action_actor') IS DISTINCT FROM 'string'
       OR (v_elem->>'action_actor') NOT IN ('trump', 'administration', 'ally', 'other') THEN
      RAISE EXCEPTION 'record_action_labels: rows[%].action_actor must be trump, administration, ally or other', v_pos;
    END IF;
    IF v_elem ? 'uncertain' AND jsonb_typeof(v_elem->'uncertain') <> 'boolean' THEN
      RAISE EXCEPTION 'record_action_labels: rows[%].uncertain must be true or false', v_pos;
    END IF;
  END LOOP;

  -- Pass 2: write. Only an unlabeled row is written; the lock trigger (123)
  -- additionally keeps any human label, so RETURNING the source tells us
  -- whether the label really landed.
  FOR v_elem IN SELECT t.e FROM jsonb_array_elements(p_rows) AS t(e) LOOP
    v_id     := (v_elem->>'id')::bigint;
    v_label  := v_elem->>'action_label';
    v_actor  := v_elem->>'action_actor';
    v_unsure := COALESCE((v_elem->>'uncertain')::boolean, false);
    v_source := NULL;

    UPDATE public.stories s
       SET action_label        = v_label,
           action_actor        = v_actor,
           action_label_source = 'backfill'
     WHERE s.id = v_id
       AND s.action_label IS NULL
    RETURNING s.action_label_source INTO v_source;

    story_id  := v_id;
    uncertain := v_unsure;

    IF v_source = 'backfill' THEN
      outcome := 'written';
      IF v_unsure THEN
        INSERT INTO public.pipeline_skips (pipeline, reason, entity_type, entity_id, metadata)
        VALUES ('label_backfill', 'label_uncertain', 'story', v_id::text,
                jsonb_build_object('run_id', p_run_id, 'action_label', v_label, 'action_actor', v_actor));
      END IF;
    ELSE
      SELECT s.action_label_source INTO v_source FROM public.stories s WHERE s.id = v_id;
      IF FOUND THEN
        outcome := 'already_labeled';
        INSERT INTO public.pipeline_skips (pipeline, reason, entity_type, entity_id, metadata)
        VALUES ('label_backfill', 'already_labeled', 'story', v_id::text,
                jsonb_build_object('run_id', p_run_id, 'existing_source', v_source,
                                   'proposed_label', v_label, 'proposed_actor', v_actor));
      ELSE
        outcome := 'not_found';
        INSERT INTO public.pipeline_skips (pipeline, reason, entity_type, entity_id, metadata)
        VALUES ('label_backfill', 'story_not_found', 'story', v_id::text,
                jsonb_build_object('run_id', p_run_id));
      END IF;
    END IF;

    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.record_action_labels(TEXT, JSONB) IS
  'ADO-594 S3: records one page (1-50 rows) of backfill labels atomically. Checks every row first (one bad row = exception, nothing written), then writes action_label/action_actor with source backfill ONLY where action_label IS NULL (never overwrites an agent or human label). Rows not written leave pipeline_skips label_backfill/already_labeled or story_not_found; uncertain labels leave label_backfill/label_uncertain. Returns story_id, outcome, uncertain per input row. service_role only. Writer: scripts/maintenance/label-backfill-db.js';

REVOKE ALL ON FUNCTION public.record_action_labels(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_action_labels(TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Read-only check. Expect: backfill_pool = active enriched stories without a
-- label (750 on TEST before the first run), backfill_labeled = 0 on a fresh apply,
-- candidates_rpc = 1, record_rpc = 1.
SELECT
  (SELECT count(*) FROM public.stories
    WHERE status = 'active' AND summary_neutral IS NOT NULL AND action_label IS NULL) AS backfill_pool,
  (SELECT count(*) FROM public.stories WHERE action_label_source = 'backfill') AS backfill_labeled,
  (SELECT count(*) FROM pg_proc WHERE proname = 'label_backfill_candidates') AS candidates_rpc,
  (SELECT count(*) FROM pg_proc WHERE proname = 'record_action_labels') AS record_rpc;

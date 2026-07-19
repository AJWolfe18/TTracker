-- Migration: 105_unmerge_story.sql
-- Purpose: ADO-537 phase 2 — reverse a wrong story merge from the admin Judge tab.
--   merge_stories (100/101/102) snapshots the loser's article membership to story_merge_audit before
--   repointing. This migration adds the reverse path:
--     A) story_merge_audit.unmerged_at — marks a snapshot as consumed (prevents double-unmerge)
--     B) clustering_judge_log verdict CHECK gains 'unmerge' (audit trail rows for reversals)
--     C) recompute_story_from_members(p_story_id) — shared stats recompute (centroid, entities,
--        source_count, recency) used for BOTH stories after an unmerge
--     D) unmerge_story(p_loser_id, p_run_id) — restores the loser from its latest unconsumed snapshot
--
-- KNOWN IRREVERSIBLES (accepted, documented): merge_stories widened the survivor's
--   first_seen_at/last_updated_at (LEAST/GREATEST) and unioned the loser's topic_slugs into it.
--   Those cannot be cleanly reversed (originals not snapshotted) and are left as-is on unmerge;
--   they are cosmetic and self-heal on the survivor's next enrichment. Articles attached to the
--   survivor AFTER the merge stay on the survivor — only the snapshot articles move back.
--
-- ⚠️ DEPLOY ORDER (same rule as 104): apply THIS MIGRATION before deploying the updated
--   admin-judge-merge edge function, or unmerge requests fail with "function not found".
--
-- SECURITY: both new functions are SECURITY DEFINER, locked search_path, EXECUTE revoked from
--   PUBLIC/anon/authenticated, granted only to service_role (migration 095/096 pattern).

-- ============================================================================
-- PART A: story_merge_audit.unmerged_at
-- ============================================================================

ALTER TABLE story_merge_audit
  ADD COLUMN IF NOT EXISTS unmerged_at TIMESTAMPTZ;

COMMENT ON COLUMN story_merge_audit.unmerged_at IS
  'ADO-537: set when unmerge_story consumed this snapshot to reverse the merge. NULL = merge still in effect (or loser re-merged later under a newer snapshot).';

-- ============================================================================
-- PART B: allow 'unmerge' in clustering_judge_log.verdict
-- ============================================================================
-- Inline CHECK from migration 100's CREATE TABLE was auto-named clustering_judge_log_verdict_check.

ALTER TABLE clustering_judge_log DROP CONSTRAINT IF EXISTS clustering_judge_log_verdict_check;
ALTER TABLE clustering_judge_log
  ADD CONSTRAINT clustering_judge_log_verdict_check
    CHECK (verdict IN ('merge', 'keep', 'uncertain', 'unmerge'));

-- ============================================================================
-- PART C: recompute_story_from_members(p_story_id)
-- ============================================================================
-- Same recompute recipe as merge_stories steps 3/4/5/P2 (centroid AVG, entity counter + top-5,
-- source recount, latest_article_published_at), extracted so unmerge can apply it to BOTH the
-- restored loser and the shrunken survivor. Does NOT touch first_seen_at/last_updated_at/topic_slugs
-- (see IRREVERSIBLES note above).

CREATE OR REPLACE FUNCTION public.recompute_story_from_members(p_story_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  WITH sa AS (
    SELECT a.embedding_v1, a.published_at
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    WHERE asg.story_id = p_story_id
  ),
  ctr AS (
    SELECT AVG(embedding_v1) AS exact_centroid
    FROM sa WHERE embedding_v1 IS NOT NULL
  ),
  recency AS (
    SELECT MAX(published_at) AS max_pub FROM sa
  ),
  ent_counts AS (
    SELECT (ent->>'id') AS entity_id, COUNT(*)::int AS cnt
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.entities, '[]'::jsonb)) ent
    WHERE asg.story_id = p_story_id
      AND (ent->>'id') IS NOT NULL AND (ent->>'id') <> ''
    GROUP BY (ent->>'id')
  ),
  counter AS (
    SELECT
      COALESCE(jsonb_object_agg(entity_id, cnt), '{}'::jsonb) AS counter_json,
      COALESCE(ARRAY(
        SELECT entity_id FROM ent_counts
        ORDER BY cnt DESC, entity_id ASC
        LIMIT 5
      ), ARRAY[]::text[]) AS top5
    FROM ent_counts
  ),
  cnt AS (
    SELECT COUNT(*)::int AS n FROM article_story WHERE story_id = p_story_id
  )
  UPDATE stories s
  SET centroid_embedding_v1       = COALESCE((SELECT exact_centroid FROM ctr), s.centroid_embedding_v1),
      entity_counter              = (SELECT counter_json FROM counter),
      top_entities                = (SELECT top5 FROM counter),
      latest_article_published_at = COALESCE((SELECT max_pub FROM recency), s.latest_article_published_at),
      source_count                = (SELECT n FROM cnt)
  WHERE s.id = p_story_id;
END;
$$;

COMMENT ON FUNCTION public.recompute_story_from_members(BIGINT) IS
  'ADO-537: recompute centroid/entity_counter/top_entities/latest_article_published_at/source_count from current article_story members (merge_stories recipe). Used by unmerge_story on both stories. service_role only.';

-- ============================================================================
-- PART D: unmerge_story(p_loser_id, p_run_id)
-- ============================================================================
-- Restores the most recent un-consumed merge of p_loser_id: repoints the snapshot articles back
-- from the survivor, clears the tombstone, recomputes both stories, marks the snapshot consumed.
-- Concurrency: locks both story rows FOR UPDATE in ascending id order (same as merge_stories 102).
-- Idempotent-safe: a loser that is not currently tombstoned returns not_merged (no-op).

CREATE OR REPLACE FUNCTION public.unmerge_story(
  p_loser_id BIGINT,
  p_run_id   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_audit_id     BIGINT;
  v_survivor_id  BIGINT;
  v_article_ids  TEXT[];
  v_loser_status TEXT;
  v_loser_merged BIGINT;
  v_surv_status  TEXT;
  v_surv_merged  BIGINT;
  v_moved        INT := 0;
BEGIN
  IF p_loser_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ids');
  END IF;
  IF p_run_id IS NULL OR p_run_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_run_id');
  END IF;

  -- Latest un-consumed snapshot for this loser.
  SELECT id, survivor_id, loser_article_ids
    INTO v_audit_id, v_survivor_id, v_article_ids
    FROM story_merge_audit
    WHERE loser_id = p_loser_id AND unmerged_at IS NULL
    ORDER BY merged_at DESC, id DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_merge_snapshot');
  END IF;

  -- Lock both story rows in ascending id order (deadlock-safe, serializes vs merge_stories).
  PERFORM 1 FROM stories WHERE id IN (p_loser_id, v_survivor_id) ORDER BY id FOR UPDATE;

  SELECT status, merged_into_story_id
    INTO v_loser_status, v_loser_merged
    FROM stories WHERE id = p_loser_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'loser_not_found');
  END IF;

  -- Only reverse a merge that is actually in effect and matches the snapshot.
  IF v_loser_status <> 'merged_into' OR v_loser_merged IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_merged');
  END IF;
  IF v_loser_merged <> v_survivor_id THEN
    -- Tombstone points somewhere the snapshot doesn't know about (shouldn't happen; refuse).
    RETURN jsonb_build_object('ok', false, 'reason', 'snapshot_mismatch',
                              'tombstone_points_to', v_loser_merged,
                              'snapshot_survivor', v_survivor_id);
  END IF;

  -- The survivor must still be a live story. If it was itself merged away after the original merge
  -- (live Judge keeps running), the snapshot articles have moved on to a NEWER survivor — restoring
  -- here would resurrect an empty shell and report success. Refuse with the forwarding pointer so
  -- the operator can unmerge at the current survivor level instead.
  SELECT status, merged_into_story_id
    INTO v_surv_status, v_surv_merged
    FROM stories WHERE id = v_survivor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_not_found');
  END IF;
  IF v_surv_status = 'merged_into' OR v_surv_merged IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_moved',
                              'survivor_points_to', v_surv_merged);
  END IF;

  -- Move the snapshot articles back. Only rows still sitting on the survivor move; articles
  -- deleted or re-clustered elsewhere since the merge are skipped (article_story is UNIQUE(article_id)).
  UPDATE article_story
  SET story_id = p_loser_id
  WHERE story_id = v_survivor_id
    AND article_id = ANY(COALESCE(v_article_ids, ARRAY[]::text[]));
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Restore the loser as a live story.
  UPDATE stories
  SET status = 'active',
      merged_into_story_id = NULL
  WHERE id = p_loser_id;

  -- Recompute both sides from their current members.
  PERFORM recompute_story_from_members(p_loser_id);
  PERFORM recompute_story_from_members(v_survivor_id);

  -- Consume the snapshot.
  UPDATE story_merge_audit SET unmerged_at = NOW() WHERE id = v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'loser_id', p_loser_id,
    'survivor_id', v_survivor_id,
    'articles_restored', v_moved,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.unmerge_story(BIGINT, TEXT) IS
  'ADO-537: reverse the latest merge of p_loser_id using its story_merge_audit snapshot. Repoints snapshot articles back, clears the tombstone, recomputes both stories, marks the snapshot consumed. Row-locked, idempotent-safe. service_role only.';

-- ============================================================================
-- PART E: security lockdown (migration 095/096 pattern)
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      (p.proname = 'unmerge_story'                AND p.pronargs = 2) OR
      (p.proname = 'recompute_story_from_members' AND p.pronargs = 1)
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) Column + constraint:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='story_merge_audit' AND column_name='unmerged_at';
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='clustering_judge_log_verdict_check';
--    -- expect 'unmerge' in the verdict list
-- 2) Grants (expect anon=f, authenticated=f, service_role=t for both):
--    SELECT p.proname,
--           has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--           has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('unmerge_story','recompute_story_from_members');

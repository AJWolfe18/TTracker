-- Migration: 102_merge_stories_concurrency.sql
-- Purpose: Concurrency-harden merge_stories before the Clustering Judge goes live (ADO-533).
--   Migration 101 (already applied to TEST) created the 3-arg merge_stories. A Codex review of that
--   commit found two concurrency defects; this migration CREATE OR REPLACEs merge_stories (same
--   3-arg signature, so no DROP / no arity change / grants persist) with both fixed:
--
--   P1 — lost-update race on the tombstone pointer. merge_stories validated loser/survivor state, then
--        later tombstoned with `WHERE id = p_loser_id` with nothing holding a row lock in between. Two
--        overlapping calls for the same loser could both pass the "already merged?" check and race, so the
--        loser could end up pointing at a different survivor than the one now holding its articles.
--        Fix: SELECT ... FOR UPDATE both story rows in ascending id order up front (id order avoids
--        A->B / B->A deadlocks); the second caller then blocks, re-reads status='merged_into', and
--        returns skipped=true.
--
--   P2 — non-atomic per-run merge cap. The cap read merge_count, did the merge, then incremented — so
--        parallel calls with the same p_run_id could all observe count < cap and collectively exceed it.
--        Fix: reserve the slot atomically BEFORE mutating anything, via
--        INSERT ... ON CONFLICT (run_id) DO UPDATE SET merge_count = merge_count + 1
--          WHERE merge_count < cap RETURNING merge_count. If the WHERE fails (already at cap) no row is
--        returned -> abort with run_merge_cap_reached. Because the whole function is one transaction, the
--        reservation rolls back with the merge if any later step throws (no over-count on failure).
--
-- Everything else (P2 recency/slug recompute, reversibility snapshot, tombstone) is unchanged from 101.
-- Apply to TEST first, then PROD, before enabling the live cron.

CREATE OR REPLACE FUNCTION public.merge_stories(
  p_loser_id    BIGINT,
  p_survivor_id BIGINT,
  p_run_id      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_merge_cap CONSTANT INT := 10;   -- hard per-run cap (matches prompt cap)
  v_run_count INT;
  v_loser_status      TEXT;
  v_loser_merged      BIGINT;
  v_loser_first_seen  TIMESTAMPTZ;
  v_loser_last_upd    TIMESTAMPTZ;
  v_surv_status       TEXT;
  v_surv_merged       BIGINT;
  v_loser_article_ids TEXT[];
  v_moved   INT := 0;
  v_new_count INT := 0;
BEGIN
  -- 1. Validate
  IF p_loser_id IS NULL OR p_survivor_id IS NULL OR p_loser_id = p_survivor_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ids');
  END IF;

  -- 1a. Lock both story rows in ascending id order to serialize concurrent merges of the same
  --     loser/survivor and prevent a lost-update race on the tombstone pointer (Codex P1). Ordering by
  --     id avoids A->B / B->A deadlocks. Rows that don't exist are simply not locked; the NOT FOUND
  --     checks below still catch a missing loser/survivor.
  PERFORM 1 FROM stories WHERE id IN (p_loser_id, p_survivor_id) ORDER BY id FOR UPDATE;

  SELECT status, merged_into_story_id, first_seen_at, last_updated_at
    INTO v_loser_status, v_loser_merged, v_loser_first_seen, v_loser_last_upd
    FROM stories WHERE id = p_loser_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'loser_not_found');
  END IF;

  SELECT status, merged_into_story_id
    INTO v_surv_status, v_surv_merged
    FROM stories WHERE id = p_survivor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_not_found');
  END IF;

  -- Already merged (idempotent no-op) — do not double-merge or reopen a tombstone.
  IF v_loser_status = 'merged_into' OR v_loser_merged IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'loser_already_merged',
                              'survivor_id', v_loser_merged);
  END IF;
  IF v_surv_status = 'merged_into' OR v_surv_merged IS NOT NULL THEN
    -- Refuse to merge into a tombstone; caller should target the ultimate survivor.
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_is_merged',
                              'survivor_points_to', v_surv_merged);
  END IF;

  -- 1b. Atomically reserve a merge slot against the per-run hard cap BEFORE mutating anything (Codex P2).
  --     ON CONFLICT ... WHERE merge_count < cap makes check-and-increment one atomic step, so concurrent
  --     same-run calls cannot collectively exceed the cap. No row returned => already at cap => abort.
  --     Rolls back with the transaction if a later merge step throws (never over-counts on failure).
  IF p_run_id IS NOT NULL THEN
    INSERT INTO judge_run_merge_count (run_id, merge_count, updated_at)
    VALUES (p_run_id, 1, NOW())
    ON CONFLICT (run_id) DO UPDATE
      SET merge_count = judge_run_merge_count.merge_count + 1, updated_at = NOW()
      WHERE judge_run_merge_count.merge_count < v_merge_cap
    RETURNING merge_count INTO v_run_count;
    IF v_run_count IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'run_merge_cap_reached',
                                'cap', v_merge_cap, 'run_id', p_run_id);
    END IF;
  END IF;

  -- 1c. Snapshot the loser's article membership BEFORE repointing, so a wrong merge is reversible.
  SELECT COALESCE(ARRAY_AGG(article_id), ARRAY[]::text[])
    INTO v_loser_article_ids
    FROM article_story WHERE story_id = p_loser_id;
  INSERT INTO story_merge_audit (run_id, loser_id, survivor_id, loser_article_ids)
  VALUES (p_run_id, p_loser_id, p_survivor_id, v_loser_article_ids);

  -- 2. Repoint article_story loser -> survivor.
  UPDATE article_story a
  SET story_id = p_survivor_id
  WHERE a.story_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM article_story b
      WHERE b.story_id = p_survivor_id AND b.article_id = a.article_id
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Drop any loser links that couldn't move (article already on survivor).
  DELETE FROM article_story WHERE story_id = p_loser_id;

  -- 3 + 4 + P2. Recompute survivor centroid + entity_counter + top_entities + latest_article_published_at
  -- from its (now-merged) members; widen time span; union the loser's topic_slugs (clustering bridge).
  WITH sa AS (
    SELECT a.embedding_v1, a.published_at
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    WHERE asg.story_id = p_survivor_id
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
    WHERE asg.story_id = p_survivor_id
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
  -- Union survivor + loser topic_slugs (dedup, drop NULLs) so the slug candidate block still matches
  -- future articles that would have hit the loser's unique slugs. ADO-533 P2.
  slugs AS (
    SELECT COALESCE(ARRAY(
      SELECT DISTINCT sl FROM (
        SELECT unnest(COALESCE((SELECT topic_slugs FROM stories WHERE id = p_survivor_id), ARRAY[]::text[])) AS sl
        UNION
        SELECT unnest(COALESCE((SELECT topic_slugs FROM stories WHERE id = p_loser_id), ARRAY[]::text[])) AS sl
      ) u
      WHERE sl IS NOT NULL AND sl <> ''
    ), ARRAY[]::text[]) AS merged_slugs
  )
  UPDATE stories s
  SET centroid_embedding_v1      = COALESCE((SELECT exact_centroid FROM ctr), s.centroid_embedding_v1),
      entity_counter             = (SELECT counter_json FROM counter),
      top_entities               = (SELECT top5 FROM counter),
      topic_slugs                = (SELECT merged_slugs FROM slugs),
      latest_article_published_at = COALESCE((SELECT max_pub FROM recency), s.latest_article_published_at),
      first_seen_at              = LEAST(s.first_seen_at, v_loser_first_seen),
      last_updated_at            = GREATEST(s.last_updated_at, v_loser_last_upd)
  WHERE s.id = p_survivor_id;

  -- 5. Recount source_count from actual member rows.
  SELECT COUNT(*)::int INTO v_new_count FROM article_story WHERE story_id = p_survivor_id;
  UPDATE stories SET source_count = v_new_count WHERE id = p_survivor_id;

  -- 6. Tombstone the loser (redirect, never delete).
  UPDATE stories
  SET status = 'merged_into',
      merged_into_story_id = p_survivor_id
  WHERE id = p_loser_id;

  -- (cap slot already reserved+incremented atomically in step 1b — no post-merge increment needed.)

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'loser_id', p_loser_id,
    'survivor_id', p_survivor_id,
    'articles_moved', v_moved,
    'survivor_source_count', v_new_count
  );
END;
$$;

COMMENT ON FUNCTION public.merge_stories(BIGINT, BIGINT, TEXT) IS
  'ADO-533: merge loser story into survivor. Locks both rows FOR UPDATE (concurrency-safe), atomically reserves the per-run cap slot, repoints article_story, recomputes survivor centroid/entity_counter/top_entities/latest_article_published_at/source_count, unions topic_slugs, widens time span, snapshots loser membership (story_merge_audit), tombstones loser. Atomic, idempotent, never deletes. service_role only.';

-- Re-assert the lockdown (grants persist across CREATE OR REPLACE; this is idempotent belt-and-suspenders).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'merge_stories' AND p.pronargs = 3
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) Function body now takes the row lock + atomic reservation:
--    SELECT pg_get_functiondef('merge_stories(bigint,bigint,text)'::regprocedure) LIKE '%FOR UPDATE%'
--       AND pg_get_functiondef('merge_stories(bigint,bigint,text)'::regprocedure) LIKE '%merge_count < v_merge_cap%';
-- 2) Still service_role-only (expect one row, pronargs=3, anon=f, authenticated=f, service_role=t):
--    SELECT p.pronargs,
--           has_function_privilege('anon',          p.oid,'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid,'EXECUTE') AS authenticated,
--           has_function_privilege('service_role',  p.oid,'EXECUTE') AS service_role
--    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='merge_stories';

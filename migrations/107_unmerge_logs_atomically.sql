-- ============================================================================
-- Migration 107: unmerge_story writes its own verdict row (ADO-539, Codex PR #113 P1)
-- ============================================================================
-- Problem: the 'unmerge' clustering_judge_log row is the Judge's MEMORY that a human ruled
-- "keep these separate" (migration 106 suppresses the pair on it). But unmerge_story committed
-- first and the admin-judge-merge edge function inserted that row afterwards, best-effort —
-- if the insert failed, the unmerge stood with NO memory row, and the next Judge run could
-- re-merge the pair, silently overriding the human. The safety claim of 106 was only as
-- reliable as a post-commit HTTP insert.
-- Fix: unmerge_story inserts the verdict row itself, inside the same transaction as the
-- unmerge. The edge function's own insert is removed (deploy the updated admin-judge-merge
-- AFTER applying this; in the window between, unmerges double-log — two identical 'unmerge'
-- rows, harmless for memory and merely cosmetic in the Judge tab).
-- evidence_as_of stays NULL on this row: created_at is stamped in the same transaction, and
-- unmerge never touches article_story.matched_at, so membership is strictly older — the
-- COALESCE fallback in 106 gives exactly the right suppression semantics.
-- Rollback: re-run migration 105 PART D (restores the non-logging body).
-- Idempotent: CREATE OR REPLACE, same signature → ACLs from 105 PART E are preserved.

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
  v_audit_id        BIGINT;
  v_survivor_id     BIGINT;
  v_article_ids     TEXT[];
  v_locked_survivor BIGINT;
  v_loser_status    TEXT;
  v_loser_merged    BIGINT;
  v_surv_status     TEXT;
  v_surv_merged     BIGINT;
  v_moved           INT := 0;
BEGIN
  IF p_loser_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ids');
  END IF;
  IF p_run_id IS NULL OR p_run_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_run_id');
  END IF;

  -- Latest un-consumed snapshot for this loser. PRE-LOCK pass: this only identifies which
  -- survivor row to lock — the authoritative read happens again below, under the locks.
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

  -- Re-read the snapshot now that we hold the locks (codex P2 on PR #109): in the pre-lock
  -- window a concurrent unmerge could have consumed the row we selected and a re-merge written
  -- a fresh one — acting on the stale copy would restore an outdated article set and leave the
  -- new snapshot unconsumed. unmerge_story/merge_stories callers serialize on these story-row
  -- locks, so this second read is authoritative.
  v_locked_survivor := v_survivor_id;
  SELECT id, survivor_id, loser_article_ids
    INTO v_audit_id, v_survivor_id, v_article_ids
    FROM story_merge_audit
    WHERE loser_id = p_loser_id AND unmerged_at IS NULL
    ORDER BY merged_at DESC, id DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_merge_snapshot');
  END IF;
  IF v_survivor_id <> v_locked_survivor THEN
    -- The pair changed while we waited for the locks — we hold locks on the wrong survivor row.
    -- Refuse rather than proceed; the caller just retries against the current state.
    RETURN jsonb_build_object('ok', false, 'reason', 'snapshot_changed');
  END IF;

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

  -- ADO-539 (Codex PR #113 P1): this row IS the Judge's memory that the pair must stay
  -- separate (migration 106 suppresses on it, and 'unmerge' is the one verdict whose loss
  -- lets the Judge override a human). Written here, in the unmerge's own transaction, so the
  -- memory cannot be lost to a failed post-commit insert. Human unmerges are the only callers
  -- of this function, hence source='manual'.
  INSERT INTO clustering_judge_log
    (source, story_id_a, story_id_b, headline_a, headline_b,
     verdict, rationale, merged, dry_run, run_id)
  SELECT 'manual', v_survivor_id, p_loser_id, ss.primary_headline, ls.primary_headline,
         'unmerge',
         format('Manual unmerge via admin Judge tab: #%s restored from #%s', p_loser_id, v_survivor_id),
         false, false, p_run_id
  FROM stories ss
  JOIN stories ls ON ls.id = p_loser_id
  WHERE ss.id = v_survivor_id;

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
  'ADO-537/539: reverse the latest merge of p_loser_id using its story_merge_audit snapshot. Repoints snapshot articles back, clears the tombstone, recomputes both stories, marks the snapshot consumed, and writes the ''unmerge'' clustering_judge_log row ATOMICALLY (the row is verdict memory — migration 106). Row-locked, idempotent-safe. service_role only.';

-- Same-signature CREATE OR REPLACE preserves the 105 PART E ACLs, but re-assert them anyway
-- (idempotent; keeps the advisor quiet if 105 was ever applied out of order).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'unmerge_story' AND p.pronargs = 2
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) Function is one row and its body mentions clustering_judge_log:
--    SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='unmerge_story';   -- expect 1
--    SELECT prosrc LIKE '%clustering_judge_log%' FROM pg_proc WHERE proname='unmerge_story';  -- expect t
-- 2) Grants (expect anon=f, authenticated=f, service_role=t):
--    SELECT has_function_privilege('anon', 'public.unmerge_story(bigint,text)', 'EXECUTE') AS anon,
--           has_function_privilege('service_role', 'public.unmerge_story(bigint,text)', 'EXECUTE') AS service_role;

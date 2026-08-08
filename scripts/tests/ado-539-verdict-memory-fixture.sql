-- ============================================================================
-- ADO-539 Task 1 Step 3 + 3b: verdict-memory fixture tests for migration 106
-- ============================================================================
-- RUN THIS ON **TEST** (project wnrjrywpcadwutfykflu) in the Supabase SQL Editor,
-- AFTER pasting migrations/106_judge_verdict_memory.sql.
--
-- Everything runs inside a transaction that ends in ROLLBACK, so it writes NOTHING
-- permanently -- no fixture rows to clean up, no real matched_at left mutated.
-- Results print as NOTICE lines; read them bottom-up in the editor output pane.
--
-- It self-selects a candidate pair where BOTH sides actually have article_story
-- rows, which avoids the known TEST gotcha: the highest source_count stories are
-- QA-concurrency fixtures reporting 10 with ZERO membership, and the reopen test
-- silently no-ops on those.
--
-- Expected: every check prints PASS. Any FAIL blocks the PROD deploy of 106.

BEGIN;

DO $$
DECLARE
  a_id     BIGINT;
  b_id     BIGINT;
  n        INT;
  art      TEXT;
  old_ts   TIMESTAMPTZ;
  passes   INT := 0;
  fails    INT := 0;
BEGIN
  -- ---------------------------------------------------------------------
  -- Pick a pair from the RPC where both sides have real membership.
  -- Similarity threshold is relaxed (0.75) and the window widened (30d) so this
  -- finds something on a quiet TEST database.
  -- ---------------------------------------------------------------------
  SELECT c.story_id_a, c.story_id_b
    INTO a_id, b_id
  FROM get_clustering_judge_candidates(0.75, 30, 50) c
  WHERE EXISTS (SELECT 1 FROM article_story m WHERE m.story_id = c.story_id_a)
    AND EXISTS (SELECT 1 FROM article_story m WHERE m.story_id = c.story_id_b)
  LIMIT 1;

  IF a_id IS NULL THEN
    RAISE NOTICE 'SKIP: no candidate pair with membership on both sides. Widen p_days or lower p_min_sim and re-run.';
    RETURN;
  END IF;
  RAISE NOTICE 'Using pair (a=%, b=%)', a_id, b_id;

  -- (c) A live verdict newer than any matched_at must SUPPRESS the pair.
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES
    ('judge-agent', 'ado-539-fixture', a_id, b_id, 'keep', 0.9, 'ADO-539 fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 0 THEN passes := passes + 1; RAISE NOTICE 'PASS (c): live verdict suppresses the pair';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (c): pair still returned after a live keep verdict'; END IF;

  -- (f) A DRY-RUN verdict must NOT suppress. Flip the fixture row and re-check.
  UPDATE clustering_judge_log SET dry_run = true WHERE run_id = 'ado-539-fixture';
  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (f): dry-run verdict does NOT suppress';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (f): dry-run row suppressed the pair (or pair vanished for another reason)'; END IF;
  UPDATE clustering_judge_log SET dry_run = false WHERE run_id = 'ado-539-fixture';

  -- (e) A NEW article attaching (matched_at bumped past the verdict) must REOPEN the pair.
  SELECT m.article_id, m.matched_at INTO art, old_ts
    FROM article_story m WHERE m.story_id = a_id LIMIT 1;
  UPDATE article_story SET matched_at = NOW() + INTERVAL '1 minute'
   WHERE story_id = a_id AND article_id = art;

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (e): newer membership reopens the pair';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (e): pair did not reopen after a newer matched_at'; END IF;

  UPDATE article_story SET matched_at = old_ts WHERE story_id = a_id AND article_id = art;

  -- (j) UNMERGE SAFETY: a human 'unmerge' verdict is authoritative "keep separate"
  -- and must suppress. Stored id order is deliberately REVERSED here because manual
  -- rows can store either order -- this exercises the LEAST/GREATEST normalization.
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES
    ('manual', 'ado-539-fixture', b_id, a_id, 'unmerge', 1.0, 'ADO-539 unmerge fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 0 THEN passes := passes + 1; RAISE NOTICE 'PASS (j): reverse-order unmerge row suppresses (LEAST/GREATEST normalization works)';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (j): Judge could re-merge a human unmerge -- BLOCKER'; END IF;

  -- (m) CAP-DEFERRAL SAFETY: a 'merge' verdict logged with merged=false was decided but
  -- NOT executed (run cap of 10 hit, or merge_stories returned ok:false). The prompt defers
  -- those to the next run, so they must NOT create memory -- otherwise "deferred" silently
  -- becomes "dropped forever", since a failed merge never touches matched_at.
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES
    ('judge-agent', 'ado-539-fixture', a_id, b_id, 'merge', 0.9, 'cap_reached', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (m): cap-deferred merge does NOT suppress (pair retried next run)';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (m): a cap_reached merge suppressed the pair -- deferred merges would be silently dropped'; END IF;

  -- Heartbeat rows (both ids NULL) must never suppress anything.
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES
    ('judge-agent', 'ado-539-fixture', NULL, NULL, 'keep', 0.5, 'ADO-539 heartbeat fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 50) c
   WHERE c.story_id_a = a_id AND c.story_id_b = b_id;
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (h): heartbeat rows do not suppress';
  ELSE fails := fails + 1; RAISE NOTICE 'FAIL (h): a NULL-id heartbeat row suppressed a real pair'; END IF;

  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'ADO-539 verdict-memory fixtures: % passed, % failed', passes, fails;
  IF fails > 0 THEN
    RAISE NOTICE 'DO NOT deploy migration 106 to PROD until these pass.';
  END IF;
END $$;

-- Nothing above is kept: no fixture log rows, no mutated matched_at.
ROLLBACK;

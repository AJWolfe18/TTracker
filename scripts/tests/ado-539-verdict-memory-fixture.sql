-- ============================================================================
-- ADO-539: verdict-memory fixture tests for migration 106
-- ============================================================================
-- RUN ON **TEST** (project wnrjrywpcadwutfykflu) AFTER applying the CURRENT
-- migrations/106_judge_verdict_memory.sql (the post-Codex version: it adds
-- clustering_judge_log.evidence_as_of and the LEAST/COALESCE clamp — checks
-- r/s/t below fail loudly on the pre-Codex version because the column is missing).
--
-- The original six checks (c/f/m/j/e/h) were EXECUTED AND PASSED on TEST
-- 2026-08-08 via PostgREST (pair 16981/17005, centroid_sim 0.8966). Checks
-- r/s/t were added for the Codex PR #113 evidence-snapshot findings. This file
-- runs everything as a single transaction so it can be re-verified after any
-- change to the RPC.
--
-- Everything is inside BEGIN ... ROLLBACK: it writes nothing permanently and
-- can be re-run freely. Any failure RAISES EXCEPTION -- a gate that did not run
-- must be loud, never a quiet "0 passed, 0 failed".
--
-- NOTE ON THRESHOLDS: p_min_sim is deliberately 0.1 and p_days 60. TEST is a
-- small database -- at the production 0.83/7d settings it has ZERO candidate
-- pairs, so a fixture using production knobs would silently validate nothing.
-- The memory predicate under test is independent of the similarity threshold.

BEGIN;

DO $$
DECLARE
  a_id     BIGINT;
  b_id     BIGINT;
  art      TEXT;
  old_ts   TIMESTAMPTZ;
  max_mt   TIMESTAMPTZ;
  n        INT;
  passes   INT := 0;
  fails    INT := 0;
BEGIN
  -- Pick any real candidate pair where BOTH sides have article_story membership.
  -- (Membership matters: the reopen check is a no-op on a story with no articles.)
  SELECT c.story_id_a, c.story_id_b INTO a_id, b_id
  FROM get_clustering_judge_candidates(0.1, 60, 200) c
  WHERE EXISTS (SELECT 1 FROM article_story m WHERE m.story_id = c.story_id_a)
    AND EXISTS (SELECT 1 FROM article_story m WHERE m.story_id = c.story_id_b)
  LIMIT 1;

  IF a_id IS NULL THEN
    RAISE EXCEPTION 'ADO-539 fixture: no candidate pair with membership on both sides - cannot validate.';
  END IF;
  RAISE NOTICE 'Using pair (a=%, b=%)', a_id, b_id;

  -- (c) A live SETTLED verdict newer than membership must SUPPRESS.
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES ('judge-agent', 'ado-539-fixture', a_id, b_id, 'keep', 0.9, 'fixture c', false, false);

  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 0 THEN passes := passes + 1; RAISE NOTICE 'PASS (c): live keep verdict suppresses the pair';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (c): pair still returned after a live keep verdict'; END IF;

  -- (f) DRY-RUN rows must NOT suppress: offline validation must never silence live judging.
  UPDATE clustering_judge_log SET dry_run = true WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (f): dry-run verdict does NOT suppress';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (f): a dry-run row suppressed the pair'; END IF;

  -- (m) CAP-DEFERRAL: a 'merge' logged with merged=false was decided but NOT executed
  -- (run cap of 10, or merge_stories ok:false). The prompt defers those to the next run,
  -- so they must not create memory -- otherwise "deferred" silently becomes "dropped
  -- forever", since a failed merge never touches matched_at.
  UPDATE clustering_judge_log
     SET dry_run = false, verdict = 'merge', merged = false, rationale = 'cap_reached'
   WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (m): cap-deferred merge does NOT suppress';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (m): cap_reached merge suppressed the pair - deferred merges would be dropped'; END IF;

  -- (j) UNMERGE SAFETY, ids stored in REVERSE order on purpose: manual rows can store
  -- either order, so this also exercises the LEAST/GREATEST normalization.
  UPDATE clustering_judge_log
     SET source = 'manual', verdict = 'unmerge', merged = false, dry_run = false,
         story_id_a = b_id, story_id_b = a_id
   WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 0 THEN passes := passes + 1; RAISE NOTICE 'PASS (j): reverse-order unmerge suppresses (LEAST/GREATEST works)';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (j): Judge could re-merge a human unmerge -- BLOCKER'; END IF;

  -- (e) A NEW article attaching must REOPEN, even over that unmerge verdict.
  SELECT m.article_id, m.matched_at INTO art, old_ts
    FROM article_story m WHERE m.story_id = a_id LIMIT 1;
  UPDATE article_story SET matched_at = NOW() + INTERVAL '1 day' WHERE article_id = art;

  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (e): newer membership reopens the pair';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (e): pair did not reopen after a newer matched_at'; END IF;

  UPDATE article_story SET matched_at = old_ts WHERE article_id = art;

  -- ── Evidence-snapshot checks (Codex PR #113 P1): memory anchors to when the agent
  -- READ the evidence (evidence_as_of, clamped to created_at), not the insert time. ──

  -- Reset the row to a plain live keep in normal id order for the next three checks.
  UPDATE clustering_judge_log
     SET source = 'judge-agent', verdict = 'keep', merged = false, dry_run = false,
         story_id_a = a_id, story_id_b = b_id, rationale = 'fixture evidence_as_of'
   WHERE run_id = 'ado-539-fixture';

  max_mt := GREATEST(
    (SELECT max(m.matched_at) FROM article_story m WHERE m.story_id = a_id),
    (SELECT max(m.matched_at) FROM article_story m WHERE m.story_id = b_id));

  -- (r) RACE: an article attached AFTER the evidence read but BEFORE the verdict insert
  -- (evidence_as_of < matched_at < created_at) must NOT suppress -- the verdict never saw it.
  UPDATE clustering_judge_log SET evidence_as_of = max_mt - INTERVAL '1 minute'
   WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (r): membership newer than evidence_as_of reopens (mid-deliberation attach is seen)';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (r): a verdict suppressed an article it never saw (created_at out-covered evidence_as_of)'; END IF;

  -- (s) Normal agent case: evidence read AFTER the last attach suppresses.
  UPDATE clustering_judge_log SET evidence_as_of = max_mt + INTERVAL '1 minute'
   WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 0 THEN passes := passes + 1; RAISE NOTICE 'PASS (s): evidence_as_of newer than membership suppresses';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (s): pair returned despite evidence covering all membership'; END IF;

  -- (t) CLAMP: a hallucinated FUTURE evidence_as_of must not out-cover created_at --
  -- LEAST(evidence_as_of, created_at) bounds agent-clock pathology at pre-fix behavior.
  UPDATE clustering_judge_log SET evidence_as_of = NOW() + INTERVAL '10 years'
   WHERE run_id = 'ado-539-fixture';
  UPDATE article_story SET matched_at = NOW() + INTERVAL '1 day' WHERE article_id = art;
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (t): future evidence_as_of clamped to created_at; new article still reopens';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (t): a future evidence_as_of pinned the pair shut past new evidence'; END IF;
  UPDATE article_story SET matched_at = old_ts WHERE article_id = art;
  UPDATE clustering_judge_log SET evidence_as_of = NULL WHERE run_id = 'ado-539-fixture';

  -- (h) Heartbeat rows (both ids NULL) must never suppress a real pair.
  UPDATE clustering_judge_log
     SET source = 'judge-agent', verdict = 'keep', story_id_a = NULL, story_id_b = NULL,
         dry_run = false, rationale = 'fixture h heartbeat'
   WHERE run_id = 'ado-539-fixture';
  n := (SELECT count(*) FROM get_clustering_judge_candidates(0.1, 60, 200) c
         WHERE c.story_id_a = a_id AND c.story_id_b = b_id);
  IF n = 1 THEN passes := passes + 1; RAISE NOTICE 'PASS (h): heartbeat rows do not suppress';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (h): a NULL-id heartbeat row suppressed a real pair'; END IF;

  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'ADO-539 verdict-memory fixtures: % passed, % failed', passes, fails;

  IF fails > 0 THEN
    RAISE EXCEPTION 'ADO-539 fixture: % check(s) FAILED - do NOT deploy migration 106 to PROD.', fails;
  END IF;
END $$;

-- Nothing above is kept.
ROLLBACK;

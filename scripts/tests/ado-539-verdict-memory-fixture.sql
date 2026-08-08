-- ============================================================================
-- ADO-539 Task 1 Step 3 + 3b: verdict-memory fixture tests for migration 106
-- ============================================================================
-- RUN THIS ON **TEST** (project wnrjrywpcadwutfykflu) in the Supabase SQL Editor,
-- AFTER pasting migrations/106_judge_verdict_memory.sql.
--
-- Everything runs inside a transaction that ends in ROLLBACK, so it writes NOTHING
-- permanently. Results print as NOTICE lines.
--
-- It SYNTHESIZES its own disposable story pair rather than hunting for organic
-- candidates. That is deliberate: as of 2026-08-08 the TEST database has only ~12
-- active stories in the last 30 days and `get_clustering_judge_candidates(0.75,30,50)`
-- returns ZERO rows, so a self-selecting fixture would silently validate nothing.
-- Both synthetic stories clone one real story's centroid embedding, so their cosine
-- similarity is exactly 1.0 and they always clear p_min_sim.
--
-- Any failure RAISES EXCEPTION -- an unrun or failing gate must be loud, never a
-- quiet "0 passed, 0 failed".
--
-- Expected: every check prints PASS, then the final NOTICE reports 6 passed, 0 failed.

BEGIN;

DO $$
DECLARE
  src_id   BIGINT;
  a_id     BIGINT;
  b_id     BIGINT;
  art_id   TEXT;
  cols     TEXT;
  n        INT;
  passes   INT := 0;
  fails    INT := 0;

  -- assert helper state
  ok       BOOLEAN;
BEGIN
  -- ---------------------------------------------------------------------
  -- Build two disposable active stories that share a real centroid embedding.
  -- Column list is derived dynamically so this does not break when `stories`
  -- gains columns; only the fields we deliberately override are excluded.
  -- ---------------------------------------------------------------------
  SELECT id INTO src_id
  FROM stories
  WHERE centroid_embedding_v1 IS NOT NULL
  LIMIT 1;

  IF src_id IS NULL THEN
    RAISE EXCEPTION 'ADO-539 fixture: no story with a centroid embedding on this database - cannot synthesize a pair.';
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'stories'
    AND is_generated = 'NEVER'
    AND column_name NOT IN
      ('id','story_hash','primary_headline','first_seen_at','last_updated_at','status','merged_into_story_id');

  EXECUTE format(
    'INSERT INTO stories (story_hash, primary_headline, first_seen_at, last_updated_at, status, merged_into_story_id, %s)
     SELECT $1, $2, NOW(), NOW(), ''active'', NULL, %s FROM stories WHERE id = $3 RETURNING id',
    cols, cols
  ) INTO a_id USING 'ado539-fixture-a-' || gen_random_uuid()::text, 'ADO-539 fixture story A', src_id;

  EXECUTE format(
    'INSERT INTO stories (story_hash, primary_headline, first_seen_at, last_updated_at, status, merged_into_story_id, %s)
     SELECT $1, $2, NOW(), NOW(), ''active'', NULL, %s FROM stories WHERE id = $3 RETURNING id',
    cols, cols
  ) INTO b_id USING 'ado539-fixture-b-' || gen_random_uuid()::text, 'ADO-539 fixture story B', src_id;

  -- Give both sides real membership, stamped in the PAST so a fresh verdict is newer.
  SELECT article_id INTO art_id FROM article_story LIMIT 1;
  IF art_id IS NULL THEN
    RAISE EXCEPTION 'ADO-539 fixture: no article_story rows exist - cannot build membership.';
  END IF;

  INSERT INTO article_story (story_id, article_id, matched_at, is_primary_source, similarity_score)
  VALUES (a_id, art_id, NOW() - INTERVAL '2 hours', true, 1),
         (b_id, art_id, NOW() - INTERVAL '2 hours', true, 1);

  -- Sanity: the synthetic pair must actually be a candidate before we test suppression,
  -- otherwise every later "suppressed" result would be a false PASS.
  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  IF n <> 1 THEN
    RAISE EXCEPTION 'ADO-539 fixture: synthetic pair (%, %) is not a candidate (got % rows) - the fixture itself is broken, results would be meaningless.', a_id, b_id, n;
  END IF;
  RAISE NOTICE 'Synthesized candidate pair (a=%, b=%) from source story %', a_id, b_id, src_id;

  -- ---------------------------------------------------------------------
  -- (c) A live, settled verdict newer than any matched_at must SUPPRESS.
  -- ---------------------------------------------------------------------
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES ('judge-agent', 'ado-539-fixture', a_id, b_id, 'keep', 0.9, 'ADO-539 fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 0);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (c): live keep verdict suppresses the pair';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (c): pair still returned after a live keep verdict'; END IF;

  -- ---------------------------------------------------------------------
  -- (f) DRY-RUN rows must NOT suppress (offline validation must not silence live judging).
  -- ---------------------------------------------------------------------
  UPDATE clustering_judge_log SET dry_run = true WHERE run_id = 'ado-539-fixture';
  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 1);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (f): dry-run verdict does NOT suppress';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (f): a dry-run row suppressed the pair'; END IF;
  UPDATE clustering_judge_log SET dry_run = false WHERE run_id = 'ado-539-fixture';

  -- ---------------------------------------------------------------------
  -- (e) A NEW article attaching (matched_at newer than the verdict) must REOPEN.
  -- ---------------------------------------------------------------------
  UPDATE article_story SET matched_at = NOW() + INTERVAL '1 minute' WHERE story_id = a_id;
  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 1);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (e): newer membership reopens the pair';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (e): pair did not reopen after a newer matched_at'; END IF;
  UPDATE article_story SET matched_at = NOW() - INTERVAL '2 hours' WHERE story_id = a_id;

  -- ---------------------------------------------------------------------
  -- (j) UNMERGE SAFETY: a human 'unmerge' is authoritative "keep separate" and must
  -- suppress. Ids are stored in REVERSE order on purpose - manual rows can store either
  -- order, so this exercises the LEAST/GREATEST normalization.
  -- ---------------------------------------------------------------------
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES ('manual', 'ado-539-fixture', GREATEST(a_id, b_id), LEAST(a_id, b_id), 'unmerge', 1.0, 'ADO-539 unmerge fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 0);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (j): reverse-order unmerge row suppresses (LEAST/GREATEST works)';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (j): Judge could re-merge a human unmerge -- BLOCKER'; END IF;

  -- ---------------------------------------------------------------------
  -- (m) CAP-DEFERRAL SAFETY: a 'merge' logged with merged=false was decided but NOT
  -- executed (run cap of 10, or merge_stories ok:false). The prompt defers those to the
  -- next run, so they must NOT create memory -- otherwise "deferred" silently becomes
  -- "dropped forever", since a failed merge never touches matched_at.
  -- ---------------------------------------------------------------------
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES ('judge-agent', 'ado-539-fixture', a_id, b_id, 'merge', 0.9, 'cap_reached', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 1);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (m): cap-deferred merge does NOT suppress (pair retried next run)';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (m): a cap_reached merge suppressed the pair -- deferred merges would be dropped'; END IF;

  -- ---------------------------------------------------------------------
  -- (h) Heartbeat rows (both ids NULL) must never suppress anything.
  -- ---------------------------------------------------------------------
  DELETE FROM clustering_judge_log WHERE run_id = 'ado-539-fixture';
  INSERT INTO clustering_judge_log
    (source, run_id, story_id_a, story_id_b, verdict, confidence, rationale, merged, dry_run)
  VALUES ('judge-agent', 'ado-539-fixture', NULL, NULL, 'keep', 0.5, 'ADO-539 heartbeat fixture', false, false);

  SELECT count(*) INTO n FROM get_clustering_judge_candidates(0.75, 30, 200) c
   WHERE c.story_id_a = LEAST(a_id, b_id) AND c.story_id_b = GREATEST(a_id, b_id);
  ok := (n = 1);
  IF ok THEN passes := passes + 1; RAISE NOTICE 'PASS (h): heartbeat rows do not suppress';
  ELSE fails := fails + 1; RAISE WARNING 'FAIL (h): a NULL-id heartbeat row suppressed a real pair'; END IF;

  RAISE NOTICE '---------------------------------------------';
  RAISE NOTICE 'ADO-539 verdict-memory fixtures: % passed, % failed', passes, fails;

  IF fails > 0 THEN
    RAISE EXCEPTION 'ADO-539 fixture: % check(s) FAILED - do NOT deploy migration 106 to PROD.', fails;
  END IF;
END $$;

-- Nothing above is kept: the synthetic stories, their membership and all fixture log rows
-- disappear with this ROLLBACK.
ROLLBACK;

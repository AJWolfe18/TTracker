-- ============================================================================
-- ADO-580 AC 2: re-queue SCOTUS 2399 and 2099 so the agent re-enriches them
-- from the full opinion text.
-- Run by hand in the Supabase SQL Editor on PROD ONLY. Never deployed; listed in
-- .claude/test-only-paths.md. Written October 1, 2026.
--
-- CONTEXT: 2399 (NPS v. National Trust, ballroom) and 2099 (Trump v. Slaughter)
-- came back fact_extraction_confidence = 'low' because the agent read the 15K
-- opinion_excerpt, which cuts off the vote split and the authors. The prompt fix
-- (3e8b647, PR #165 "Deploy: ADO-580 dash guard and SCOTUS full-opinion read") makes
-- the agent read scotus_opinions first and keep both ends of a long opinion.
--
-- RUN ORDER: only AFTER PR #165 is merged to main AND migration 120 (dash guard)
-- has been applied on PROD. The PROD routine reads the prompt from main, so a
-- re-run before the merge just reproduces the low-confidence result; migration 120
-- first means the fresh copy cannot bring em dashes back.
--
-- MECHANIC: the agent's queue is enrichment_status IN ('pending','failed'),
-- ordered by decided_at ascending, 20 per run (prompt-v1.md Step 2). This sets
-- enrichment_status = 'pending' and nulls enriched_at and prompt_version; the agent
-- writes all three again on success. The write-once prevent_enriched_at_update
-- trigger exists only on executive_orders (migration 023), not on scotus_cases;
-- even if it did, a write that nulls both columns passes its checks.
-- Only rows with a scotus_opinions row are re-queued: the fix depends on the full
-- text (2099 has a 4,701-char syllabus, but the prompt reads the opinion's last
-- 6,000 chars before it settles for low confidence; 2399 has no syllabus).
-- Editorial copy and is_public are NOT touched: both cases stay public with
-- their current text until the agent overwrites it (same as the August 31, 2026
-- restore of 12 cases). No dash-guard columns are written.
-- Runs once per row: only rows still carrying an excerpt-era enrichment (enriched_at
-- before PR #165 merged, October 3, 2026 01:54:33 UTC) are re-queued. Corrected
-- October 2, 2026 CT: the cutoff was September 2, 2026, but PROD showed 2399 enriched
-- on September 2 at 16:04 UTC (the October 1 read was wrong), still under the old
-- prompt, so the old cutoff would have skipped it and reported "fix did not take".
-- prompt_version cannot tell the runs apart (the agent writes 'v1.1' both times).
-- After the agent's full-opinion pass, a second run is a no-op even if that pass
-- came back low again; the NOTICE then says the fix did not take, so look at the
-- row instead of re-running.
-- ============================================================================

-- STEP 1 - AUDIT (read-only; run first and keep the output).
-- Expect 2 rows: 2099 Trump v. Slaughter and 2399 National Park Service v.
-- National Trust..., both enrichment_status 'enriched' and
-- fact_extraction_confidence 'low', enriched_at before October 3, 2026 01:54 UTC (2099:
-- majority_author null, dissent_authors empty). has_full_opinion must be true for both, or the re-run cannot do better.
-- queued_ahead = pending/failed cases the agent takes first (20 per run).
SELECT sc.id, sc.case_name, sc.is_public, sc.enrichment_status, sc.prompt_version,
       sc.fact_extraction_confidence, sc.needs_manual_review, sc.vote_split,
       sc.majority_author, sc.dissent_authors, sc.enriched_at,
       so.case_id IS NOT NULL AS has_full_opinion, so.char_count,
       (SELECT count(*) FROM public.scotus_cases q
         WHERE q.enrichment_status IN ('pending', 'failed')
           AND q.decided_at < sc.decided_at) AS queued_ahead
FROM public.scotus_cases sc
LEFT JOIN public.scotus_opinions so ON so.case_id = sc.id
WHERE sc.id IN (2099, 2399)
ORDER BY sc.id;

-- STEP 2 - RESET (one block; highlight it and run it by itself).
-- Raises and changes nothing unless ids 2099 and 2399 are exactly the two
-- expected cases. Then re-queues only the ones still enriched by an excerpt-era
-- run (before the #165 merge) at low confidence or flagged for manual review, and only if
-- their full opinion is stored. The NOTICE says how many (0, 1 or 2), how many were
-- skipped for a missing opinion, and how many the full-opinion pass has already
-- redone (and of those, how many are still low).
DO $$
DECLARE
  v_expected integer;
  v_no_text  integer;
  v_redone   integer;
  v_still_low integer;
  v_reset    integer;
BEGIN
  v_expected := (
    SELECT count(*) FROM public.scotus_cases
    WHERE (id = 2099 AND case_name ILIKE '%Slaughter%')
       OR (id = 2399 AND case_name ILIKE '%National Trust%')
  );
  IF v_expected <> 2 THEN
    RAISE EXCEPTION 'ADO-580 reset: expected ids 2099 (Slaughter) and 2399 (National Trust), found % matching rows. Nothing changed.', v_expected;
  END IF;

  v_no_text := (
    SELECT count(*) FROM public.scotus_cases sc
    WHERE sc.id IN (2099, 2399)
      AND NOT EXISTS (SELECT 1 FROM public.scotus_opinions so WHERE so.case_id = sc.id)
  );

  v_redone := (
    SELECT count(*) FROM public.scotus_cases
    WHERE id IN (2099, 2399)
      AND enrichment_status = 'enriched'
      AND enriched_at >= '2026-10-03 01:54:33+00'
  );
  v_still_low := (
    SELECT count(*) FROM public.scotus_cases
    WHERE id IN (2099, 2399)
      AND enrichment_status = 'enriched'
      AND enriched_at >= '2026-10-03 01:54:33+00'
      AND (fact_extraction_confidence = 'low' OR needs_manual_review IS TRUE)
  );

  UPDATE public.scotus_cases sc
  SET enrichment_status = 'pending',
      enriched_at       = NULL,
      prompt_version    = NULL
  WHERE sc.id IN (2099, 2399)
    AND sc.enrichment_status = 'enriched'
    AND sc.enriched_at < '2026-10-03 01:54:33+00'
    AND (sc.fact_extraction_confidence = 'low' OR sc.needs_manual_review IS TRUE)
    AND EXISTS (SELECT 1 FROM public.scotus_opinions so WHERE so.case_id = sc.id);
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RAISE NOTICE 'ADO-580 reset: % of 2 rows re-queued; % skipped for no stored full opinion; % already redone by the full-opinion pass (not re-queued).', v_reset, v_no_text, v_redone;
  IF v_still_low > 0 THEN
    RAISE NOTICE 'ADO-580 reset: % redone row(s) still low confidence or flagged for review: the fix did not take. Do not re-run; check the row and tell Claude.', v_still_low;
  END IF;
END $$;

-- STEP 3 - CHECK (read-only). Re-queued rows show pending with enriched_at null.
SELECT id, case_name, is_public, enrichment_status, prompt_version, enriched_at
FROM public.scotus_cases
WHERE id IN (2099, 2399)
ORDER BY id;

-- STEP 4 (outside SQL): fire the PROD SCOTUS enrichment routine, or wait for
-- its next scheduled run (more than one run if STEP 1 showed queued_ahead >= 20).
-- Then run /scotus-review 2099,2399 and check AC 2: fact_extraction_confidence
-- 'high', majority_author set, and 2099 dissent_authors populated (ADO-580 AC 3).

-- ROLLBACK (only if STEP 2 ran and the re-run must be stopped before the agent
-- picks them up): put both back to the enriched state. enriched_at goes back to
-- the STEP 1 audit values; replace the placeholders with them and the old
-- prompt_version.
-- UPDATE public.scotus_cases
-- SET enrichment_status = 'enriched', prompt_version = '<STEP 1 value>',
--     enriched_at = '<STEP 1 value>'
-- WHERE id = <id> AND enrichment_status = 'pending';

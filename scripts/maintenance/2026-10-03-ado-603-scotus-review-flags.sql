-- ============================================================================
-- ADO-603: work off the 38 open SCOTUS review flags on PROD.
-- Run by hand in the Supabase SQL Editor on PROD ONLY. Never deployed; listed in
-- .claude/test-only-paths.md. Written October 3, 2026.
--
-- CONTEXT: the SCOTUS agent flagged nearly every unsigned order for review because
-- the Court never prints a vote count on one (the record is the noted dissents).
-- Claude went through all 38 (October 3, 2026):
--   - 18 are correct: vote counted from the noted dissents, dissenters listed,
--     counts agree; landmark ones checked against public reporting (Goldey 9-0,
--     TikTok 9-0, Glossip, Bessent, Trump v. Wilcox/Orr/Slaughter stay, and others).
--     STEP 2 clears them with a review note.
--   - 18 have a wrong or missing fact and get re-queued so the agent rewrites them
--     under the fixed prompt (STEP 3). The worst: Louisiana v. Callais (1678) still
--     says "punted to reargument" (impact 2) but holds the April 29, 2026 6-3 merits
--     ruling (Alito) that struck the map; the stale write-up was never redone.
--     Others: dissent writer stored as majority author (Danco shows Alito, who
--     dissented), A.A.R.P. 8-1 should be 7-2 (Thomas joined Alito), Hamm v. Smith
--     DIG has no vote (reported 5-4), Mirabelli/Abrego Garcia/Doe vote vs dissenters
--     disagree, Trump v. AFGE stay typed as a merits ruling.
--   - 2 (2099 Trump v. Slaughter merits, 2399 National Trust) are already pending
--     from the ADO-580 reset. Not touched here.
--
-- RUN ORDER:
--   STEP 1 and STEP 2: any time.
--   STEP 3: only AFTER the ADO-603 prompt fix is merged to main. The PROD routine
--   reads the prompt from main at run time; re-queuing before the merge just
--   re-flags the same rows under the old rule.
-- The agent takes 20 pending cases per run, oldest decided_at first: these 18 + the
-- 2 from ADO-580 = 20, so one weekday run (16:00 UTC = 11 AM CT) takes them all
-- unless new cases land first (then the rest go the next weekday).
-- Editorial copy and is_public are NOT touched: every case stays published with its
-- current text until the agent overwrites it.
-- ============================================================================

-- STEP 1 - AUDIT (read-only; run first and keep the output, it is the rollback record).
-- Expect 38 rows: 36 enriched + 2099/2399 pending, none with manual_reviewed_at.
SELECT sc.id, sc.case_name, sc.enrichment_status, sc.fact_extraction_confidence,
       sc.vote_split, sc.majority_author, sc.dissent_authors, sc.prompt_version,
       sc.enriched_at, sc.manual_reviewed_at,
       so.case_id IS NOT NULL AS has_full_opinion
FROM public.scotus_cases sc
LEFT JOIN public.scotus_opinions so ON so.case_id = sc.id
WHERE sc.needs_manual_review IS TRUE
ORDER BY sc.id;

-- STEP 2 - CLEAR the 18 verified flags (one block; highlight it and run it by itself).
-- Raises and changes nothing unless every id still carries the expected case name.
-- Only rows still flagged and unreviewed are touched, so a re-run is a no-op.
DO $$
DECLARE
  v_matched integer;
  v_cleared integer;
BEGIN
  WITH expected(id, name_like) AS (VALUES
    (2404, 'Nelsen v. Pike%'),
    (2400, 'National Republican Congressional%'),
    (1818, 'Skinner v. Louisiana%'),
    (1798, 'Reed v. Goertz%'),
    (1797, 'Villarreal v. Alaniz%'),
    (1781, 'Burnett v. United States%'),
    (1740, 'Klein v. Martin%'),
    (1736, 'Howell v. Circuit Court%'),
    (1719, 'Trump v. Orr%'),
    (1711, 'Noem v. National TPS%'),
    (1710, 'Department of State v. AIDS%'),
    (1709, 'Trump v. Slaughter%'),
    (1607, 'Trump v. Wilcox%'),
    (1692, 'Goldey v. Fields%'),
    (1553, 'Glossip v. Oklahoma%'),
    (1542, 'Bessent v. Dellinger%'),
    (1533, 'TikTok Inc. v. Garland%'),
    (1516, 'Republican National Committee v. Genser%')
  )
  SELECT count(*) INTO v_matched
  FROM expected e JOIN public.scotus_cases sc ON sc.id = e.id AND sc.case_name ILIKE e.name_like;
  IF v_matched <> 18 THEN
    RAISE EXCEPTION 'ADO-603 clear: expected 18 id/name matches, found %. Nothing changed.', v_matched;
  END IF;

  UPDATE public.scotus_cases
  SET needs_manual_review = false,
      manual_reviewed_at  = now(),
      manual_review_note  = 'ADO-603 (October 3, 2026): checked by Claude. The vote is counted from the noted dissents, which is how the Court records unsigned orders and cert denials; vote and dissenters checked. Flag cleared, no change to the facts.'
  WHERE id IN (2404, 2400, 1818, 1798, 1797, 1781, 1740, 1736, 1719, 1711, 1710, 1709, 1607, 1692, 1553, 1542, 1533, 1516)
    AND needs_manual_review IS TRUE
    AND manual_reviewed_at IS NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RAISE NOTICE 'ADO-603 clear: % of 18 flags cleared (0 means it already ran).', v_cleared;
END $$;

-- STEP 3 - RE-QUEUE the 18 rows with wrong facts (AFTER the prompt fix is on main).
-- Same mechanic as the ADO-580 reset: enrichment_status pending, enriched_at and
-- prompt_version null; the agent writes all three again on success. Only rows still
-- enriched and still flagged are touched, so a re-run after the agent has redone
-- them is a no-op.
DO $$
DECLARE
  v_matched integer;
  v_reset   integer;
BEGIN
  WITH expected(id, name_like) AS (VALUES
    (2403, 'People Not Politicians v. Onder%'),
    (2052, 'McCarthy v. Hernandez%'),
    (2050, 'Salda%o v. Texas%'),
    (2049, 'United States v. Carter%'),
    (2020, 'Alabama v. Powell%'),
    (2019, 'E.D. v. Noblesville%'),
    (2000, 'Clark v. Mississippi%'),
    (1937, 'Hamm v. Smith%'),
    (1932, 'Lairy v. United States%'),
    (1914, 'Guerrero v. Busby%'),
    (1913, 'Danco Laboratories%'),
    (1897, 'Callais v. Louisiana%'),
    (1765, 'Mirabelli v. Bonta%'),
    (1701, 'Trump v. American Federation%'),
    (1678, 'Louisiana v. Callais%'),
    (1617, 'Doe v. Seattle Police%'),
    (1593, 'A.A.R.P. v. Trump%'),
    (1590, 'Noem v. Abrego Garcia%')
  )
  SELECT count(*) INTO v_matched
  FROM expected e JOIN public.scotus_cases sc ON sc.id = e.id AND sc.case_name ILIKE e.name_like;
  IF v_matched <> 18 THEN
    RAISE EXCEPTION 'ADO-603 re-queue: expected 18 id/name matches, found %. Nothing changed.', v_matched;
  END IF;

  UPDATE public.scotus_cases
  SET enrichment_status = 'pending',
      enriched_at       = NULL,
      prompt_version    = NULL
  WHERE id IN (2403, 2052, 2050, 2049, 2020, 2019, 2000, 1937, 1932, 1914, 1913, 1897, 1765, 1701, 1678, 1617, 1593, 1590)
    AND enrichment_status = 'enriched'
    AND needs_manual_review IS TRUE;
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RAISE NOTICE 'ADO-603 re-queue: % of 18 rows re-queued (0 means it already ran).', v_reset;
END $$;

-- STEP 4 - CHECK (read-only). Expect 20 pending (these 18 + 2099 + 2399) and no
-- flagged row left that is enriched and unreviewed.
SELECT enrichment_status, needs_manual_review, (manual_reviewed_at IS NOT NULL) AS reviewed, count(*)
FROM public.scotus_cases
WHERE id IN (2404, 2400, 1818, 1798, 1797, 1781, 1740, 1736, 1719, 1711, 1710, 1709, 1607, 1692, 1553, 1542, 1533, 1516,
             2403, 2052, 2050, 2049, 2020, 2019, 2000, 1937, 1932, 1914, 1913, 1897, 1765, 1701, 1678, 1617, 1593, 1590,
             2099, 2399)
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- STEP 5 (outside SQL): after the next weekday SCOTUS run, /scotus-review the 20
-- re-run ids. 1678 must come back as the 6-3 merits ruling by Alito with Kagan,
-- Sotomayor and Jackson dissenting; 1913 must have majority_author null and
-- dissenters Thomas and Alito.

-- ROLLBACK
-- STEP 2: UPDATE public.scotus_cases SET needs_manual_review = true, manual_reviewed_at = NULL, manual_review_note = NULL
--         WHERE manual_review_note LIKE 'ADO-603 (October 3, 2026)%';
-- STEP 3 (only before the agent picks them up): put each row back to its STEP 1 values:
--         UPDATE public.scotus_cases SET enrichment_status = 'enriched', prompt_version = '<STEP 1 value>',
--                enriched_at = '<STEP 1 value>' WHERE id = <id> AND enrichment_status = 'pending';

-- ADO-580 AC 3 (case 2392 only): Trump v. California, docket 26A124.
-- Run by hand in the PROD SQL Editor (Josh). Never deployed; listed in .claude/test-only-paths.md.
-- The row does not exist on TEST, so there was nothing to fix there.
--
-- Settled October 1, 2026 from the August 24, 2026 order itself (CourtListener
-- cluster 10956828, opinion 11424433; PDF supremecourt.gov/opinions/25pdf/26a124_hgci.pdf):
--   Per curiam grants the stay. Two dissents:
--     "JUSTICE SOTOMAYOR, with whom JUSTICE KAGAN joins, dissenting."
--     "JUSTICE JACKSON, dissenting."
--   No other Justice noted a vote to deny. So the vote is 6-3 (stored value is right)
--   and the dissenters are Sotomayor, Kagan and Jackson. The August 26 run's 7-2 was wrong.
--
-- Fix: dissent_authors gets Kagan (the prompt defines it as "Justices who filed or
-- joined dissents", last names), and dissent_highlights' first sentence names her.
-- vote_split and majority_author (null, per curiam) are not touched.
-- AC 4 (impact level 3 or 4) is Josh's call and is not in this file.
--
-- Keyed on the docket number, not the id. Guard: exactly 1 row with vote 6-3, and each
-- of the two fields must be either still as checked on October 1, 2026 ({Sotomayor,Jackson};
-- first sentence "Sotomayor and Jackson dissented.") or already fixed. Each field is
-- checked on its own, so a row where only one was corrected gets the other repaired.
-- Anything else (e.g. re-enriched since) raises and nothing changes.
-- Both already fixed: the block says so and changes nothing, so running it twice is safe.

DO $$
DECLARE
  c_old_hl   constant text   := 'Sotomayor and Jackson dissented. ';
  c_new_hl   constant text   := 'Sotomayor, joined by Kagan, and Jackson dissented. ';
  c_old_auth constant text[] := ARRAY['Sotomayor', 'Jackson'];
  c_new_auth constant text[] := ARRAY['Sotomayor', 'Kagan', 'Jackson'];
  v_rows      int;
  v_authors   text[];
  v_vote      text;
  v_hl        text;
  v_auth_done boolean;
  v_hl_done   boolean;
  v_updated   int;
BEGIN
  v_rows := (SELECT count(*) FROM public.scotus_cases WHERE docket_number = '26A124');
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ADO-580: expected 1 row with docket 26A124, found %. Nothing was changed.', v_rows;
  END IF;

  v_authors := (SELECT dissent_authors FROM public.scotus_cases WHERE docket_number = '26A124');
  v_vote    := (SELECT vote_split FROM public.scotus_cases WHERE docket_number = '26A124');
  v_hl      := (SELECT dissent_highlights FROM public.scotus_cases WHERE docket_number = '26A124');

  IF v_vote IS DISTINCT FROM '6-3' THEN
    RAISE EXCEPTION 'ADO-580: 26A124 vote is % (expected 6-3). Nothing was changed.', v_vote;
  END IF;

  IF v_authors IS NOT DISTINCT FROM c_new_auth THEN
    v_auth_done := true;
  ELSIF v_authors IS NOT DISTINCT FROM c_old_auth THEN
    v_auth_done := false;
  ELSE
    RAISE EXCEPTION 'ADO-580: 26A124 dissent_authors is % (expected {Sotomayor,Jackson} or {Sotomayor,Kagan,Jackson}). Nothing was changed.', v_authors;
  END IF;

  IF v_hl IS NOT NULL AND left(v_hl, length(c_new_hl)) = c_new_hl THEN
    v_hl_done := true;
  ELSIF v_hl IS NOT NULL AND left(v_hl, length(c_old_hl)) = c_old_hl THEN
    v_hl_done := false;
  ELSE
    RAISE EXCEPTION 'ADO-580: 26A124 dissent_highlights starts with neither the old nor the fixed sentence: "%". Nothing was changed.', left(coalesce(v_hl, '<null>'), 60);
  END IF;

  IF v_auth_done AND v_hl_done THEN
    RAISE NOTICE 'ADO-580: 26A124 already lists Sotomayor, Kagan, Jackson in both fields. Nothing to do.';
    RETURN;
  END IF;

  UPDATE public.scotus_cases
     SET dissent_authors    = c_new_auth,
         dissent_highlights = CASE WHEN v_hl_done THEN dissent_highlights
                                   ELSE c_new_hl || substr(dissent_highlights, length(c_old_hl) + 1) END
   WHERE docket_number = '26A124';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'ADO-580: updated % rows, expected 1. Rolled back.', v_updated;
  END IF;

  RAISE NOTICE 'ADO-580: 26A124 fixed (dissent_authors %, dissent_highlights %)',
    CASE WHEN v_auth_done THEN 'already right' ELSE 'set' END,
    CASE WHEN v_hl_done THEN 'already right' ELSE 'set' END;
END $$;

-- Check (read-only). Expect: 6-3, {Sotomayor,Kagan,Jackson},
-- "Sotomayor, joined by Kagan, and Jackson dissented. Jackson filed an opinion ..."
SELECT id, case_name, vote_split, dissent_authors, dissent_highlights
  FROM public.scotus_cases
 WHERE docket_number = '26A124';

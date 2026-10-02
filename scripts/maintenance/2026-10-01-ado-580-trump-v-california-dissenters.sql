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
-- Keyed on the docket number, not the id. Guard: exactly 1 row, and it must still hold
-- the values checked on October 1, 2026 (6-3, {Sotomayor,Jackson}, the old first
-- sentence). If it was re-enriched since, the block raises and nothing changes.
-- Already fixed: the block says so and changes nothing, so running it twice is safe.

DO $$
DECLARE
  v_rows     int;
  v_authors  text[];
  v_vote     text;
  v_hl       text;
  v_updated  int;
BEGIN
  v_rows := (SELECT count(*) FROM public.scotus_cases WHERE docket_number = '26A124');
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ADO-580: expected 1 row with docket 26A124, found %. Nothing was changed.', v_rows;
  END IF;

  v_authors := (SELECT dissent_authors FROM public.scotus_cases WHERE docket_number = '26A124');
  v_vote    := (SELECT vote_split FROM public.scotus_cases WHERE docket_number = '26A124');
  v_hl      := (SELECT dissent_highlights FROM public.scotus_cases WHERE docket_number = '26A124');

  IF v_authors = ARRAY['Sotomayor', 'Kagan', 'Jackson'] THEN
    RAISE NOTICE 'ADO-580: 26A124 already lists Sotomayor, Kagan, Jackson. Nothing to do.';
    RETURN;
  END IF;

  IF v_vote IS DISTINCT FROM '6-3'
     OR v_authors IS DISTINCT FROM ARRAY['Sotomayor', 'Jackson']
     OR v_hl IS NULL
     OR left(v_hl, 33) <> 'Sotomayor and Jackson dissented. ' THEN
    RAISE EXCEPTION 'ADO-580: 26A124 changed since October 1, 2026 (vote %, dissenters %). Nothing was changed.', v_vote, v_authors;
  END IF;

  UPDATE public.scotus_cases
     SET dissent_authors    = ARRAY['Sotomayor', 'Kagan', 'Jackson'],
         dissent_highlights = 'Sotomayor, joined by Kagan, and Jackson dissented. ' || substr(dissent_highlights, 34)
   WHERE docket_number = '26A124';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'ADO-580: updated % rows, expected 1. Rolled back.', v_updated;
  END IF;

  RAISE NOTICE 'ADO-580: 26A124 dissenters set to Sotomayor, Kagan, Jackson';
END $$;

-- Check (read-only). Expect: 6-3, {Sotomayor,Kagan,Jackson},
-- "Sotomayor, joined by Kagan, and Jackson dissented. Jackson filed an opinion ..."
SELECT id, case_name, vote_split, dissent_authors, dissent_highlights
  FROM public.scotus_cases
 WHERE docket_number = '26A124';

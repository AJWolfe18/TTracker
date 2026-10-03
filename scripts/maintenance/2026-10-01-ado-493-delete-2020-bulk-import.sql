-- ADO-493: delete the flagged 2020 SCOTUS rows from the February 23, 2026 bulk import.
-- Run by hand in the PROD SQL Editor (Josh). Never deployed; listed in .claude/test-only-paths.md.
--
-- The rows are real 2020 Supreme Court orders that fetch-cases.js pulled when its
-- default --since was 2020-01-01 (fixed in 69dea16: default is now 2024-10-01 and
-- decided-at-guard.js skips anything older than the run's since date). Scout v2
-- flagged them as non-merits, so none is public; they only clutter admin Drafts.
-- If they are ever wanted back, CourtListener still has them.
--
-- Target (the card's predicate, with explicit UTC bounds):
--   decided_at in 2020, enrichment_status = 'flagged', created_at on February 23, 2026,
--   and is_public = false.
-- Left alone on purpose: the 8 PUBLIC 2020 merits cases from the same import
-- (ids 1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481, e.g. McKinney v. Arizona).
-- They are 'enriched', not 'flagged', so the predicate does not match them, and
-- the DELETE also excludes their ids. Whether they stay is an open decision for Josh
-- on ADO-493; this file does not touch them.
--
-- Foreign keys: only scotus_opinions.case_id points at scotus_cases (ON DELETE
-- CASCADE, migration 069), so each deleted case takes its stored opinion text with it.
-- Other tables refer to SCOTUS ids as plain columns with no FK (content_revisions,
-- qa_* tables, admin.content_history, social_posts, tracker_pin); nothing blocks.
--
-- The anon key cannot see flagged rows, so the expected count could not be read
-- from outside. Run one STEP at a time (highlight it, then Run), STEP 1 first.


-- STEP 1 (read-only). Expect: target_rows = 1212 (the card's 1,220 includes the 8 kept), public_in_predicate = 0,
-- public_2020_kept = 8. If target_rows is not 1212, do NOT edit STEP 2:
-- send the three numbers to Claude first.
SELECT
  (SELECT count(*) FROM public.scotus_cases
    WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
      AND enrichment_status = 'flagged'
      AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00'
      AND is_public = false)                                        AS target_rows,
  (SELECT count(*) FROM public.scotus_cases
    WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
      AND enrichment_status = 'flagged'
      AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00'
      AND is_public = true)                                         AS public_in_predicate,
  (SELECT count(*) FROM public.scotus_cases
    WHERE id IN (1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481)
      AND is_public = true)                                         AS public_2020_kept;


-- STEP 2 (the delete). Guard: if any public row matches the card's predicate, or the
-- target is not exactly v_expected rows, the block raises and nothing is deleted.
DO $$
DECLARE
  v_expected int := 1212;  -- 1,220 imported minus the 8 public cases kept (PROD, October 2, 2026)
  v_public   int;
  v_target   int;
  v_opinions int;
  v_deleted  int;
BEGIN
  v_public := (SELECT count(*) FROM public.scotus_cases
                WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
                  AND enrichment_status = 'flagged'
                  AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00'
                  AND is_public = true);
  IF v_public <> 0 THEN
    RAISE EXCEPTION 'ADO-493: % PUBLIC rows match the predicate. Nothing was deleted.', v_public;
  END IF;

  v_target := (SELECT count(*) FROM public.scotus_cases
                WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
                  AND enrichment_status = 'flagged'
                  AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00'
                  AND is_public = false
                  AND id NOT IN (1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481));
  IF v_target <> v_expected THEN
    RAISE EXCEPTION 'ADO-493: expected % rows, matched %. Nothing was deleted.', v_expected, v_target;
  END IF;

  v_opinions := (SELECT count(*) FROM public.scotus_opinions o
                   JOIN public.scotus_cases c ON c.id = o.case_id
                  WHERE c.decided_at >= '2020-01-01 00:00:00+00' AND c.decided_at < '2021-01-01 00:00:00+00'
                    AND c.enrichment_status = 'flagged'
                    AND c.created_at >= '2026-02-23 00:00:00+00' AND c.created_at < '2026-02-24 00:00:00+00'
                    AND c.is_public = false
                    AND c.id NOT IN (1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481));

  DELETE FROM public.scotus_cases
   WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
     AND enrichment_status = 'flagged'
     AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00'
     AND is_public = false
     AND id NOT IN (1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_expected THEN
    RAISE EXCEPTION 'ADO-493: deleted % rows, expected %. Rolled back.', v_deleted, v_expected;
  END IF;

  RAISE NOTICE 'ADO-493: deleted % scotus_cases rows (and % scotus_opinions rows by cascade)', v_deleted, v_opinions;
END $$;


-- STEP 3 (read-only check). Expect: target_rows_left = 0, public_2020_kept = 8.
SELECT
  (SELECT count(*) FROM public.scotus_cases
    WHERE decided_at >= '2020-01-01 00:00:00+00' AND decided_at < '2021-01-01 00:00:00+00'
      AND enrichment_status = 'flagged'
      AND created_at >= '2026-02-23 00:00:00+00' AND created_at < '2026-02-24 00:00:00+00') AS target_rows_left,
  (SELECT count(*) FROM public.scotus_cases
    WHERE id IN (1335, 1337, 1338, 1339, 1340, 1343, 1344, 1481)
      AND is_public = true)                                                                 AS public_2020_kept;

-- ADO-590 follow-up: fix clemency_type on the two 2025 mixed DOJ sections.
-- Run by hand in the PROD SQL Editor (Josh). Never deployed; listed in .claude/test-only-paths.md.
--
-- The scraper typed every row in a mixed section from its heading, so
--   "May 28, 2025 - 16 Pardons and 6 Commutations" and
--   "May 29, 2025 - 1 Pardon and 2 Commutations"
-- went in as 25 commutations. Each warrant (link title, PDF Title and download
-- filename, checked September 23, 2026) says these 17 are PARDONS. The 8 real
-- commutations (Duran, Hoover, Morgan, Garnett Smith, Valenzuela, Zuberi,
-- Edward Sotelo, Joe Sotelo) are already right and are not touched.
--
-- enriched_at = NULL queues each row for the pardons agent (5 per run, daily
-- 3 PM CT), so write-ups that call them commutations get redone. $0.
-- is_public is deliberately left alone (same as the September 23 fix): until a
-- row is redone its page shows the right type next to older text, which beats
-- hiding the Chrisleys and others for up to 4 days. Manual agent runs shorten it.
--
-- Guard: exactly 17 rows or the whole block rolls back and nothing changes.

DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.pardons
     SET clemency_type = 'pardon',
         enriched_at = NULL
   WHERE source_system = 'doj_opa'
     AND clemency_type = 'commutation'
     AND (
       (pardon_date = '2025-05-28' AND recipient_name IN (
         'Kevin Eric Baisden', 'Mark Bashaw', 'Julie Chrisley', 'Todd Chrisley',
         'Kentrell D. Gaulden', 'Michael Gerard Grimm', 'Michael Ray Harris',
         'James M. Kernan', 'Marlene Mary Kernan', 'Tanner J. Mansell',
         'John R. Moore, Jr.', 'John G. Rowland', 'Charles Overton Scott',
         'Alexander Sittenfeld', 'Earl Lamont Smith', 'Charles Lavar Tanner'
       ))
       OR (pardon_date = '2025-05-29' AND recipient_name = 'Jeremy Young Hutchinson')
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 17 THEN
    RAISE EXCEPTION 'ADO-590: expected 17 rows, matched %. Nothing was changed.', v_count;
  END IF;
  RAISE NOTICE 'ADO-590: % rows set to pardon and queued for re-enrichment', v_count;
END $$;

-- Check (read-only): expect 17 pardon + 8 commutation across the two dates.
SELECT pardon_date, clemency_type, count(*)
  FROM public.pardons
 WHERE source_system = 'doj_opa' AND pardon_date IN ('2025-05-28', '2025-05-29')
 GROUP BY 1, 2
 ORDER BY 1, 2;

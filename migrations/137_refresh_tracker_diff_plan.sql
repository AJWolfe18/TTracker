-- ============================================================================
-- 137: refresh_tracker_derived finds the changed rows the cheap way again (ADO-638 follow-up)
-- WHY: migration 136 made the refresh work in batches by adding
--   `ORDER BY id DESC LIMIT p_max_rows` to the query that finds the changed rows.
--   With a LIMIT there, the planner switches from hash joins (read each table
--   once) to a newest-first walk over every story with an index lookup per
--   story, betting that it can stop after p_max_rows matches. In steady state
--   nothing has changed, so it never stops early and walks all of them. On
--   PROD's cold cache a call that changes 0 rows went from ~0.6 s (113: runs
--   46099746883, 46099725462) to ~5.7 s (136: runs 46103143360, 46109134661),
--   close to the API's ~8 s limit that froze the homepage in November 2026.
--   Fix: work out the whole changed set first, inside a MATERIALIZED CTE with no
--   ORDER BY or LIMIT (so it is planned exactly like 113's one-shot UPDATE),
--   then take the newest p_max_rows from that, usually tiny, set. Step 2 (rows
--   that left the rule's scope) had the same pattern and gets the same fix.
--   Nothing else changes: same signature, same result columns, same batches
--   (newest first, NULL = all), same tally and more_pending.
--   Known limit, shared with 136: more_pending counts rows actually written,
--   so a concurrent refresh that wrote some of the batch first makes a full
--   batch look short and the caller stops early; the next pipeline run picks
--   the rest up. 138 counts the batch instead.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD).
--   No DROP, so no "destructive operation" prompt. If asked "Run with/without
--   RLS", choose without (no table is created). Idempotent. On any error run
--   ROLLBACK; alone before retrying. Needs migration 136; no script change.
-- EXPECT: last result refresh_fn = 1, batch_arg = 1, cheap_diff = true.
--   Then SELECT * FROM public.refresh_tracker_derived(50); twice: the second
--   call's took_ms should be back near the pre-136 ~600.
-- ROLLBACK: re-run migration 136 (it drops and recreates the function).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_tracker_derived(p_max_rows INTEGER DEFAULT NULL)
RETURNS TABLE (rows_changed INTEGER, took_ms INTEGER, more_pending BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- v_ prefix: plain names collided with table columns (42702 on first TEST apply)
  t0        TIMESTAMPTZ := clock_timestamp();
  v_term    DATE := DATE '2025-01-20';                 -- TERM_START in src/lib/timeline.ts
  v_since   DATE := (NOW() - INTERVAL '30 days')::date;
  v_left    INTEGER;
  n_apply   INTEGER;
  n_drop    INTEGER;
BEGIN
  IF p_max_rows IS NOT NULL AND p_max_rows < 1 THEN
    RAISE EXCEPTION 'refresh_tracker_derived: p_max_rows must be NULL or at least 1, got %', p_max_rows
      USING ERRCODE = '22023';
  END IF;

  -- 1. Apply the rule. Only rows whose flag actually changes are written,
  --    so steady-state runs touch a handful of rows (no bloat).
  --    MATERIALIZED keeps the LIMIT out of the diff's plan (see the header):
  --    find every changed row with hash joins, then take the newest batch.
  WITH changed AS MATERIALIZED (
    SELECT r.id, r.main_line
      FROM public.v_tracker_main_line_rule r
      JOIN public.stories s2 ON s2.id = r.id
     WHERE s2.main_line IS DISTINCT FROM r.main_line
  )
  UPDATE public.stories s
     SET main_line = c.main_line
    FROM (SELECT id, main_line FROM changed ORDER BY id DESC LIMIT p_max_rows) c
   WHERE s.id = c.id
     -- Re-checked on the locked row: a concurrent refresh that already wrote it
     -- (two pipelines finishing together) makes this a skip, not a second write.
     AND s.main_line IS DISTINCT FROM c.main_line;
  GET DIAGNOSTICS n_apply = ROW_COUNT;

  v_left := CASE WHEN p_max_rows IS NULL THEN NULL ELSE p_max_rows - n_apply END;

  -- 2. Rows that left the rule's scope (closed, merged, unenriched) drop off,
  --    within what is left of the batch. Same MATERIALIZED pattern as step 1.
  WITH out_of_scope AS MATERIALIZED (
    SELECT s2.id
      FROM public.stories s2
     WHERE s2.main_line
       AND NOT (s2.status = 'active' AND s2.summary_neutral IS NOT NULL)
  )
  UPDATE public.stories s
     SET main_line = false
   WHERE s.id IN (SELECT id FROM out_of_scope ORDER BY id DESC LIMIT v_left);
  GET DIAGNOSTICS n_drop = ROW_COUNT;

  -- 3. Tally.
  INSERT INTO public.tracker_stats (id, developments, alarm5_last30, open_fronts, refreshed_at)
  SELECT
    1,
    (SELECT COUNT(*) FROM public.stories
      WHERE status = 'active' AND summary_neutral IS NOT NULL AND first_seen_at >= v_term)
    + (SELECT COUNT(*) FROM public.scotus_cases
        WHERE is_public = true AND decided_at IS NOT NULL AND decided_at >= v_term)
    + (SELECT COUNT(*) FROM public.executive_orders
        WHERE is_public = true AND date >= v_term)
    + (SELECT COUNT(*) FROM public.pardons
        WHERE is_public = true AND pardon_date >= v_term),
    (SELECT COUNT(*) FROM public.stories
      WHERE status = 'active' AND summary_neutral IS NOT NULL AND first_seen_at >= v_term
        AND first_seen_at >= v_since
        AND (alarm_level >= 5 OR (alarm_level IS NULL AND severity = 'critical')))
    + (SELECT COUNT(*) FROM public.scotus_cases
        WHERE is_public = true AND decided_at IS NOT NULL AND decided_at >= v_term
          AND decided_at >= v_since AND ruling_impact_level >= 5)
    + (SELECT COUNT(*) FROM public.executive_orders
        WHERE is_public = true AND date >= v_term
          AND date >= v_since AND alarm_level >= 5)
    + (SELECT COUNT(*) FROM public.pardons
        WHERE is_public = true AND pardon_date >= v_term
          AND pardon_date >= v_since AND corruption_level >= 5),
    (SELECT COUNT(*) FROM public.events
      WHERE publish_state = 'published' AND lifecycle <> 'resolved'),
    NOW()
  ON CONFLICT (id) DO UPDATE
    SET developments  = EXCLUDED.developments,
        alarm5_last30 = EXCLUDED.alarm5_last30,
        open_fronts   = EXCLUDED.open_fronts,
        refreshed_at  = EXCLUDED.refreshed_at;

  rows_changed := n_apply + n_drop;
  took_ms      := (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::integer;
  -- A full batch means there may be more; the caller asks again. At worst one
  -- extra call returns 0 rows and more_pending = false.
  more_pending := p_max_rows IS NOT NULL AND (n_apply + n_drop) >= p_max_rows;
  RETURN NEXT;
END;
$$;

-- CREATE OR REPLACE keeps the 136 comment and grants; re-stated so this file
-- alone leaves the function locked down.
REVOKE ALL ON FUNCTION public.refresh_tracker_derived(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tracker_derived(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify: exactly one refresh_tracker_derived, taking one integer argument,
-- and it is this version (the diff is MATERIALIZED).
SELECT
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_tracker_derived')::int AS refresh_fn,
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_tracker_derived' AND p.pronargs = 1)::int AS batch_arg,
  (SELECT bool_and(p.prosrc LIKE '%changed AS MATERIALIZED%') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_tracker_derived') AS cheap_diff;

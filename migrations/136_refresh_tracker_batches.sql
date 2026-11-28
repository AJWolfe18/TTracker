-- ============================================================================
-- 136: refresh_tracker_derived works in batches (ADO-638)
-- WHY: the PostgREST API cancels any statement after about 8 seconds (57014).
--   A steady-state refresh takes under 1 second, but the ADO-594 label backfill
--   left ~3,100 stories whose main_line flag had to change. One UPDATE of all of
--   them needs ~76 seconds (each changed row also rewrites its index entries), so
--   every PROD run from November 10 to 25, 2026 was cancelled and rolled back,
--   and the homepage froze on November 11.
--   A function-level SET statement_timeout cannot fix this: Postgres arms the
--   statement timer before the function starts, so a value set inside it does
--   not extend the call that is running. Raising the service role's timeout
--   would loosen it for every pipeline query.
--   Instead the function takes an optional batch size. scripts/maintenance/
--   refresh-tracker.js calls it repeatedly with a small batch until
--   more_pending is false, so each call stays well under the API limit.
--   A call with no argument (admin-fronts and admin-judge-merge edge functions,
--   the fronts routine, hand-run SQL) behaves exactly as before: every changed
--   row in one go. Only the extra more_pending column is new.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD).
--   The DROP triggers a "destructive operation" prompt: confirm Run.
--   If asked "Run with/without RLS", choose without (no table is created).
--   Idempotent. On any error run ROLLBACK; alone before retrying.
--   Order with the script does not matter: refresh-tracker.js falls back to the
--   no-argument call while this migration is not applied.
-- EXPECT: last result, first column refresh_fn = 1, batch_arg = 1.
-- ROLLBACK: BEGIN; DROP FUNCTION public.refresh_tracker_derived(integer);
--   then paste migration 113 PART D (CREATE OR REPLACE ... through the GRANT); COMMIT;
--   NOTIFY pgrst, 'reload schema'; and revert refresh-tracker.js (its fallback
--   keeps it working either way).
-- ============================================================================

BEGIN;

-- The old zero-argument version and this one cannot both exist: a no-argument
-- call would be ambiguous (42725 / PGRST203). The return shape also changes,
-- which CREATE OR REPLACE cannot do (42P13).
DROP FUNCTION IF EXISTS public.refresh_tracker_derived();
DROP FUNCTION IF EXISTS public.refresh_tracker_derived(integer);

-- Same body as 113 PART D, with steps 1 and 2 limited to p_max_rows changed
-- rows in total (newest story id first, so recent stories reach the homepage
-- first). LIMIT NULL is LIMIT ALL, so a NULL batch is the old behaviour.
-- Step 3 (the tally) runs on every call: it is cheap and keeps the counters
-- current while a backlog drains.
CREATE FUNCTION public.refresh_tracker_derived(p_max_rows INTEGER DEFAULT NULL)
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
  UPDATE public.stories s
     SET main_line = c.main_line
    FROM (
      SELECT r.id, r.main_line
        FROM public.v_tracker_main_line_rule r
        JOIN public.stories s2 ON s2.id = r.id
       WHERE s2.main_line IS DISTINCT FROM r.main_line
       ORDER BY r.id DESC
       LIMIT p_max_rows
    ) c
   WHERE s.id = c.id
     -- Re-checked on the locked row: a concurrent refresh that already wrote it
     -- (two pipelines finishing together) makes this a skip, not a second write.
     AND s.main_line IS DISTINCT FROM c.main_line;
  GET DIAGNOSTICS n_apply = ROW_COUNT;

  v_left := CASE WHEN p_max_rows IS NULL THEN NULL ELSE p_max_rows - n_apply END;

  -- 2. Rows that left the rule's scope (closed, merged, unenriched) drop off,
  --    within what is left of the batch.
  UPDATE public.stories s
     SET main_line = false
   WHERE s.id IN (
      SELECT s2.id
        FROM public.stories s2
       WHERE s2.main_line
         AND NOT (s2.status = 'active' AND s2.summary_neutral IS NOT NULL)
       ORDER BY s2.id DESC
       LIMIT v_left
   );
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

COMMENT ON FUNCTION public.refresh_tracker_derived(integer) IS
  'ADO-570/638: applies v_tracker_main_line_rule to stories.main_line (changed rows only, at most p_max_rows per call, newest first; NULL = all) and recomputes tracker_stats. more_pending = the batch was full, call again. Call after every pipeline run and after admin front/pin edits: scripts/maintenance/refresh-tracker.js (batched loop). service_role only.';

REVOKE ALL ON FUNCTION public.refresh_tracker_derived(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tracker_derived(integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify: exactly one refresh_tracker_derived, taking one integer argument.
SELECT
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_tracker_derived')::int AS refresh_fn,
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_tracker_derived' AND p.pronargs = 1)::int AS batch_arg;

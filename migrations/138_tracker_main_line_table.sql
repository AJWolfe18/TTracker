-- ============================================================================
-- 138: the Tracker main line moves off stories into its own table (ADO-642)
-- WHY: stories.main_line is in the WHERE of idx_stories_tracker_main_line, so
--   every flip is a full row update: a new stories row version with an entry in
--   every stories index (the HNSW embedding index, 3 GIN, the b-trees) plus 2
--   BEFORE UPDATE triggers. That is ~50 ms per flipped story on PROD, which is
--   why a label backfill turned into a backlog that needed batching (ADO-638).
--   Writing "story X is on the main line" as a row in a one-column table costs
--   a fraction of a millisecond and never touches stories.
-- DESIGN:
--   A) tracker_main_line: one row per main-line story; only
--      refresh_tracker_derived() writes it.
--   B) idx_stories_tracker_spine: the homepage order over all active enriched
--      stories, no main_line in it; the homepage walks it newest first and
--      keeps the stories that have a row in A.
--   C) refresh_tracker_derived(p_max_rows): same signature and results as 137,
--      writes A instead of stories.
--   D) v_tracker_stories: same columns; main_line = "has a row in A".
--   E) on_main_line(stories): computed field for service-role readers of
--      stories (admin-fronts, social drafts).
--   F) stories.main_line stays, frozen (a later migration drops it);
--      idx_stories_tracker_main_line is dropped.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD),
--   between pipeline runs: building the new index holds stories writes for the
--   few seconds it takes. The DROP INDEX triggers a "destructive operation"
--   prompt: confirm Run. If asked "Run with/without RLS", choose with (this
--   creates a table; RLS is enabled below either way). Idempotent. On any error
--   run ROLLBACK; alone before retrying.
--   ORDER: this migration FIRST, then deploy the admin-fronts edge function and
--   cherry-pick the social script (both select on_main_line, which this creates).
--   Old code keeps working in between: it reads the frozen stories.main_line.
--   The homepage (v_tracker_stories) switches over the moment this commits.
-- EXPECT: last result side_rows = on_stories (on the first apply; they part
--   ways after the next refresh, which writes only side_rows), spine_index = true,
--   old_index = false, anon_can_call = false, service_can_call = true. Then
--   SELECT * FROM public.refresh_tracker_derived(50); rows_changed about 0.
-- ROLLBACK: first revert the edge function and social script (they need
--   on_main_line), then BEGIN; re-run 137 from CREATE OR REPLACE FUNCTION
--   through its GRANT; re-run 123 PART D (v_tracker_stories); re-run 113 PART A's
--   CREATE INDEX idx_stories_tracker_main_line; DROP FUNCTION
--   public.on_main_line(public.stories); DROP TABLE public.tracker_main_line;
--   COMMIT; NOTIFY pgrst, 'reload schema'; then run
--   node scripts/maintenance/refresh-tracker.js to bring stories.main_line back
--   up to date (batched).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: tracker_main_line
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_main_line (
  story_id BIGINT PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tracker_main_line IS
  'ADO-642: the stories on the Tracker main line, one row each. Written ONLY by refresh_tracker_derived() from v_tracker_main_line_rule. Replaces the stored stories.main_line flag, whose every flip rewrote all stories indexes. Read through v_tracker_stories.main_line (anon) or the on_main_line(stories) computed field (service role).';

-- Backfill: exactly what the homepage shows now. Rows the next refresh would
-- change (out of scope, drift since the last run) it changes, in its batches.
-- First apply only: the old index still exists until this migration drops it
-- (PART F, same transaction), and after that stories.main_line is frozen and
-- stale, so copying it again would bring back stories the rule has removed.
INSERT INTO public.tracker_main_line (story_id)
SELECT id FROM public.stories
 WHERE main_line
   AND to_regclass('public.idx_stories_tracker_main_line') IS NOT NULL
ON CONFLICT (story_id) DO NOTHING;

ALTER TABLE public.tracker_main_line ENABLE ROW LEVEL SECURITY;

-- Anon reads it through the security_invoker view v_tracker_stories, so it
-- needs the same open read as tracker_pin. It holds story ids only.
DROP POLICY IF EXISTS "tracker_main_line_anon_select" ON public.tracker_main_line;
CREATE POLICY "tracker_main_line_anon_select" ON public.tracker_main_line
  FOR SELECT TO anon
  USING (true);

-- Migration 046 auto-revokes anon on new tables: explicit grant required.
GRANT SELECT ON public.tracker_main_line TO anon;
GRANT ALL ON public.tracker_main_line TO service_role;

-- ----------------------------------------------------------------------------
-- PART B: the homepage order index, without main_line
-- ----------------------------------------------------------------------------
-- Same key and INCLUDE columns as idx_stories_tracker_main_line, minus the
-- main_line condition, plus action_label (the Did/Said chips filter on it, so
-- those pages stay index-only too). The WHERE mirrors v_tracker_stories so the
-- planner can use it.
CREATE INDEX IF NOT EXISTS idx_stories_tracker_spine
  ON public.stories (first_seen_at DESC, id DESC)
  INCLUDE (primary_headline, alarm_level, severity, action_label)
  WHERE status = 'active' AND summary_neutral IS NOT NULL;

-- ----------------------------------------------------------------------------
-- PART C: refresh_tracker_derived writes tracker_main_line
-- ----------------------------------------------------------------------------
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
  n_changed INTEGER;  -- rows actually written (rows_changed)
  n_batch   INTEGER;  -- differences taken this call (decides more_pending)
BEGIN
  IF p_max_rows IS NOT NULL AND p_max_rows < 1 THEN
    RAISE EXCEPTION 'refresh_tracker_derived: p_max_rows must be NULL or at least 1, got %', p_max_rows
      USING ERRCODE = '22023';
  END IF;

  -- 1. Apply the rule. A story the rule puts on the main line gets a row; a row
  --    whose story the rule takes off, or that left the rule's scope (closed,
  --    merged, unenriched), goes. Only differences are written: at most
  --    p_max_rows of them, newest story first (NULL = all).
  --    MATERIALIZED keeps the LIMIT out of the diff's plan (migration 137).
  WITH target AS (
    SELECT r.id FROM public.v_tracker_main_line_rule r WHERE r.main_line
  ),
  changes AS MATERIALIZED (
    SELECT COALESCE(t.id, m.story_id) AS story_id,
           m.story_id IS NULL         AS turn_on
      FROM target t
      FULL JOIN public.tracker_main_line m ON m.story_id = t.id
     WHERE t.id IS NULL OR m.story_id IS NULL
  ),
  batch AS (
    SELECT story_id, turn_on FROM changes ORDER BY story_id DESC LIMIT p_max_rows
  ),
  added AS (
    INSERT INTO public.tracker_main_line (story_id)
    SELECT story_id FROM batch WHERE turn_on
    -- A concurrent refresh (two pipelines finishing together) that already
    -- added it makes this a skip, not an error; RETURNING counts real writes.
    ON CONFLICT (story_id) DO NOTHING
    RETURNING 1
  ),
  removed AS (
    DELETE FROM public.tracker_main_line m
     USING batch b
     WHERE m.story_id = b.story_id AND NOT b.turn_on
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM added) + (SELECT COUNT(*) FROM removed),
         (SELECT COUNT(*) FROM batch)
    INTO n_changed, n_batch;

  -- 2. Tally. One scan per table: `total` is everything public since the term
  --    began (developments), `alarm5` the alarm-5 items of the last 30 days
  --    among them (alarm5_last30).
  INSERT INTO public.tracker_stats (id, developments, alarm5_last30, open_fronts, refreshed_at)
  SELECT 1,
         st.total + sc.total + eo.total + pa.total,
         st.alarm5 + sc.alarm5 + eo.alarm5 + pa.alarm5,
         fr.open_fronts,
         NOW()
    FROM (SELECT COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE first_seen_at >= v_since
                   AND (alarm_level >= 5 OR (alarm_level IS NULL AND severity = 'critical'))) AS alarm5
            FROM public.stories
           WHERE status = 'active' AND summary_neutral IS NOT NULL AND first_seen_at >= v_term) st,
         (SELECT COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE decided_at >= v_since AND ruling_impact_level >= 5) AS alarm5
            FROM public.scotus_cases
           WHERE is_public = true AND decided_at IS NOT NULL AND decided_at >= v_term) sc,
         (SELECT COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE date >= v_since AND alarm_level >= 5) AS alarm5
            FROM public.executive_orders
           WHERE is_public = true AND date >= v_term) eo,
         (SELECT COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE pardon_date >= v_since AND corruption_level >= 5) AS alarm5
            FROM public.pardons
           WHERE is_public = true AND pardon_date >= v_term) pa,
         (SELECT COUNT(*) AS open_fronts
            FROM public.events
           WHERE publish_state = 'published' AND lifecycle <> 'resolved') fr
  ON CONFLICT (id) DO UPDATE
    SET developments  = EXCLUDED.developments,
        alarm5_last30 = EXCLUDED.alarm5_last30,
        open_fronts   = EXCLUDED.open_fronts,
        refreshed_at  = EXCLUDED.refreshed_at;

  rows_changed := n_changed;
  took_ms      := (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::integer;
  -- A full batch means there may be more; the caller asks again. At worst one
  -- extra call returns 0 rows and more_pending = false. Counted on the batch,
  -- not the writes: rows a concurrent refresh wrote first are skipped above,
  -- and must not make a full batch look like the last one (136/137 do that).
  more_pending := p_max_rows IS NOT NULL AND n_batch >= p_max_rows;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.refresh_tracker_derived(integer) IS
  'ADO-570/638/642: applies v_tracker_main_line_rule to tracker_main_line (differences only, at most p_max_rows per call, newest first; NULL = all) and recomputes tracker_stats. Never writes stories. more_pending = the batch was full, call again. Call after every pipeline run and after admin front/pin edits: scripts/maintenance/refresh-tracker.js (batched loop). service_role only.';

REVOKE ALL ON FUNCTION public.refresh_tracker_derived(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tracker_derived(integer) TO service_role;

COMMENT ON VIEW public.v_tracker_main_line_rule IS
  'ADO-570/608/594: THE definition of the Tracker main-line rule (v2, migration 126: pins win; coverage off; published-front member at alarm_eff 4+; unlabeled loose end at 5; loose end did by trump/administration at 3+, said at 4+; ally/other loose ends off). Edit the rule here and only here; refresh_tracker_derived() applies it to tracker_main_line (migration 138). Not public - anon reads the result through v_tracker_stories.';

-- ----------------------------------------------------------------------------
-- PART D: v_tracker_stories reads tracker_main_line
-- ----------------------------------------------------------------------------
-- Same columns in the same order as migration 123 (CREATE OR REPLACE requires
-- it); the grants below are re-run to be safe. main_line is an EXISTS rather than a LEFT JOIN on purpose: it
-- stays true/false (never NULL), and the planner checks it per story while it
-- walks idx_stories_tracker_spine in page order, so the page needs no sort.
CREATE OR REPLACE VIEW public.v_tracker_stories
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.primary_headline,
  s.first_seen_at,
  s.alarm_level,
  s.severity,
  e.id    AS front_id,
  e.name  AS front_name,
  e.slug  AS front_slug,
  p.pin   AS tracker_pin,
  EXISTS (SELECT 1 FROM public.tracker_main_line m WHERE m.story_id = s.id) AS main_line,
  s.action_label,
  s.action_actor
FROM public.stories s
LEFT JOIN public.story_event se ON se.story_id = s.id
LEFT JOIN public.events e ON e.id = se.event_id
                         AND e.publish_state = 'published'
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_stories IS
  'ADO-570/594/642: the Tracker spine''s stories read path. main_line = the story has a tracker_main_line row (written by refresh_tracker_derived); main_line=is.true walks idx_stories_tracker_spine newest first, checking each story against tracker_main_line. Rule lives in v_tracker_main_line_rule. action_label/action_actor added by migration 123. Tight columns on purpose - never widen to content/embedding (egress rule).';

GRANT SELECT ON public.v_tracker_stories TO anon;
GRANT SELECT ON public.v_tracker_stories TO service_role;

-- ----------------------------------------------------------------------------
-- PART E: on_main_line(stories), for service-role reads of stories
-- ----------------------------------------------------------------------------
-- PostgREST treats a function taking a stories row as a column of stories, so
-- `select=...,main_line:on_main_line` returns the same JSON key the old column
-- did, and `on_main_line=is.true` filters on it. The real column keeps the name
-- main_line until it is dropped, hence the different name here.
CREATE OR REPLACE FUNCTION public.on_main_line(s public.stories)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tracker_main_line m WHERE m.story_id = s.id);
$$;

COMMENT ON FUNCTION public.on_main_line(public.stories) IS
  'ADO-642: true when the story is on the Tracker main line (has a tracker_main_line row). PostgREST computed field for service-role reads of stories: select main_line:on_main_line. Anon reads v_tracker_stories.main_line instead.';

REVOKE ALL ON FUNCTION public.on_main_line(public.stories) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.on_main_line(public.stories) TO service_role;

-- ----------------------------------------------------------------------------
-- PART F: retire the stored flag
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.stories.main_line IS
  'ADO-642: NO LONGER WRITTEN (migration 138). Frozen at its value when 138 ran. The main line is tracker_main_line; read v_tracker_stories.main_line or on_main_line(stories). A later migration drops this column.';

-- Its WHERE names a column nobody updates any more. Last statement before
-- COMMIT: DROP INDEX locks stories until the transaction ends.
DROP INDEX IF EXISTS public.idx_stories_tracker_main_line;

-- A new table has no statistics until analyzed; the homepage plan needs them.
ANALYZE public.tracker_main_line;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify (read-only).
SELECT
  (SELECT COUNT(*) FROM public.tracker_main_line)::int                              AS side_rows,
  (SELECT COUNT(*) FROM public.stories WHERE main_line)::int                        AS on_stories,
  (SELECT to_regclass('public.idx_stories_tracker_spine') IS NOT NULL)              AS spine_index,
  (SELECT to_regclass('public.idx_stories_tracker_main_line') IS NOT NULL)          AS old_index,
  has_function_privilege('anon', 'public.on_main_line(public.stories)', 'execute')  AS anon_can_call,
  has_function_privilege('service_role', 'public.on_main_line(public.stories)', 'execute') AS service_can_call;

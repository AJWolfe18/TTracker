-- ============================================================================
-- Migration 113: Precompute the Tracker main line + tally (ADO-570)
-- ============================================================================
-- WHY: the homepage computed "is this story on the main line?" for every
-- active story on every page load (window function + lateral join inside
-- v_tracker_stories, migration 112), three times per visit (spine page + two
-- tally counts). Postgres cannot index a CASE inside a view, so each request
-- was a full scan of ~14K rows: 2.2s cold / 0.2s warm on PROD's nano instance,
-- whose buffer cache evicts on its own between pipeline runs. Measured
-- August 29, 2026; plan: docs/features/events-tracker/plan-tracker-precompute.md
--
-- DESIGN: one rule, one place, one refresh.
--   A) stories.main_line       stored flag + partial index (INCLUDE columns so
--                              the 60-row spine page is an index-only scan)
--   B) tracker_stats           one-row table the masthead tally reads
--   C) v_tracker_main_line_rule the ONLY place rule v1.1 exists (moved verbatim
--                              from the 112 view). service_role-only.
--   D) refresh_tracker_derived() applies C to A and recomputes B. A dumb
--                              applier — no rule logic of its own. Called as the
--                              last step of every pipeline workflow and after
--                              admin front/pin edits (scripts/maintenance/refresh-tracker.js).
--   E) v_tracker_stories       same name, reads the stored column, plain front
--                              join, no window function. Frontend spine unchanged.
--
-- RLS: the refresh runs as SECURITY DEFINER and therefore BYPASSES the
-- migration-111 publish gates that anon reads inherit through security_invoker
-- views. The rule view filters events.publish_state = 'published' explicitly
-- so members of a draft front stay loose ends — exactly what anon saw before.
-- Never rely on RLS inside the rule view.
--
-- Apply manually via the Supabase SQL Editor (NOT apply-migrations.js).
-- Idempotent: safe to re-run. First run rewrites main_line for every row.
-- PROD ORDER: apply between pipeline runs, then IMMEDIATELY run
--   SELECT * FROM public.refresh_tracker_derived();
--   ANALYZE public.stories;   -- new column has no stats until this
-- (the column defaults false — until the refresh runs the spine is empty),
-- THEN cherry-pick the code. The old frontend keeps working throughout.
-- DEPENDENCIES: migrations 111 (events/story_event), 112 (tracker_pin).
-- ROLLBACK: re-run the migration-112 v_tracker_stories block (it recreates the
-- computed CASE); the column, stats table and function can stay.
-- ============================================================================

-- ============================================================================
-- PART A: stored flag + index
-- ============================================================================

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS main_line BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stories.main_line IS
  'ADO-570: precomputed Tracker main-line flag. Written ONLY by refresh_tracker_derived() from v_tracker_main_line_rule — never by hand, never by the pipeline directly. Stale until the next refresh (end of every pipeline run).';

-- INCLUDE makes the spine page an index-only scan: the 60 newest main-line
-- rows come straight from the index with zero heap reads, cold or warm.
-- Predicate mirrors v_tracker_stories' WHERE so the planner can use it.
-- `main_line IS TRUE` (not bare `main_line`) on purpose: PostgREST's
-- `main_line=is.true` emits `IS TRUE`, and the planner would NOT prove that
-- against a bare-boolean partial predicate (verified on TEST with
-- enable_seqscan=off: the index was never chosen). Any hand-written query
-- must use `main_line IS TRUE` too.
DROP INDEX IF EXISTS public.idx_stories_tracker_main_line;  -- converge older predicate forms
CREATE INDEX IF NOT EXISTS idx_stories_tracker_main_line
  ON public.stories (first_seen_at DESC, id DESC)
  INCLUDE (primary_headline, alarm_level, severity)
  WHERE main_line IS TRUE AND status = 'active' AND summary_neutral IS NOT NULL;

-- ============================================================================
-- PART B: tracker_stats — the masthead tally, one row
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tracker_stats (
  id             SMALLINT PRIMARY KEY CONSTRAINT tracker_stats_single_row CHECK (id = 1),
  developments   INTEGER,          -- published developments across all four sources since TERM_START
  alarm5_last30  INTEGER,          -- alarm-5 developments in the 30 days before refreshed_at
  open_fronts    INTEGER,          -- published fronts not resolved
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tracker_stats IS
  'ADO-570: one-row masthead tally for The Tracker, recomputed by refresh_tracker_derived(). Replaces 9 HEAD count=exact requests per page load. Predicates mirror SPECS in src/lib/timeline.ts (see the function body).';

ALTER TABLE public.tracker_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracker_stats_anon_select" ON public.tracker_stats;
CREATE POLICY "tracker_stats_anon_select" ON public.tracker_stats
  FOR SELECT TO anon
  USING (true);

-- Migration 046 auto-revokes anon on new tables — explicit grant required.
GRANT SELECT ON public.tracker_stats TO anon;
GRANT ALL ON public.tracker_stats TO service_role;

-- ============================================================================
-- PART C: v_tracker_main_line_rule — rule v1.1, the single source of truth
-- ============================================================================
-- Moved verbatim from migration 112's v_tracker_stories:
--   pin override            → force_show in, force_hide out
--   no published front      → effective alarm 5 (loose end)
--   front member            → front opening (earliest member) OR alarm 5
--                             OR alarm >= 4 setting a new front peak
-- Runs as the view owner (NOT security_invoker) because the refresh function
-- reads it as service_role; hence the EXPLICIT publish gate on events.

DROP VIEW IF EXISTS public.v_tracker_main_line_rule;
CREATE VIEW public.v_tracker_main_line_rule AS
WITH front_members AS (
  SELECT
    se.story_id,
    ROW_NUMBER() OVER w AS member_seq,
    MAX(
      COALESCE(
        s.alarm_level,
        CASE s.severity
          WHEN 'critical' THEN 5
          WHEN 'severe'   THEN 4
          WHEN 'moderate' THEN 3
          WHEN 'minor'    THEN 2
        END,
        2
      )
    ) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS front_prior_peak
  FROM public.story_event se
  JOIN public.events  e ON e.id = se.event_id
                       AND e.publish_state = 'published'   -- explicit: NOT inherited from RLS
  JOIN public.stories s ON s.id = se.story_id
                       AND s.status = 'active'
                       AND s.summary_neutral IS NOT NULL
  WINDOW w AS (PARTITION BY se.event_id ORDER BY s.first_seen_at, s.id)
)
SELECT
  s.id,
  CASE
    WHEN p.pin = 'force_show' THEN TRUE
    WHEN p.pin = 'force_hide' THEN FALSE
    WHEN fm.story_id IS NULL THEN a.alarm_eff >= 5
    ELSE fm.member_seq = 1
      OR a.alarm_eff = 5
      OR (a.alarm_eff >= 4 AND a.alarm_eff > COALESCE(fm.front_prior_peak, 0))
  END AS main_line
FROM public.stories s
CROSS JOIN LATERAL (
  SELECT COALESCE(
    s.alarm_level,
    CASE s.severity
      WHEN 'critical' THEN 5
      WHEN 'severe'   THEN 4
      WHEN 'moderate' THEN 3
      WHEN 'minor'    THEN 2
    END,
    2
  )::smallint AS alarm_eff
) a
LEFT JOIN front_members fm ON fm.story_id = s.id
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_main_line_rule IS
  'ADO-570: THE definition of the Tracker main-line rule (v1.1, PRD section 12). Edit the rule here and only here; refresh_tracker_derived() applies it to stories.main_line. Not public — anon reads the stored column through v_tracker_stories.';

REVOKE ALL ON public.v_tracker_main_line_rule FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tracker_main_line_rule TO service_role;

-- ============================================================================
-- PART D: refresh_tracker_derived() — apply the rule, recompute the tally
-- ============================================================================
-- Stats predicates MIRROR SPECS in src/lib/timeline.ts (base + alarm(5)):
--   stories : status active, enriched, first_seen_at >= term; alarm 5 =
--             alarm_level >= 5 OR (alarm_level IS NULL AND severity = 'critical')
--   scotus  : is_public, decided_at not null, >= term; alarm 5 = ruling_impact_level >= 5
--   eos     : is_public, date >= term;                 alarm 5 = alarm_level >= 5
--   pardons : is_public, pardon_date >= term;          alarm 5 = corruption_level >= 5
--   fronts  : events published AND lifecycle <> 'resolved'
-- If SPECS changes, change this function in the same commit.

CREATE OR REPLACE FUNCTION public.refresh_tracker_derived()
RETURNS TABLE (rows_changed INTEGER, took_ms INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- v_ prefix: plain names collided with table columns (42702 on first TEST apply)
  t0        TIMESTAMPTZ := clock_timestamp();
  v_term      DATE := DATE '2025-01-20';                 -- TERM_START in src/lib/timeline.ts
  v_since     DATE := (NOW() - INTERVAL '30 days')::date;
  n_apply   INTEGER;
  n_drop    INTEGER;
BEGIN
  -- 1. Apply the rule. Only rows whose flag actually changes are written,
  --    so steady-state runs touch a handful of rows (no bloat).
  UPDATE public.stories s
     SET main_line = r.main_line
    FROM public.v_tracker_main_line_rule r
   WHERE r.id = s.id
     AND s.main_line IS DISTINCT FROM r.main_line;
  GET DIAGNOSTICS n_apply = ROW_COUNT;

  -- 2. Rows that left the rule's scope (closed, merged, unenriched) drop off.
  UPDATE public.stories s
     SET main_line = false
   WHERE s.main_line
     AND NOT (s.status = 'active' AND s.summary_neutral IS NOT NULL);
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
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.refresh_tracker_derived() IS
  'ADO-570: applies v_tracker_main_line_rule to stories.main_line (changed rows only) and recomputes tracker_stats. Call after every pipeline run and after admin front/pin edits: scripts/maintenance/refresh-tracker.js. service_role only.';

REVOKE ALL ON FUNCTION public.refresh_tracker_derived() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tracker_derived() TO service_role;

-- ============================================================================
-- PART E: v_tracker_stories — same name, reads the stored flag
-- ============================================================================
-- DROP + CREATE (not OR REPLACE): the 112 view exposed front_opening and
-- alarm_eff, which only the window function could compute; nothing reads them
-- (frontend selects id,primary_headline,first_seen_at,alarm_level,severity,
-- front_name,front_slug). Grants are re-issued below because DROP loses them.

DROP VIEW IF EXISTS public.v_tracker_stories;
CREATE VIEW public.v_tracker_stories
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
  s.main_line
FROM public.stories s
LEFT JOIN public.story_event se ON se.story_id = s.id
LEFT JOIN public.events e ON e.id = se.event_id
                         AND e.publish_state = 'published'
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_stories IS
  'ADO-570: the Tracker spine''s stories read path. main_line is the STORED flag (refresh_tracker_derived), so main_line=is.true hits idx_stories_tracker_main_line as an index-only scan. Rule lives in v_tracker_main_line_rule. Tight columns on purpose — never widen to content/embedding (egress rule).';

GRANT SELECT ON public.v_tracker_stories TO anon;
GRANT SELECT ON public.v_tracker_stories TO service_role;

-- ============================================================================
-- Verification (run after applying; see plan section 5)
-- ============================================================================
-- SELECT * FROM public.refresh_tracker_derived();
--   -- first run on PROD: rows_changed ~1400, took_ms < 5000
-- SELECT count(*) FROM public.stories WHERE main_line;
-- SELECT * FROM public.tracker_stats;
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, primary_headline, first_seen_at, alarm_level, severity, front_name, front_slug
--     FROM public.v_tracker_stories
--    WHERE main_line IS TRUE AND first_seen_at >= '2025-01-20'
--    ORDER BY first_seen_at DESC, id DESC LIMIT 60;
--   -- expect: Index Only Scan using idx_stories_tracker_main_line, no Sort node,
--   --         rows=60. Heap Fetches drops to ~0 once autovacuum sets the visibility
--   --         map (or run VACUUM public.stories after the first refresh).

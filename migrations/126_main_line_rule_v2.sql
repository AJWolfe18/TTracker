-- ============================================================================
-- Migration 126: Tracker main-line rule v2 - actions above a bar (ADO-594 S4)
-- ============================================================================
-- WHY: the main line should be a record of what he did and said, not of the
-- columns about it (PRD section 14). Builds on rule v1.3 (migration 122), which
-- superseded D4: every published-front member at alarm_eff 4+ stays on.
--
-- RULE v2 (stories), checked in this order:
--   pin force_show                       -> on       (unchanged)
--   pin force_hide                       -> off      (unchanged)
--   action_label = 'coverage'            -> off, front member or not (14.4 step 3)
--   member of a PUBLISHED front          -> alarm_eff >= 4   (v1.3, any other label)
--   loose end, not labeled yet           -> alarm_eff = 5    (v1.3, while S3's backfill runs)
--   loose end, did  by trump/administration -> alarm_eff >= 3 (D3)
--   loose end, said by trump/administration -> alarm_eff >= 4 (D3)
--   loose end by ally/other (or no actor) -> off at every alarm level (D2/D3)
-- With no labels written, v2 gives exactly v1.3's result, so it can ship first.
-- EO/SCOTUS/pardon rows keep their bar (4) in src/lib/timeline.ts.
-- Still the ONLY place the rule lives; refresh_tracker_derived() applies it.
--
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST first, then
-- PROD). Idempotent: safe to re-run. One transaction; if anything errors, run
-- ROLLBACK; alone before retrying. The last statement runs the refresh, so the
-- homepage changes at once; its first column is `rows_changed` (about 0 while
-- no story is labeled: only drift since the last pipeline refresh; 0 on a re-run).
-- DEPENDENCIES: 113 (refresh), 122 (v1.3), 123 (action_label/action_actor).
-- ROLLBACK: re-run migration 122 (it recreates the v1.3 view and refreshes).
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_tracker_main_line_rule;
CREATE VIEW public.v_tracker_main_line_rule AS
SELECT
  s.id,
  CASE
    WHEN p.pin = 'force_show'       THEN TRUE
    WHEN p.pin = 'force_hide'       THEN FALSE
    WHEN s.action_label = 'coverage' THEN FALSE                  -- analysis never counts
    WHEN fm.story_id IS NOT NULL    THEN a.alarm_eff >= 4        -- front member (v1.3)
    WHEN s.action_label IS NULL     THEN a.alarm_eff >= 5        -- unlabeled loose end (v1.3)
    WHEN s.action_actor IN ('trump', 'administration') THEN
      CASE s.action_label
        WHEN 'did'  THEN a.alarm_eff >= 3
        WHEN 'said' THEN a.alarm_eff >= 4
        ELSE FALSE
      END
    ELSE FALSE                                                   -- ally/other loose end (D2/D3)
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
LEFT JOIN (
  -- members of a PUBLISHED front; explicit gate, NOT inherited from RLS
  -- (the view runs as its owner because the refresh reads it as service_role)
  SELECT se.story_id
    FROM public.story_event se
    JOIN public.events e ON e.id = se.event_id AND e.publish_state = 'published'
) fm ON fm.story_id = s.id
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_main_line_rule IS
  'ADO-570/608/594: THE definition of the Tracker main-line rule (v2, migration 126: pins win; coverage off; published-front member at alarm_eff 4+; unlabeled loose end at 5; loose end did by trump/administration at 3+, said at 4+; ally/other loose ends off). Edit the rule here and only here; refresh_tracker_derived() applies it to stories.main_line. Not public - anon reads the stored column through v_tracker_stories.';

REVOKE ALL ON public.v_tracker_main_line_rule FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tracker_main_line_rule TO service_role;

SELECT * FROM public.refresh_tracker_derived();

COMMIT;

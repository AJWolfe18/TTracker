-- ============================================================================
-- Migration 122: Tracker main-line rule v1.3 - the homepage leads with alarm 4-5 (ADO-608)
-- ============================================================================
-- WHY (Josh, October 3, 2026): a first-time visitor saw a wall of minor items.
-- On PROD the main line for September 3 to October 3, 2026 was 88 entries:
-- 87 Election Suppression, 63 of them alarm 3 (that front's v1.2 alarm floor
-- of 3). Every other front was close to invisible, because v1.1/v1.2 only
-- surface a front member as the front's opening, at alarm 5 (zero alarm-5
-- stories in those 30 days), or as a NEW front peak at 4+ - Iran had 9
-- alarm-4 developments and showed none. Josh: "all 4 and 5, yes".
--
-- RULE v1.3 (replaces ADO-594 D4, the anchor principle inside fronts):
--   pin force_show            -> on      (unchanged)
--   pin force_hide            -> off     (unchanged)
--   loose end (no published front) -> alarm_eff = 5   (unchanged)
--   front member              -> alarm_eff >= 4 (that is all)
-- Retired: the front opening clause (an alarm-2 opening put a minor item on
-- the homepage), the new-peak clause, and events.main_line_alarm_floor (the
-- column stays; nothing reads it now, and this file clears Election's 3 so a
-- reader of the events table is not misled). Alarm-3 front members live on
-- their front's page (ADO-548). EO/SCOTUS/pardon rows get their bar (now 4)
-- in the frontend: src/lib/timeline.ts MAIN_LINE_SOURCE_ALARM.
--
-- SIZE on PROD (counted October 3, 2026, front members at 4+ per month, before
-- the ICE front): Jul 64, Aug 36, Sep 44, i.e. 1-2 a day, plus ICE about 25 a
-- month. January-June are denser (Mar 641) because the old GPT enrichment
-- rated about two thirds of stories 4+; ADO-594's did/said/analysis labels
-- are the planned thinning for those months.
--
-- Still the ONLY place the rule lives (migration 113 contract): edit it here,
-- refresh_tracker_derived() applies it to stories.main_line.
--
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST first, then
-- PROD). Idempotent: safe to re-run. The last statement runs the refresh, so
-- the homepage changes immediately (otherwise it waits for the next pipeline
-- run). Runs in one transaction; if anything errors, run ROLLBACK; alone
-- before retrying (a failed transaction poisons the SQL Editor connection).
-- DEPENDENCIES: 111 (events/story_event), 112 (tracker_pin), 113 (refresh),
-- 115 (main_line_alarm_floor column).
-- ROLLBACK: re-run migration 115 PARTS D and E's floor line
--   (UPDATE public.events SET main_line_alarm_floor = 3 WHERE slug = 'election-suppression';)
--   then SELECT * FROM public.refresh_tracker_derived();
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_tracker_main_line_rule;
CREATE VIEW public.v_tracker_main_line_rule AS
SELECT
  s.id,
  CASE
    WHEN p.pin = 'force_show' THEN TRUE
    WHEN p.pin = 'force_hide' THEN FALSE
    WHEN fm.story_id IS NULL  THEN a.alarm_eff >= 5   -- loose end
    ELSE a.alarm_eff >= 4                             -- front member (v1.3)
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
  'ADO-570/608: THE definition of the Tracker main-line rule (v1.3, migration 122: pins win; loose end at alarm_eff 5; published-front member at alarm_eff 4+). Edit the rule here and only here; refresh_tracker_derived() applies it to stories.main_line. Not public - anon reads the stored column through v_tracker_stories.';

REVOKE ALL ON public.v_tracker_main_line_rule FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tracker_main_line_rule TO service_role;

UPDATE public.events SET main_line_alarm_floor = NULL WHERE main_line_alarm_floor IS NOT NULL;

COMMENT ON COLUMN public.events.main_line_alarm_floor IS
  'RETIRED by rule v1.3 (migration 122, ADO-608): no longer read. Every published-front member at alarm 4+ is on the main line. Kept so a rollback to 115 needs no DDL.';

SELECT * FROM public.refresh_tracker_derived();

COMMIT;

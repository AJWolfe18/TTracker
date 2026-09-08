-- ============================================================================
-- Migration 115: Front sweep + per-front main-line alarm floor (ADO-581, closes ADO-557)
-- ============================================================================
-- WHY: every front on PROD was populated once by the hand-run seed sweep
-- (scripts/maintenance/2026-08-24-ado-554-prod-fronts-seed.sql) and nothing has
-- assigned a story to a front since (newest story_event August 25, 2026; 427
-- enriched stories landed after with no front check). Election interference
-- stories such as the USPS whistleblower (alarm 4) never reached the Election
-- Suppression front and so never reached the main line, because rule v1.1 only
-- surfaces a front member at opening / alarm 5 / new front peak.
--
-- WHAT:
--   A) events.sweep_*              the regex sweep is DATA, one row per front:
--                                  pattern + co-word + priority + summary flag.
--                                  Tuning recall is an UPDATE, not a migration.
--   B) events.main_line_alarm_floor rule v1.2 knob: a member at or above the
--                                  floor is on the main line. NULL = v1.1 as is.
--   C) assign_fronts_sweep(p_since) the ONE sweep: backfill (NULL) and every
--                                  pipeline cycle (window) run the same code.
--                                  ON CONFLICT (story_id) DO NOTHING - hand and
--                                  agent assignments always win.
--   D) v_tracker_main_line_rule    v1.2 = v1.1 + floor clause. Still the ONLY
--                                  place the rule lives (migration 113 contract).
--   E) seed                        Election Suppression front if missing (TEST
--                                  never had it), sweep rules for all 8 fronts,
--                                  election floor = 3.
--
-- Apply manually via the Supabase SQL Editor (NOT apply-migrations.js).
-- Idempotent: safe to re-run. Does NOT run the sweep or the refresh itself.
-- CAUTION: PART E re-seeds sweep_pattern / sweep_coword / floor for the eight
-- fronts, so a re-run RESETS any tuning done later with UPDATE events. Re-run
-- PARTS A-D alone if the rules have been tuned since.
-- PROD ORDER (ADO-581 session 1):
--   1. this file
--   2. SELECT * FROM public.assign_fronts_sweep(NULL);   -- full backfill
--   3. SELECT * FROM public.refresh_tracker_derived();
--   then cherry-pick the code (scripts/maintenance/assign-fronts.js + workflows).
-- DEPENDENCIES: 111 (events/story_event), 113 (rule view + refresh function).
-- ROLLBACK: re-run migration 113 PART C (restores rule v1.1); the columns and
-- the sweep function can stay - nothing reads them without this view.
-- ============================================================================

-- ============================================================================
-- PART A + B: columns on events
-- ============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sweep_pattern  TEXT,
  ADD COLUMN IF NOT EXISTS sweep_coword   TEXT,
  ADD COLUMN IF NOT EXISTS sweep_priority SMALLINT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS sweep_summary  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS main_line_alarm_floor SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_main_line_alarm_floor_check') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_main_line_alarm_floor_check
      CHECK (main_line_alarm_floor IS NULL OR main_line_alarm_floor BETWEEN 1 AND 5);
  END IF;
END $$;

COMMENT ON COLUMN public.events.sweep_pattern IS
  'ADO-581: case-insensitive POSIX regex (~*) a story headline must match to be swept into this front. NULL = this front is hand/agent-assigned only.';
COMMENT ON COLUMN public.events.sweep_coword IS
  'ADO-581: optional second regex the HEADLINE must also match (precision anchor, e.g. an election word). Also gates sweep_summary.';
COMMENT ON COLUMN public.events.sweep_priority IS
  'ADO-581: lower wins when several fronts match one story (one front per story). Specific fronts (qatar 10, kushner 20) before broad ones (iran 80).';
COMMENT ON COLUMN public.events.sweep_summary IS
  'ADO-581: when true, sweep_pattern is also tried against summary_neutral, but ONLY for stories whose headline matches sweep_coword. Headline-gated on purpose: an ungated summary match on "midterm" pulled in every political summary (measured September 3, 2026).';
COMMENT ON COLUMN public.events.main_line_alarm_floor IS
  'ADO-581 rule v1.2: a member of this front with alarm_eff >= floor is on the Tracker main line. NULL keeps rule v1.1 (opening / alarm 5 / new peak) unchanged for that front.';

-- ============================================================================
-- PART C: assign_fronts_sweep(p_since)
-- ============================================================================
-- p_since NULL  = every active story (backfill; ~14K rows, ~1-3s on PROD)
-- p_since ts    = stories created, updated or enriched since ts (pipeline
--                 cycle; assign-fronts.js passes a 48h lookback so a missed run
--                 self-heals - idempotent via the PK, so overlap is free).
-- Only stories with NO story_event row are candidates. Draft fronts sweep too
-- (PRD: a front Josh is still curating accumulates stories before it goes
-- public; publish_state gates every public read).
-- Returns one row per front that received at least one story, plus a
-- '_candidates' row so a zero-assignment run is visibly "0 of N", not silence.

CREATE OR REPLACE FUNCTION public.assign_fronts_sweep(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (slug TEXT, assigned INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_candidates INTEGER;
BEGIN
  SELECT COUNT(*)::integer INTO n_candidates
    FROM public.stories st
   WHERE st.status = 'active'
     AND st.primary_headline IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
     AND (p_since IS NULL
          OR st.first_seen_at    >= p_since
          OR st.last_updated_at  >= p_since
          OR st.last_enriched_at >= p_since);

  RETURN QUERY
  WITH pool AS (
    SELECT st.id, st.primary_headline AS h, st.summary_neutral AS s
      FROM public.stories st
     WHERE st.status = 'active'
       AND st.primary_headline IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
       AND (p_since IS NULL
            OR st.first_seen_at    >= p_since
            OR st.last_updated_at  >= p_since
            OR st.last_enriched_at >= p_since)
  ), rules AS (
    SELECT e.id AS event_id, e.slug, e.sweep_pattern, e.sweep_coword, e.sweep_priority, e.sweep_summary
      FROM public.events e
     WHERE e.sweep_pattern IS NOT NULL
  ), pick AS (
    SELECT p.id AS story_id, r.event_id, r.slug, r.sweep_priority
      FROM pool p
      JOIN rules r
        ON (r.sweep_coword IS NULL OR p.h ~* r.sweep_coword)
       AND (p.h ~* r.sweep_pattern
            OR (r.sweep_summary AND r.sweep_coword IS NOT NULL AND p.s IS NOT NULL AND p.s ~* r.sweep_pattern))
  ), best AS (
    -- every reference below is table-qualified: the OUT columns (slug,
    -- assigned) are plpgsql variables and a bare name is ambiguous (42702)
    SELECT DISTINCT ON (pk.story_id) pk.story_id, pk.event_id
      FROM pick pk
     ORDER BY pk.story_id, pk.sweep_priority, pk.event_id
  ), ins AS (
    INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
    SELECT b.story_id, b.event_id, 'agent', 0.8 FROM best b
    ON CONFLICT (story_id) DO NOTHING
    RETURNING event_id
  ), counts AS (
    SELECT e.slug, COUNT(*)::integer AS assigned
      FROM ins JOIN public.events e ON e.id = ins.event_id
     GROUP BY e.slug
  )
  SELECT c.slug, c.assigned FROM counts c
  UNION ALL
  SELECT '_candidates', n_candidates
  ORDER BY 1;
END;
$$;

COMMENT ON FUNCTION public.assign_fronts_sweep(TIMESTAMPTZ) IS
  'ADO-581: deterministic regex sweep of unassigned active stories into fronts using events.sweep_* rules; never overwrites an existing story_event row. NULL = full backfill; a timestamp = stories touched since. Runner: scripts/maintenance/assign-fronts.js (before refresh-tracker.js in every pipeline workflow). service_role only.';

REVOKE ALL ON FUNCTION public.assign_fronts_sweep(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_fronts_sweep(TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- PART D: v_tracker_main_line_rule - rule v1.2
-- ============================================================================
-- v1.1 (migration 113) plus ONE clause: a front member whose alarm_eff is at or
-- above its front's main_line_alarm_floor is on the main line. Fronts with a
-- NULL floor are byte-for-byte v1.1. DROP + CREATE with re-issued grants, as 113.

DROP VIEW IF EXISTS public.v_tracker_main_line_rule;
CREATE VIEW public.v_tracker_main_line_rule AS
WITH front_members AS (
  SELECT
    se.story_id,
    e.main_line_alarm_floor AS floor_eff,
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
      OR (fm.floor_eff IS NOT NULL AND a.alarm_eff >= fm.floor_eff)          -- v1.2
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
  'ADO-570/581: THE definition of the Tracker main-line rule (v1.2 = v1.1 + per-front events.main_line_alarm_floor). Edit the rule here and only here; refresh_tracker_derived() applies it to stories.main_line. Not public - anon reads the stored column through v_tracker_stories.';

REVOKE ALL ON public.v_tracker_main_line_rule FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tracker_main_line_rule TO service_role;

-- ============================================================================
-- PART E: seed - Election Suppression front (if missing), sweep rules, floor
-- ============================================================================
-- Front text is the PROD row from the August 24 seed; ON CONFLICT keeps PROD's.
INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at, started_at, created_by)
VALUES ('election-suppression', 'Election Suppression',
        'Fraud claims as the pretext. Voter-roll purges, attacks on mail-in ballots, threats to seize election machinery, and a push to decide who gets to vote before the next election is held.',
        5, 'flagship', 'open', 'published', NOW(), '2025-03-25T00:00:00+00:00', 'human')
ON CONFLICT (slug) DO NOTHING;

-- Seven fronts: the August 24 seed regexes verbatim, headline only.
UPDATE public.events SET sweep_priority = 10, sweep_summary = false,
  sweep_pattern = 'qatar',
  sweep_coword  = '(jet|747|air force one|plane|boeing)'
WHERE slug = 'qatar-jet';

UPDATE public.events SET sweep_priority = 20, sweep_summary = false,
  sweep_pattern = 'kushner',
  sweep_coword  = NULL
WHERE slug = 'kushners-deals';

UPDATE public.events SET sweep_priority = 30, sweep_summary = false,
  sweep_pattern = '(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)',
  sweep_coword  = '(trump|kushner|witkoff|white house|president)'
WHERE slug = 'trump-crypto';

UPDATE public.events SET sweep_priority = 40, sweep_summary = false,
  sweep_pattern = 'ballroom',
  sweep_coword  = NULL
WHERE slug = 'selling-the-white-house';

UPDATE public.events SET sweep_priority = 60, sweep_summary = false,
  sweep_pattern = 'epstein',
  sweep_coword  = NULL
WHERE slug = 'epstein-files';

UPDATE public.events SET sweep_priority = 70, sweep_summary = false,
  sweep_pattern = '(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))',
  sweep_coword  = '(judge|court|judiciary|judicial)'
WHERE slug = 'the-courts';

UPDATE public.events SET sweep_priority = 80, sweep_summary = false,
  sweep_pattern = '\miran(ian)?\M',
  sweep_coword  = '^(?!.*iranian revolution)'
WHERE slug = 'iran';

-- Election Suppression: the seed regex BROADENED (ADO-581 card: USPS / mail
-- ballot / polling place / voter roll / citizenship list / certification /
-- ICE at polls / election-official prosecution / redistricting), co-word is an
-- election word in the headline, and the pattern is also tried on the summary
-- for headlines that carry an election word. Floor = 3: every alarm 3+ member
-- is on the main line (Josh: the most important thing to track).
UPDATE public.events SET sweep_priority = 50, sweep_summary = true, main_line_alarm_floor = 3,
  -- "rigged" needs an election noun within 20 chars ("polls are rigged" = an
  -- approval-rating story); the ICE-at-polls case is covered by "polling place".
  sweep_pattern = '(voter roll|voter purge|purg(e|es|ed|ing) (of )?(the )?voter|voter registration|voter suppression|voter intimidation|voter (data|database|file)|mail-in|mail ballot|mail(ed)? ballots|vote[- ]by[- ]mail|absentee ballot|ballot (drop ?box|harvest|access)|early voting|hand[- ]count|election fraud|voter fraud|rigged.{0,20}(election|vote|ballot|midterm)|(election|vote|ballot|midterm).{0,20}rigged|stolen election|SAVE Act|seiz(e|es|ed|ing|ure) (of )?(the |voting |election )?(election|machines|equipment|records|ballots|files)|take over (the )?election|nationaliz\w* (the )?election|federaliz\w* (the )?election|election integrity|decertif|certif(y|ies|ied|ying|ication) (of )?(the )?(election|results|vote)|refus\w* to certify|voting rights act|proof of citizenship|citizenship (proof|check|list|verification|question)|noncitizen|non-citizen|voter id|voting machine|election (takeover|police|task force|official|officials|files|records|data|equipment)|(cancel|postpone|suspend|delay)(ing|ed|s)? (the )?(midterm|election)|polling (place|site|location|station)|poll (worker|watcher|closure|closing)|polling[- ]place|usps|postal service|gerrymander|redistrict|congressional map|district map)',
  sweep_coword  = '(election|vote|voter|voting|ballot|midterm|poll|precinct|electoral|redistrict|gerrymander|congressional map)'
WHERE slug = 'election-suppression';

-- ============================================================================
-- Verification (run after applying)
-- ============================================================================
-- SELECT slug, sweep_priority, main_line_alarm_floor, sweep_pattern IS NOT NULL AS has_rule
--   FROM public.events ORDER BY sweep_priority;               -- 8 rows with rules, election floor 3
-- SELECT * FROM public.assign_fronts_sweep(NULL);             -- backfill; expect election >> 0
-- SELECT * FROM public.refresh_tracker_derived();
-- SELECT s.id, s.primary_headline, s.alarm_level, s.main_line
--   FROM public.stories s JOIN public.story_event se ON se.story_id = s.id
--   JOIN public.events e ON e.id = se.event_id AND e.slug = 'election-suppression'
--  WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL
--  ORDER BY s.first_seen_at DESC LIMIT 40;                     -- alarm >= 3 rows all main_line = true
-- SELECT * FROM public.assign_fronts_sweep(NOW() - INTERVAL '48 hours');  -- re-run: only _candidates row

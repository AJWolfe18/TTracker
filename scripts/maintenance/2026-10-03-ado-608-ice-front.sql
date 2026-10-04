-- ADO-608 - new front "ICE & Deportations". Josh asked on October 3, 2026 ("ice / deportations
-- should 100% be its own front and be attached").
-- PROD ORDER: migration 122 (rule v1.3) first or after, either works: this file ends with its own
-- refresh. Tested end to end: scripts/tests/ice-front-sql-pglite.test.mjs.
--
-- WHY: on PROD, 77 alarm-4 stories from September 3 to October 3, 2026 belonged to no front, and
-- roughly a third of them were ICE and deportations. No front meant they never reached the
-- homepage. Measured October 3, 2026 against PROD: over 1,000 unassigned active stories match this
-- sweep (PostgREST caps the count at 1,000), about 65 a month lately; a read of 70 random hits found
-- every one on topic.
--
-- GOES LIVE IMMEDIATELY: inserted as publish_state 'published'. Set v_state to 'draft' in part (2)
-- to hold it back (the sweep still files stories into a draft front).
--
-- DECISIONS (Claude's calls, a one-line UPDATE to change): flagship, alarm 5 (it is the largest
-- unfiled topic and the most alarm-4 stories). Slug ice-deportations. started_at January 20, 2025.
--
-- WHAT THE SWEEP DOES (migration 115 rules: headline only, lowest sweep_priority wins an overlap,
-- only unassigned stories are filed, assigned stories never move):
--   ice-deportations (72): ICE, deport*, immigra*, migrant(s), asylum, refugee admissions, detention
--     camp/center/facility/beds/policy, mass or mandatory detention, detainee(s), third-country,
--     Border Patrol, Bovino, CBP, border czar, Homan, Alligator Alcatraz and the other named camps,
--     CECOT, the Alien Enemies Act, sanctuary cities/states/policies, masked agents, workplace,
--     worksite, farm or factory raids. Priority 72 sits after Election Suppression (50, keeps "ICE
--     at the polls") and The Courts (70, keeps contempt over deportation flights) and before Israel
--     & Gaza (75), Iran (80), RFK (85) and Hegseth (90).
--     The co-word only EXCLUDES: weather and sports "ice" (ice storm, ice cream, hockey, sea ice,
--     thin ice, on ice, glaciers, Vanilla Ice, ice cube), and only when the headline has no
--     immigration word (deport, immigration, migrants, asylum, detention, detain, raids, agents,
--     arrests, border, Homan, Noem, DHS, CBP): "Ice Cube slams ICE raids" and "Judge puts ICE
--     detention expansion on ice" are still filed (code review, October 3, 2026). A bare "raid" is
--     NOT swept (FBI and military raids are other fronts or none).
-- agent_pattern = sweep_pattern verbatim | extras (same convention as the 592/595 files): DHS,
--   Homeland Security, Noem, border, citizenship, visas, TPS, DACA, Dreamers, birthright, travel
--   ban, green cards, naturalization. The agent covers this front once ADO-592 ships.
--
-- RUBRIC (PRD section 2): sustained (since January 2025), accumulating (hundreds of developments),
-- alarm 4 to 5, unresolved, nameable = 5 of 5.
--
-- Three pastes, in order: (1) pre-check (read-only); (2) the APPLY block, from BEGIN to COMMIT,
-- pasted and run as ONE block: write, targeted sweep and main-line refresh in a single transaction,
-- so if any statement errors nothing is saved and the front never goes public half-built; (3)
-- result (read-only).
-- IF THE APPLY BLOCK ERRORS: run   ROLLBACK;   on its own FIRST. A failed transaction stays open on
-- the SQL Editor connection and every later command is refused with "current transaction is
-- aborted". After the ROLLBACK, fix the cause and re-run the whole apply block (it is idempotent).
-- The guards (priority, existing slug) raise on purpose and also need the ROLLBACK.

-- (1) PRE-CHECK (read-only). Lists every front that has a sweep, lowest priority number first.
-- Expect no ice-deportations row and nothing at 72. Part (2) refuses to run if 72 is taken.
SELECT id, slug, name, tier, alarm_level, publish_state, sweep_priority
  FROM public.events
 WHERE sweep_pattern IS NOT NULL
 ORDER BY sweep_priority, id;

-- (2) APPLY: one transaction, BEGIN to COMMIT. Paste and run the whole block at once.
-- On ANY error: run ROLLBACK; by itself before doing anything else (see the header).
BEGIN;

-- (2a) WRITE the front. Idempotent: a front already holding exactly these values is a NOTICE; the
-- slug existing with different values raises (nothing changes, a hand edit is never overwritten).
DO $$
DECLARE
  v_state  CONSTANT TEXT := 'published';   -- 'draft' holds the front back (not public)
  c_slug   CONSTANT TEXT := 'ice-deportations';
  c_name   CONSTANT TEXT := 'ICE & Deportations';
  c_dek    CONSTANT TEXT := 'Mass arrests by masked agents, detention camps, and deportations to third countries and foreign prisons, fought in court at every step.';
  c_start  CONSTANT TIMESTAMPTZ := '2025-01-20T00:00:00+00:00';
  c_sweep  CONSTANT TEXT := '\m(ice|deport\w*|immigra\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\w*|beds?|polic\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?)\M';
  c_coword CONSTANT TEXT := '^(?!.*\m(ice (storms?|cream|caps?|sheets?|age|hockey|rinks?|skat\w*|shelf|shelves|melt\w*|dance|bath|plunge|cube)|sea ice|thin ice|on ice|hockey|glaciers?|vanilla ice)\M)|\m(deport\w*|immigra\w*|migrants?|asylum|detention|detain\w*|detainees?|raids?|agents?|arrests?|border|homan|noem|dhs|cbp)\M';
  c_prio   CONSTANT INTEGER := 72;
  c_agent  CONSTANT TEXT := '\m(ice|deport\w*|immigra\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\w*|beds?|polic\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?)\M|\m(dhs|homeland security|noem|border|citizenship|visas?|tps|temporary protected status|daca|dreamers?|birthright|travel ban|green cards?|naturaliz\w*|denaturaliz\w*)\M';

  v_clash  TEXT;
BEGIN
  -- priority guard: no OTHER sweeping front may share 72 (a tie is decided by event id)
  v_clash := (SELECT string_agg(slug, ', ' ORDER BY slug)
                FROM public.events
               WHERE sweep_pattern IS NOT NULL AND sweep_priority = c_prio AND slug <> c_slug);
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'sweep priority % already taken by %; nothing changed', c_prio, v_clash;
  END IF;

  IF EXISTS (SELECT 1 FROM public.events WHERE slug = c_slug) THEN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = c_slug
                     AND name = c_name AND dek = c_dek AND tier = 'flagship' AND alarm_level = 5
                     AND lifecycle = 'open' AND publish_state = v_state AND started_at = c_start
                     AND sweep_pattern = c_sweep AND sweep_coword = c_coword
                     AND sweep_priority = c_prio AND sweep_summary = false
                     AND main_line_alarm_floor IS NULL AND agent_pattern = c_agent) THEN
      RAISE EXCEPTION 'front % already exists with different values; nothing changed', c_slug;
    END IF;
    RAISE NOTICE 'front % already present with identical values; nothing changed', c_slug;
  ELSE
    INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at,
                               started_at, created_by, sweep_pattern, sweep_coword, sweep_priority,
                               sweep_summary, main_line_alarm_floor, agent_pattern)
    VALUES (c_slug, c_name, c_dek, 5, 'flagship', 'open', v_state,
            CASE WHEN v_state = 'published' THEN NOW() END,
            c_start, 'human', c_sweep, c_coword, c_prio, false, NULL, c_agent);
    RAISE NOTICE 'INSERTED front %', c_slug;
  END IF;
END $$;

-- (2b) TARGETED SWEEP (full backfill for THIS front only; the pipeline's own runs look back 48
-- hours). Same rules as assign_fronts_sweep(NULL) (migration 115): every front's sweep competes and
-- the lowest priority number wins a story, but only stories ice-deportations wins are filed. Stories
-- another front wins are left alone, so the rollback below undoes all of it. Never moves an
-- assigned story. Expect several hundred on PROD.
WITH pool AS (
  SELECT st.id, st.primary_headline AS h, st.summary_neutral AS s
    FROM public.stories st
   WHERE st.status = 'active'
     AND st.primary_headline IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
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
  SELECT DISTINCT ON (pk.story_id) pk.story_id, pk.event_id, pk.slug
    FROM pick pk
   ORDER BY pk.story_id, pk.sweep_priority, pk.event_id
), ins AS (
  INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
  SELECT b.story_id, b.event_id, 'agent', 0.8 FROM best b
   WHERE b.slug = 'ice-deportations'
  ON CONFLICT (story_id) DO NOTHING
  RETURNING story_id, event_id
)
SELECT e.slug, COUNT(*) AS assigned
  FROM ins JOIN public.events e ON e.id = ins.event_id
 GROUP BY e.slug ORDER BY e.slug;

-- (2c) REFRESH the main line (convention after any front or assignment change).
SELECT * FROM public.refresh_tracker_derived();

COMMIT;

-- (3) RESULT (read-only). Expect 1 row, published, members in the hundreds,
-- members_outside_pattern 0, on_main_line > 0 once migration 122 is applied.
SELECT e.id, e.slug, e.name, e.tier, e.alarm_level, e.publish_state, e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))         AS members_outside_pattern,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id AND st.main_line)                                  AS on_main_line
  FROM public.events e
 WHERE e.slug = 'ice-deportations';

-- Rollback (removes the front and every assignment it got; story_event cascades on the event):
-- BEGIN;
-- DELETE FROM public.events WHERE slug = 'ice-deportations';
-- SELECT * FROM public.refresh_tracker_derived();
-- COMMIT;

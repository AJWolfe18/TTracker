-- ADO-582 backfill prep - tighten the election front agent's candidate regex.
-- RECORD ONLY. Run by hand in the PROD SQL Editor (the PROD project). Never deployed by code.
-- Applied on TEST September 30, 2026 (PATCH on events, same value as below).
--
-- WHY: the first PROD run judged 80 stories and declined 73. The seed pattern from
-- migration 116 PART D pulls in every story that says election / midterm / poll / vote,
-- which is mostly horse race, polls and House floor votes. This keeps only the words that
-- point at the voting mechanics the rubric cares about: voters, voting, ballots, precincts,
-- polling places/hours, certification, redistricting, gerrymanders, district maps.
-- Dropped: elections?, electoral, votes?, midterms?, polls?, bare polling, pollsters?, and
-- "voting rights" (redundant, "voting" already matches it).
--
-- GATE: the new pattern must still match EVERY story the election agent has assigned
-- (story_event.note starts with 'fronts-v1'). The DO block below checks that and raises
-- (nothing changes) if any of them would fall out. TEST check, September 30, 2026: all 9
-- agent-assigned TEST stories match (17038, 17031, 16897, 17194, 17185, 17198, 17204,
-- 17245, 17056); TEST unassigned matches went from 111 to 38.
-- The PROD stories assigned so far: 15902 (Missouri map), 16020, 16058, 15921, 15893,
-- 16128, 16035.
--
-- DO NOT re-run migration 116 PART D afterwards: it resets the pattern to the broad seed.
-- The current pattern is recorded here and in docs/features/fronts-claude-agent/plan.md;
-- scripts/tests/front-agent-prompt.test.mjs reads it from THIS file.
--
-- One paste: the DO block (guard + UPDATE), then one result row with the before/after.

DO $$
DECLARE
  new_pattern CONSTANT TEXT := '\m(voters?|voting|ballots?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|polling (place|places|location|locations|hours|site|sites)|certif(y|ies|ied|ying|ication))\M';
  missing BIGINT[];
BEGIN
  SELECT array_agg(st.id ORDER BY st.id) INTO missing
    FROM public.story_event se
    JOIN public.events e  ON e.id = se.event_id AND e.slug = 'election-suppression'
    JOIN public.stories st ON st.id = se.story_id
   WHERE se.note LIKE 'fronts-v1%'
     AND NOT (COALESCE(st.primary_headline, '') ~* new_pattern
              OR COALESCE(st.summary_neutral, '') ~* new_pattern);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'agent_pattern NOT changed: agent-assigned stories would fall out of the pool: %', missing;
  END IF;

  UPDATE public.events SET agent_pattern = new_pattern WHERE slug = 'election-suppression';
END $$;

-- Result row. Expect: agent_assigned >= 7 and agent_assigned_matching equal to it,
-- named_found = 7, pool_after well below pool_before. members_outside_pattern counts
-- sweep/hand members the new regex would not have found (informational; they keep their
-- assignment either way - the pattern only bounds the agent's pool).
WITH e AS (SELECT id, agent_pattern AS pat FROM public.events WHERE slug = 'election-suppression'),
old_pat AS (SELECT '\m(elections?|electoral|votes?|voters?|voting|ballots?|midterms?|polls?|polling|pollsters?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|voting rights|certif(y|ies|ied|ying|ication))\M'::text AS pat),
unjudged AS (
  SELECT st.id, st.primary_headline AS h, st.summary_neutral AS sm
    FROM public.stories st
   WHERE st.status = 'active' AND st.primary_headline IS NOT NULL AND st.summary_neutral IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_skips ps
                      WHERE ps.pipeline = 'front_assignment' AND ps.reason = 'agent_declined'
                        AND ps.entity_type = 'story' AND ps.entity_id = st.id::text
                        AND ps.metadata->>'front' = 'election-suppression'
                        AND ps.created_at >= COALESCE(st.last_updated_at, st.first_seen_at))
),
members AS (
  SELECT se.story_id, se.note, st.primary_headline AS h, st.summary_neutral AS sm
    FROM public.story_event se JOIN e ON e.id = se.event_id JOIN public.stories st ON st.id = se.story_id
)
SELECT (SELECT COUNT(*) FROM unjudged u, old_pat o WHERE u.h ~* o.pat OR u.sm ~* o.pat) AS pool_before,
       (SELECT COUNT(*) FROM unjudged u, e WHERE u.h ~* e.pat OR u.sm ~* e.pat)          AS pool_after,
       (SELECT COUNT(*) FROM members WHERE note LIKE 'fronts-v1%')                       AS agent_assigned,
       (SELECT COUNT(*) FROM members m, e WHERE m.note LIKE 'fronts-v1%'
           AND (COALESCE(m.h, '') ~* e.pat OR COALESCE(m.sm, '') ~* e.pat))              AS agent_assigned_matching,
       (SELECT COUNT(*) FROM members WHERE note LIKE 'fronts-v1%'
           AND story_id IN (15902, 16020, 16058, 15921, 15893, 16128, 16035))            AS named_found,
       (SELECT COUNT(*) FROM members m, e
         WHERE NOT (COALESCE(m.h, '') ~* e.pat OR COALESCE(m.sm, '') ~* e.pat))          AS members_outside_pattern;

-- Rollback (back to the migration 116 seed):
-- UPDATE public.events
--    SET agent_pattern = '\m(elections?|electoral|votes?|voters?|voting|ballots?|midterms?|polls?|polling|pollsters?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|voting rights|certif(y|ies|ied|ying|ication))\M'
--  WHERE slug = 'election-suppression';

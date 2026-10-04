-- ============================================================================
-- Migration 127: one front assignment agent for every front (ADO-592)
-- ============================================================================
-- WHY: the daily front agent (migration 116) judges only Election Suppression.
-- story_event.story_id is the PK (one front per story), so ONE agent reads each
-- candidate once and picks the best front, or declines it as fitting none.
-- WHAT: A) events.agent_definition: the plain definition the agent judges a
-- front against, as DATA (a new front needs no prompt edit). B) Election's
-- definition seeded from its prompt rubric, unchanged. C) a new RPC,
-- front_agent_candidates_all(p_limit), across every agent front (published +
-- agent_pattern + agent_definition): a story is a candidate when it matches ANY
-- such front and has no story_event row. ADO-594 S7 (PRD 14.6): action_label =
-- 'coverage' is never a candidate; unlabeled stories stay in (fail open).
-- DECLINES: a new decline (metadata.front = 'none': fits no front) hides the
-- story from the fronts listed in its metadata.judged_fronts (the agent fronts
-- of that run), so a front added later still gets a look; an old per-front
-- decline (metadata.front = '<slug>', ADO-582) hides it from THAT front only.
-- Both lapse when the story changes (the 116 rule).
-- front_agent_candidates(p_slug) (116) is untouched, so the election-only
-- prompt keeps running until the new prompt reaches main.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD),
-- BEFORE the new prompt merges to that environment's branch. Idempotent; the
-- seed never overwrites an edited definition. One transaction; on error run
-- ROLLBACK; alone before retrying. The last statement is a read-only check
-- whose first column is `agent_fronts` (1 until other definitions are set).
-- DEPENDENCIES: 115, 116 (agent_pattern, story_event.note), 123 (labels).
-- ROLLBACK: DROP FUNCTION public.front_agent_candidates_all(integer);
--   ALTER TABLE public.events DROP COLUMN agent_definition;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: events.agent_definition
-- ----------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS agent_definition TEXT;

COMMENT ON COLUMN public.events.agent_definition IS
  'ADO-592: plain-language definition (what belongs, what does not, calibration examples) the all-fronts assignment agent judges this front against. A front joins the agent only when it is published AND has agent_pattern AND agent_definition. NULL = the agent never assigns to this front. Edit with UPDATE (or admin, ADO-547), never a prompt edit.';

-- ----------------------------------------------------------------------------
-- PART B: seed Election Suppression from prompt-v1 Section 4 (fronts-v1),
-- verbatim. Only when NULL, so a re-run never undoes an edit.
-- ----------------------------------------------------------------------------
UPDATE public.events
   SET agent_definition = $def$The front is "**fronts they are screwing us on**": the record of a government trying to decide who gets to vote and whose votes count. A story belongs on it when a **government actor** (federal or state executive, agency, legislature, court, election board, DOJ, USPS, ICE, a governor, a secretary of state) **takes, orders, threatens, enables or is allowed by a court to take** an action that changes:

1. **Who can vote** - voter-roll purges, registration restrictions, proof-of-citizenship or ID rules, citizenship checks against federal databases, felony-disenfranchisement changes, challenges to eligibility en masse
2. **How votes are cast or counted** - mail-ballot and drop-box restrictions, USPS handling of ballots, polling-place cuts or closures, early-voting cuts, hand-count mandates, voting-machine seizures or decertification, poll-watcher and poll-worker intimidation, law enforcement (ICE, National Guard, federal agents) at or around polling places, threats to postpone or cancel an election
3. **Who certifies and whether results stand** - refusals to certify, replacing election officials or boards, criminal referrals of election workers, "election integrity" task forces aimed at administrators, seizure of election records, federal takeover talk backed by an order or a bill, attempts to overturn or nullify results
4. **How districts are drawn** - a court, legislature or governor **changing** district maps (mid-decade redistricting, a court allowing or blocking a map, a map that eliminates seats of one party, a special session called to redraw). The regex sweep skips this category on purpose because most map coverage is horse race; you are here to keep the ones where the state actually moved the lines or a court decided whether it could

Assign also when the action is a **credible threat or a concrete plan** by such an actor (an executive order drafted, a bill passed one chamber, DOJ demanding a state's voter file), not only a completed act. A **lawsuit filed by the government** or a **court ruling** on any of the four mechanisms counts. A lawsuit filed by a civil-rights group against one of these actions counts too - it is the same fight.

**Decline** when the story is:

- **Horse race or campaign coverage** - polls, approval ratings, fundraising, endorsements, primaries, debates, candidate gaffes, who is running, who is leading, turnout predictions, "what the midterms mean"
- **Commentary or analysis** with no new state action - op-eds, explainers, "here is why X could happen", think-tank reports, anniversaries
- **History pieces** - the origin of gerrymandering, past elections, retrospectives
- **Foreign elections** - unless the US government is acting on them (rare; decline by default)
- **Rhetoric alone** - "Trump says the election was rigged" with no order, bill, lawsuit, or agency action attached. (Rhetoric plus an instruction to an agency is action; check the summary)
- **Mobilization stories** - "ICE raids drive Latino voters to the polls", get-out-the-vote drives, protests, voter guides. Real, but not the state changing the rules
- **Routine map litigation noise** - a filing deadline, a hearing scheduled, a party "weighing" a challenge. Assign the ruling or the map change, not the calendar
- **Election-adjacent policy** with no voting mechanism - census funding fights, campaign-finance rulings, social-media moderation, "election security" cyber stories about foreign hacking (those go nowhere for now; decline)
- **Anything where the election word is incidental** - "pollution", "Apollo", a company vote, a union vote, a congressional vote on an unrelated bill, a "ballot measure" about zoning

### Calibration examples

| Headline (paraphrased) | Decision | Why |
|---|---|---|
| Missouri court allows Trump-backed congressional districts to take effect | **assign** 0.90 | Court let a mid-decade map change stand: mechanism 4, state action |
| Texas legislature passes mid-decade map that could flip five seats | **assign** 0.90 | Legislature changed district lines for partisan gain |
| Indiana governor calls special session to redraw congressional map | **assign** 0.80 | Concrete plan by a state actor to redraw; assign the session, not the speculation before it |
| California voters to decide on redistricting response measure | **decline** 0.70 | A ballot measure campaign; no map has changed yet. Reconsider when it passes |
| Whistle-blower: federal agents may have broken state law in voter-fraud search | **assign** 0.85 | Federal agents acting on voter records: mechanisms 1 and 3 |
| Texas county cuts a third of its polling sites before the midterms | **assign** 0.90 | Mechanism 2, completed state action |
| DOJ sues Colorado for its full voter file | **assign** 0.85 | Federal action on voter rolls (mechanism 1); the lawsuit IS the action |
| Trump says polls are rigged as his approval rating struggles | **decline** 0.90 | Rhetoric about opinion polls; no state action |
| When Gerry met a salamander: the 1812 roots of gerrymandering | **decline** 0.95 | History piece |
| Anger over ICE raids is driving some Latino voters to the polls | **decline** 0.85 | Mobilization, not the state changing the rules |
| Senate Democrats vow to fight the SAVE Act in committee | **decline** 0.60, borderline | A bill with proof-of-citizenship rules (mechanism 1) but the story is the opposition's posture. Assign when the bill passes a chamber or an agency starts enforcing |
| Poll: most Americans expect the midterms to be unfair | **decline** 0.95 | A poll |
| Supreme Court to hear Louisiana Voting Rights Act case | **assign** 0.75 | The Court taking the case is a decision on mechanism 4 with national effect; the ruling itself is a separate, higher-confidence assignment |
| City council vote on downtown zoning ballot measure | **decline** 0.95 | Election word is incidental |

**Alarm level is not part of the decision.** A low-alarm story that meets the rubric still belongs on the front (it just stays off the main line, which is the alarm floor's job). A high-alarm story that fails the rubric is declined.$def$
 WHERE slug = 'election-suppression'
   AND agent_definition IS NULL;

-- ----------------------------------------------------------------------------
-- PART C: front_agent_candidates_all(p_limit)
-- ----------------------------------------------------------------------------
-- One row per candidate story. matched_fronts = the agent fronts whose pattern
-- matched and that have not declined the story since it last changed, lowest
-- sweep_priority first (a hint for the agent; it may pick any agent front).
-- pool_size repeats on every row (COUNT(*) OVER () runs before LIMIT).
-- Every column is table-qualified (RETURNS TABLE names, 42702 on migration 115).
CREATE OR REPLACE FUNCTION public.front_agent_candidates_all(
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  story_id         BIGINT,
  primary_headline TEXT,
  summary_neutral  TEXT,
  alarm_level      INTEGER,
  category         TEXT,
  action_label     TEXT,
  action_actor     TEXT,
  matched_fronts   TEXT[],
  first_seen_at    TIMESTAMPTZ,
  last_updated_at  TIMESTAMPTZ,
  pool_size        INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH agent_fronts AS (
    SELECT e.id AS front_id, e.slug AS front_slug, e.agent_pattern, e.sweep_priority
      FROM public.events e
     WHERE e.publish_state = 'published'
       AND e.agent_pattern IS NOT NULL
       AND NULLIF(btrim(e.agent_definition), '') IS NOT NULL
  ),
  base AS MATERIALIZED (
    -- the cheap filters first; the regexes below only run on what is left
    SELECT st.id AS sid, st.primary_headline AS headline, st.summary_neutral AS summary,
           COALESCE(st.last_updated_at, st.first_seen_at) AS changed_at
      FROM public.stories st
     WHERE st.status = 'active'
       AND st.primary_headline IS NOT NULL
       AND st.summary_neutral IS NOT NULL                 -- the publish gate
       AND st.action_label IS DISTINCT FROM 'coverage'    -- ADO-594 S7; NULL stays in
       AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
  ),
  matched AS (
    SELECT b.sid,
           array_agg(f.front_slug ORDER BY f.sweep_priority, f.front_id) AS fronts
      FROM base b
      JOIN agent_fronts f
        ON (b.headline ~* f.agent_pattern OR b.summary ~* f.agent_pattern)
     WHERE NOT EXISTS (
             -- declined for this front since the story last changed: an old
             -- per-front decline (ADO-582), or a "fits no front" decline from
             -- a run that judged it against this front
             SELECT 1 FROM public.pipeline_skips ps
              WHERE ps.pipeline    = 'front_assignment'
                AND ps.reason      = 'agent_declined'
                AND ps.entity_type = 'story'
                AND ps.entity_id   = b.sid::text
                AND ps.created_at >= b.changed_at
                AND (ps.metadata->>'front' = f.front_slug
                     OR (ps.metadata->>'front' = 'none'
                         AND ps.metadata->'judged_fronts' ? f.front_slug)))
     GROUP BY b.sid
  )
  SELECT st.id,
         st.primary_headline,
         st.summary_neutral,
         st.alarm_level::integer,
         st.category::text,
         st.action_label,
         st.action_actor,
         m.fronts,
         st.first_seen_at,
         st.last_updated_at,
         COUNT(*) OVER ()::integer
    FROM matched m
    JOIN public.stories st ON st.id = m.sid
   ORDER BY st.first_seen_at DESC, st.id DESC
   LIMIT GREATEST(COALESCE(p_limit, 25), 1);
$$;

COMMENT ON FUNCTION public.front_agent_candidates_all(INTEGER) IS
  'ADO-592: candidate pool for the all-fronts assignment agent - active enriched stories, not labeled coverage, with no story_event row, whose headline or summary_neutral matches the agent_pattern of at least one agent front (published, agent_pattern and agent_definition set). Declines (pipeline_skips front_assignment/agent_declined) since the story last changed hide it per front: metadata.front = none from each front in metadata.judged_fronts, metadata.front = <slug> (ADO-582) from that front only. Newest first; pool_size = total before LIMIT. service_role only. Prompt: docs/features/fronts-claude-agent/prompt-v1.md';

REVOKE ALL ON FUNCTION public.front_agent_candidates_all(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.front_agent_candidates_all(INTEGER) TO service_role;

COMMIT;

-- Read-only check. Expect agent_fronts = 1 (election only) until the other
-- fronts' definitions are set, election_definition = true, candidates_fn = 1.
SELECT
  (SELECT count(*) FROM public.events
    WHERE publish_state = 'published' AND agent_pattern IS NOT NULL
      AND NULLIF(btrim(agent_definition), '') IS NOT NULL)                  AS agent_fronts,
  (SELECT agent_definition IS NOT NULL FROM public.events
    WHERE slug = 'election-suppression')                                    AS election_definition,
  (SELECT count(*) FROM pg_proc WHERE proname = 'front_agent_candidates_all') AS candidates_fn,
  (SELECT COALESCE(MAX(c.pool_size), 0) FROM public.front_agent_candidates_all(1) c) AS pool_size;

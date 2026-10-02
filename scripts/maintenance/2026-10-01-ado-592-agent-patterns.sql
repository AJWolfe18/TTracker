-- ADO-592 groundwork - draft events.agent_pattern for the 7 fronts other than election-suppression.
-- DRAFT. NOT APPLIED ANYWHERE (TEST or PROD) as of October 1, 2026.
-- Apply it as part of the ADO-592 build: TEST first (SQL editor), PROD before the all-fronts routine
-- goes live there. Nothing reads these values today: scripts/fronts/front-agent-db.js is hardcoded
-- to 'election-suppression', so setting them early is harmless but also pointless.
--
-- WHY: ADO-592 is one agent that picks the best front (or none) for every unassigned story.
-- front_agent_candidates(p_slug) (migration 116) only returns a pool for a front whose
-- agent_pattern is set; the pattern bounds the pool, the agent applies the judgment.
--
-- SHAPE OF EACH PATTERN: <the front's sweep_pattern, verbatim from migration 115 PART E> |
-- \m(<extra terms>)\M. Keeping the sweep verbatim makes every pattern a superset of its sweep, so
-- every sweep-assigned member (sweeps read the headline) matches by construction, on TEST and PROD.
-- The extras widen it to the summary column and to the synonyms the sweep misses.
--
-- GATE (per front, stricter than the ADO-582 file): every CURRENT member of the front (any
-- story_event row: sweep, hand or agent) must match the new pattern on headline OR summary_neutral.
-- Each front is decided on its own: a front with a member outside its pattern, or with a different
-- agent_pattern already set, is SKIPPED with a NOTICE naming the reason and the story ids; the
-- other fronts still apply. To leave a front out on purpose, delete its line from both arrays.
--
-- TEST measurement, October 1, 2026 (PostgREST imatch, which is the same ~* operator the RPC uses;
-- pool = active, headline and summary not null, no story_event row, headline OR summary matches;
-- no front other than election has decline rows yet, so the decline exclusion is 0 for all 7):
--   front                     pool  members matched
--   epstein-files                0  181 / 181
--   iran                        10   43 / 43
--   trump-crypto                 2    6 / 6
--   qatar-jet                    1    1 / 1
--   selling-the-white-house      2   13 / 13
--   the-courts                  50    9 / 9
--   kushners-deals               4    0 / 0  (no members on TEST)
--   union of the 7 pools: 69 of 645 active, enriched, unassigned TEST stories.
-- PROD will be much larger (the election pool was 1,095 on PROD vs 38 on TEST); the result query
-- at the end reports the real PROD pools.
--
-- DO NOT edit migration 116 PART D or the ADO-582 file for this; election-suppression is untouched.
--
-- Three pastes, in order: (1) pre-check (read-only), (2) the DO block, (3) the result query.
-- In the SQL editor, read the NOTICE output of (2): one line per front, APPLIED or SKIPPED.

-- (1) PRE-CHECK (read-only). Expect 7 rows, every agent_pattern NULL.
SELECT id, slug, publish_state, agent_pattern
  FROM public.events
 WHERE slug IN ('epstein-files', 'iran', 'trump-crypto', 'qatar-jet',
                'selling-the-white-house', 'the-courts', 'kushners-deals')
 ORDER BY id;

-- (2) GUARDED UPDATE, one front at a time.
DO $$
DECLARE
  slugs CONSTANT TEXT[] := ARRAY[
    'epstein-files',
    'iran',
    'trump-crypto',
    'qatar-jet',
    'selling-the-white-house',
    'the-courts',
    'kushners-deals'
  ];
  pats CONSTANT TEXT[] := ARRAY[
    'epstein|\m(ghislaine|giuffre|birthday book|client list)\M',
    '\miran(ian)?\M|\m(iran\w*|tehran|hormuz|khamenei|irgc|ayatollah|fordow|natanz|isfahan|war powers)\M',
    '(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)|\m(meme ?coins?|wlfi|usd1|digital assets?|tokens?|nfts?|digital trading cards?)\M',
    'qatar|\m(747s?|jumbo jet|boeing|(new|gifted|qatari|luxury|replacement) air force one)\M',
    'ballroom|\m(east wing|donors?|donations?|fundrais\w*|incognito|pay[- ]to[- ]play|fine arts commission|capital planning commission)\M',
    '(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))|\m(judges?|judiciary|judicial|injunctions?|restraining orders?|court orders?|appeals courts?|appellate|circuit courts?|district courts?|unconstitutional|struck down|strikes? down|impeach\w*|boasberg|blocks?|blocked|blocking)\M',
    'kushner|\m(affinity partners|jared|public investment fund|pif|sovereign wealth|electronic arts|saudi\w*|emirat\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\M'
  ];
  current_pat TEXT;
  missing     BIGINT[];
BEGIN
  IF array_length(slugs, 1) <> array_length(pats, 1) THEN
    RAISE EXCEPTION 'slugs and pats arrays differ in length; nothing changed';
  END IF;

  FOR i IN 1 .. array_length(slugs, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = slugs[i]) THEN
      RAISE NOTICE 'SKIPPED %: front not found', slugs[i];
      CONTINUE;
    END IF;

    SELECT agent_pattern INTO current_pat FROM public.events WHERE slug = slugs[i];
    IF current_pat IS NOT NULL AND current_pat <> pats[i] THEN
      RAISE NOTICE 'SKIPPED %: a different agent_pattern is already set (left unchanged)', slugs[i];
      CONTINUE;
    END IF;

    SELECT array_agg(st.id ORDER BY st.id) INTO missing
      FROM public.story_event se
      JOIN public.events e   ON e.id = se.event_id AND e.slug = slugs[i]
      JOIN public.stories st ON st.id = se.story_id
     WHERE NOT (COALESCE(st.primary_headline, '') ~* pats[i]
                OR COALESCE(st.summary_neutral, '') ~* pats[i]);
    IF missing IS NOT NULL THEN
      RAISE NOTICE 'SKIPPED %: current members would fall outside the pattern: %', slugs[i], missing;
      CONTINUE;
    END IF;

    UPDATE public.events SET agent_pattern = pats[i] WHERE slug = slugs[i];
    RAISE NOTICE 'APPLIED %', slugs[i];
  END LOOP;
END $$;

-- (3) RESULT. One row per front. A front with no pattern shows NOT APPLIED and NULL counts (never
-- a fake 0). Expect PATTERN SET for every front the DO block printed APPLIED, members_matching =
-- members and members_outside_pattern = 0. A front skipped for "a different agent_pattern is already
-- set" also shows PATTERN SET: that is the OLD value, left unchanged (see the agent_pattern column).
-- pool is the RPC's own pool_size (exact, includes the decline exclusion); 0 = empty pool.
SELECT CASE WHEN e.agent_pattern IS NULL THEN 'NOT APPLIED' ELSE 'PATTERN SET' END AS status,
       e.id,
       e.slug,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       CASE WHEN e.agent_pattern IS NOT NULL THEN
         (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
           WHERE se.event_id = e.id
             AND (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                  OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))
       END AS members_matching,
       CASE WHEN e.agent_pattern IS NOT NULL THEN
         (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
           WHERE se.event_id = e.id
             AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                      OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))
       END AS members_outside_pattern,
       CASE WHEN e.agent_pattern IS NOT NULL THEN
         COALESCE((SELECT MAX(c.pool_size) FROM public.front_agent_candidates(e.slug, 1) c), 0)
       END AS pool,
       e.agent_pattern
  FROM public.events e
 WHERE e.slug IN ('epstein-files', 'iran', 'trump-crypto', 'qatar-jet',
                  'selling-the-white-house', 'the-courts', 'kushners-deals')
 ORDER BY e.id;

-- Rollback: clears ONLY the patterns this file set (agent_pattern still equal to this file's value
-- for that slug). A front the DO block skipped because a different pattern was already set keeps it.
-- UPDATE public.events e
--    SET agent_pattern = NULL
--   FROM (VALUES
--   ('epstein-files', 'epstein|\m(ghislaine|giuffre|birthday book|client list)\M'),
--   ('iran', '\miran(ian)?\M|\m(iran\w*|tehran|hormuz|khamenei|irgc|ayatollah|fordow|natanz|isfahan|war powers)\M'),
--   ('trump-crypto', '(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)|\m(meme ?coins?|wlfi|usd1|digital assets?|tokens?|nfts?|digital trading cards?)\M'),
--   ('qatar-jet', 'qatar|\m(747s?|jumbo jet|boeing|(new|gifted|qatari|luxury|replacement) air force one)\M'),
--   ('selling-the-white-house', 'ballroom|\m(east wing|donors?|donations?|fundrais\w*|incognito|pay[- ]to[- ]play|fine arts commission|capital planning commission)\M'),
--   ('the-courts', '(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))|\m(judges?|judiciary|judicial|injunctions?|restraining orders?|court orders?|appeals courts?|appellate|circuit courts?|district courts?|unconstitutional|struck down|strikes? down|impeach\w*|boasberg|blocks?|blocked|blocking)\M'),
--   ('kushners-deals', 'kushner|\m(affinity partners|jared|public investment fund|pif|sovereign wealth|electronic arts|saudi\w*|emirat\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\M')
--   ) AS v(slug, pat)
--  WHERE e.slug = v.slug
--    AND e.agent_pattern = v.pat;

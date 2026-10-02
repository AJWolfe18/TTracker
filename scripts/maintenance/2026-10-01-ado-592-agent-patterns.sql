-- ADO-592 groundwork - draft events.agent_pattern for the 7 fronts other than election-suppression.
-- DRAFT. NOT APPLIED ANYWHERE (TEST or PROD) as of October 1, 2026.
-- Apply it as part of the ADO-592 build: TEST first (SQL editor), PROD before the all-fronts routine
-- goes live there. Nothing reads these values today: scripts/fronts/front-agent-db.js is hardcoded
-- to 'election-suppression', so setting them early is harmless but also pointless.
--
-- WHY: ADO-592 is one agent that picks the best front (or none) for every unassigned story.
-- front_agent_candidates(p_slug) (migration 116) only returns a pool for a front whose
-- agent_pattern is set; the pattern bounds the pool, the agent applies the judgment. Each draft
-- starts from the front's sweep_pattern (migration 115) and widens it to (a) the summary column,
-- which most sweeps do not read, and (b) the obvious synonyms the sweep misses.
--
-- GATE (stricter than the ADO-582 file): every CURRENT member of each front (any story_event row,
-- sweep, hand or agent) must match the new pattern on headline OR summary_neutral. The DO block
-- raises (nothing changes) and lists the ids if any member would fall outside. It also refuses to
-- overwrite a different non-NULL agent_pattern.
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
-- PROD will be much larger (the election pool was 1,095 on PROD vs 38 on TEST); the result row
-- at the end reports the real PROD pools.
--
-- DO NOT edit migration 116 PART D or the ADO-582 file for this; election-suppression is untouched.
--
-- Three pastes, in order: (1) pre-check (read-only), (2) the DO block, (3) the result query.

-- (1) PRE-CHECK (read-only). Expect 7 rows, every agent_pattern NULL.
SELECT id, slug, publish_state, agent_pattern
  FROM public.events
 WHERE slug IN ('epstein-files', 'iran', 'trump-crypto', 'qatar-jet',
                'selling-the-white-house', 'the-courts', 'kushners-deals')
 ORDER BY id;

-- (2) GUARDED UPDATE.
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
    '\m(epstein\w*|ghislaine|giuffre|birthday book|client list)\M',
    '\m(iran\w*|tehran|hormuz|khamenei|irgc|ayatollah|fordow|natanz|isfahan|war powers)\M',
    '\m(crypto\w*|memecoins?|meme ?coins?|stablecoins?|bitcoin|binance|world liberty|wlfi|usd1|digital assets?|tokens?|nfts?|digital trading cards?)\M',
    '\m(qatar\w*|747s?|jumbo jet|boeing|(new|gifted|qatari|luxury|replacement) air force one)\M',
    '\m(ballroom|east wing|donors?|donations?|fundrais\w*|incognito|pay[- ]to[- ]play|fine arts commission|capital planning commission)\M',
    '\m(judges?|judiciary|judicial|contempt|injunctions?|restraining orders?|court orders?|appeals courts?|appellate|circuit courts?|district courts?|unconstitutional|struck down|strikes? down|def(y|ies|ied|ying|iance)|impeach\w*|boasberg|blocks?|blocked|blocking)\M',
    '\m(kushner\w*|affinity partners|jared|public investment fund|pif|sovereign wealth|electronic arts|saudi\w*|emirat\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\M'
  ];
  found   INTEGER;
  missing BIGINT[];
  report  TEXT := '';
BEGIN
  SELECT COUNT(*) INTO found FROM public.events WHERE slug = ANY (slugs);
  IF found <> array_length(slugs, 1) THEN
    RAISE EXCEPTION 'agent_pattern NOT changed: expected % fronts, found %', array_length(slugs, 1), found;
  END IF;

  FOR i IN 1 .. array_length(slugs, 1) LOOP
    IF EXISTS (SELECT 1 FROM public.events
                WHERE slug = slugs[i] AND agent_pattern IS NOT NULL AND agent_pattern <> pats[i]) THEN
      RAISE EXCEPTION 'agent_pattern NOT changed: % already has a different agent_pattern', slugs[i];
    END IF;

    SELECT array_agg(st.id ORDER BY st.id) INTO missing
      FROM public.story_event se
      JOIN public.events e   ON e.id = se.event_id AND e.slug = slugs[i]
      JOIN public.stories st ON st.id = se.story_id
     WHERE NOT (COALESCE(st.primary_headline, '') ~* pats[i]
                OR COALESCE(st.summary_neutral, '') ~* pats[i]);
    IF missing IS NOT NULL THEN
      report := report || format('%s: %s; ', slugs[i], missing);
    END IF;
  END LOOP;

  IF report <> '' THEN
    RAISE EXCEPTION 'agent_pattern NOT changed: current members would fall outside the pattern: %', report;
  END IF;

  FOR i IN 1 .. array_length(slugs, 1) LOOP
    UPDATE public.events SET agent_pattern = pats[i] WHERE slug = slugs[i];
  END LOOP;
END $$;

-- (3) RESULT. One row per front. Expect agent_pattern_set true, members_matching = members,
-- members_outside_pattern 0. pool is the RPC's own pool_size (exact, includes the decline
-- exclusion); 0 when the pool is empty.
SELECT e.id,
       e.slug,
       e.agent_pattern IS NOT NULL AS agent_pattern_set,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))         AS members_matching,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))     AS members_outside_pattern,
       COALESCE((SELECT MAX(c.pool_size) FROM public.front_agent_candidates(e.slug, 1) c), 0) AS pool
  FROM public.events e
 WHERE e.slug IN ('epstein-files', 'iran', 'trump-crypto', 'qatar-jet',
                  'selling-the-white-house', 'the-courts', 'kushners-deals')
 ORDER BY e.id;

-- Rollback (back to no agent pass for these fronts):
-- UPDATE public.events
--    SET agent_pattern = NULL
--  WHERE slug IN ('epstein-files', 'iran', 'trump-crypto', 'qatar-jet',
--                 'selling-the-white-house', 'the-courts', 'kushners-deals');

-- ADO-610 - one front "Trump Corruption" replaces four small ones. Josh, October 4, 2026: "the
-- Trump corruption should be the front ... that includes crypto, qatar jet, abusing markets, jared
-- kushner etc", plus "trump paying his friend to do the reflection pool" and "pumping oil markets
-- with his fake deals".
-- PROD ORDER: independent of migration 122 and the ADO-608 ICE file (either order works; this file
-- ends with its own refresh). Tested end to end: scripts/tests/corruption-front-sql-pglite.test.mjs.
--
-- WHAT IT DOES, in one transaction:
--   1. Backs up the four old fronts' settings and every membership it moves, into two small
--      service-role-only tables (front_merge_backup_events / front_merge_backup_story_event, tag
--      'ado-610'). The rollback at the bottom reads them, so nothing has to be remembered by hand.
--   2. Creates trump-corruption (flagship, alarm 5, published) with one sweep that keeps every
--      old rule and adds the new threads below.
--   3. MOVES every story of trump-crypto, qatar-jet, selling-the-white-house and kushners-deals
--      ("The Envoys' Deals") into it. Nothing is lost; story_event's PK is story_id, so a move is
--      an UPDATE of event_id.
--   4. Retires the four old fronts: publish_state 'draft' (hidden, NOT deleted) and their sweep and
--      agent patterns cleared, so new stories are not filed into hidden fronts.
--   5. Targeted sweep: files unassigned stories the new keywords match (old rules found nothing new,
--      they already ran every 2 hours).
--   6. Refreshes the main line.
--
-- MEASURED ON PROD, October 4, 2026 (anon reads): old fronts hold 48 + 8 + 123 + 17 = 196 stories.
-- The new branches match 123 UNASSIGNED stories (67 at alarm 4+, 13 at 5), measured branch by
-- branch because the whole regex exceeds the anon statement timeout: Reflecting Pool 51, family
-- business 16, insider/stock trading tied to Trump 15, gold card 9, no-bid / self-dealing /
-- emoluments 8, Trump Media 5, compensation fund 6, oil deals for allies 5, donor contracts and
-- pardons 4, presidential library 4, anti-corruption bodies 3, Trump Organization, East Potomac and
-- LIV Golf 1 each. A random 60 read: about 57 on topic; the weak ones were a Nicki Minaj gold-card
-- photo, a newspaper reader call-out, and a Homeland Security nominee's own stock trading. Many
-- Reflecting Pool items are low-alarm saga coverage (draining, algae, the vandalism case).
-- SPEED: about 2 s per 20,000 headlines on PGlite (the ICE sweep is 0.25 s). Fine for this paste
-- and for the pipeline sweep (48-hour pool). Each lookahead branch puts the RARE word first (the
-- name or the crypto word): the Kushner branch in its original order was 8x slower, same matches.
--
-- THE SWEEP (headline only, one regex, no co-word: each old front's co-word is folded into its own
-- branch as a lookahead, so it matches exactly what the old rule matched):
--   kept:  crypto words + a Trump/Kushner/Witkoff/White House/president word (was trump-crypto);
--          Qatar + jet/747/plane/Air Force One/Boeing in either order (was qatar-jet); ballroom
--          (was selling-the-white-house); Kushner/Witkoff/Affinity Partners with its full business
--          co-word (was kushners-deals, verbatim).
--   new:   Reflecting Pool; East Potomac; oil deal(s), Harold Hamm; stock or insider trading or market
--          manipulation next to Trump or the White House (a bare "administration" caught any agency); Trump Media (not "Trump media ban /
--          ecosystem / coverage / outlets / personalities"), Truth Social stock/shares/priority, DJT;
--          Trump Organization; emoluments, self-dealing, kleptocracy, no-bid, FCPA; Greco; anti-corruption
--          squads/units/monitors/bodies/watchdogs/offices only next to Trump/FBI/DOJ/White House/federal
--          (foreign anti-corruption laws and bureaus stay out); gold card; Trump
--          presidential library; LIV Golf; Trump family (Eric, Don Jr, Ivanka, sons, family,
--          children) ONLY next to a money word (business, firm, deal, invest, stake, loan, paid,
--          bankrolled, resort, develop, rich...); donor/megadonor/fundraiser/crony next to
--          contract/pardon/loan; compensation fund next to Trump or Jan. 6.
--   NOT swept on purpose (too noisy as bare words; the assignment agent judges them once ADO-592
--   ships): corruption, bribe, pay-to-play, donor alone, Rose Garden, the arch, Trump Tower, golf.
-- PRIORITY 15: lower wins an overlap, so Corruption takes a shared story ahead of Election (50),
--   Epstein (60), Courts (70), ICE (72), Israel (75), Iran (80), RFK (85), Hegseth (90). This only
--   decides NEW or unassigned stories; assigned stories never move.
-- agent_pattern = sweep verbatim | extras (convention of the 592/595/608 files), including The
--   Envoys' Deals' extras. NOTE: the daily Claude assignment pass judges ONLY Election Suppression
--   today (scripts/fronts/front-agent-db.js FRONT_SLUG); this pattern takes effect when ADO-592
--   ships. Until then only the keyword sweep feeds this front.
--
-- RUBRIC (PRD section 2): sustained (since January 2025), accumulating (hundreds of developments),
-- alarm 4 to 5, unresolved, nameable = 5 of 5.
--
-- Three pastes, in order: (1) pre-check (read-only); (2) the APPLY block, BEGIN to COMMIT, pasted and
-- run as ONE block; (3) result (read-only).
-- IF THE APPLY BLOCK ERRORS: run   ROLLBACK;   on its own FIRST. A failed transaction stays open on
-- the SQL Editor connection and every later command is refused with "current transaction is
-- aborted". After the ROLLBACK, fix the cause and re-run the whole apply block (it is idempotent).
-- The guards (priority, existing slug, missing old front, editorial updates) raise on purpose and
-- also need the ROLLBACK.

-- (1) PRE-CHECK (read-only). Expect the four old fronts published with members (PROD: 48, 8, 123,
-- 17), updates 0, and no trump-corruption row. Part (2) refuses to run if anything is off.
SELECT e.id, e.slug, e.publish_state, e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id)   AS members,
       (SELECT COUNT(*) FROM public.event_updates u WHERE u.event_id = e.id)   AS updates
  FROM public.events e
 WHERE e.slug IN ('trump-crypto', 'qatar-jet', 'selling-the-white-house', 'kushners-deals', 'trump-corruption')
 ORDER BY e.sweep_priority, e.id;

-- (2) APPLY: one transaction, BEGIN to COMMIT. Paste and run the whole block at once.
-- On ANY error: run ROLLBACK; by itself before doing anything else (see the header).
BEGIN;

-- Block story_event writes (pipeline sweep, front agent, admin) until COMMIT, so no story is filed
-- into an old front while this runs; reads are not blocked. A pipeline sweep that already read the
-- old rules can still land a story there after COMMIT: the result query shows it as old-front
-- members above 0, and re-running this apply block moves it (see part 3).
LOCK TABLE public.story_event IN SHARE ROW EXCLUSIVE MODE;

-- (2a) Backup tables. Generic on purpose (merge_tag), so the ADO-592 front review can reuse them.
-- Service role only: RLS on with no policy, and anon/authenticated grants revoked.
CREATE TABLE IF NOT EXISTS public.front_merge_backup_events (
  merge_tag      TEXT        NOT NULL,
  event_id       BIGINT      NOT NULL,
  slug           TEXT        NOT NULL,
  publish_state  TEXT        NOT NULL,
  published_at   TIMESTAMPTZ,
  sweep_pattern  TEXT,
  sweep_coword   TEXT,
  sweep_priority SMALLINT    NOT NULL,
  sweep_summary  BOOLEAN     NOT NULL,
  agent_pattern  TEXT,
  backed_up_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merge_tag, event_id)
);
CREATE TABLE IF NOT EXISTS public.front_merge_backup_story_event (
  merge_tag     TEXT        NOT NULL,
  story_id      BIGINT      NOT NULL,
  from_event_id BIGINT      NOT NULL,
  moved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merge_tag, story_id)
);
COMMENT ON TABLE public.front_merge_backup_events IS
  'ADO-610: settings of fronts retired by a merge, one row per (merge_tag, front), written before the change. The merge file''s rollback restores from here. Service role only.';
COMMENT ON TABLE public.front_merge_backup_story_event IS
  'ADO-610: story memberships moved by a front merge (story_id, the front it came from). The merge file''s rollback moves them back from here. Service role only.';
ALTER TABLE public.front_merge_backup_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.front_merge_backup_story_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.front_merge_backup_events      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.front_merge_backup_story_event FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.front_merge_backup_events      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.front_merge_backup_story_event TO service_role;

-- (2b) Guards, backup, create, move, retire. Idempotent: a re-run finds the front with identical
-- values (NOTICE), the old fronts already retired, and nothing left to move.
DO $$
DECLARE
  v_state  CONSTANT TEXT := 'published';   -- 'draft' holds the new front back (not public)
  c_tag    CONSTANT TEXT := 'ado-610';
  c_old    CONSTANT TEXT[] := ARRAY['trump-crypto', 'qatar-jet', 'selling-the-white-house', 'kushners-deals'];
  c_slug   CONSTANT TEXT := 'trump-corruption';
  c_name   CONSTANT TEXT := 'Trump Corruption';
  c_dek    CONSTANT TEXT := 'Family crypto coins, a 747 from Qatar, a ballroom paid for by donors, no-bid contracts for friends, Gulf money for the family business, and the president''s own stock trades. The office, run for profit.';
  c_start  CONSTANT TIMESTAMPTZ := '2025-01-17T00:00:00+00:00';   -- the $TRUMP memecoin launch
  c_sweep  CONSTANT TEXT := '^(?=.*(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)).*(trump|kushner|witkoff|white house|president)|qatar.*(jet|747|air force one|plane|boeing)|(jet|747|air force one|plane|boeing).*qatar|ballroom|^(?=.*\m(kushner\w*|witkoff\w*|affinity partners)\M)(?!.*\m(world liberty|wlfi|usd1|crypto\w*|memecoins?|meme coins?|stablecoins?|bitcoin|binance|charles kushner|josh kushner|tony kushner|thrive capital)\M)(?=.*\m(affinity|business (deal|deals|dealings|interests|ties|empire)|dealings|money|windfalls?|payday|payments?|fundrais\w*|investors?|investment (firm|fund|company)|private equity|profit\w*|conflicts? of interest|ethics?|hotels?|resorts?|real estate|financial (empire|interests?|ties|disclosures?|stakes?|dealings)|disclos\w*|empire|probes?|investigat\w*|(saudi|qatari|emirati|abu dhabi|uae|gulf|foreign|sovereign) (money|fund|funds|investors?|investment|cash|royals?|backers?|wealth)|pif|public investment fund|electronic arts|paramount|warner|sazan|albania\w*|serbia\w*|belgrade)\M)|reflecting pool|east potomac|\moil deals?\M|harold hamm|\m(trump\w*|white house)\M.*\m(stock trad\w*|insider trad\w*|market manipulat\w*)|\m(stock trad\w*|insider trad\w*|market manipulat\w*).*\m(trump\w*|white house)\M|trump media\M(?! (ban|ecosystem|coverage|outlets?|personalit))|truth social (stock|shares|priority)|\mdjt\M|trump organi[sz]ation|\mtrump org\M|\m(emoluments?|self[- ]dealing|kleptocra\w*|no[- ]bid|foreign corrupt practices|fcpa)\M|\mgreco\M|^(?=.*\m(trump\w*|fbi|doj|justice department|white house|federal)\M).*anti[- ]corruption (squads?|units?|monitor\w*|bod(y|ies)|watchdogs?|offices?|sections?|divisions?|enforcement|probes?)|gold card|\mtrump\w*\M.*presidential library|presidential library.*\mtrump|trump library|liv golf|^(?=.*\m(eric trump|trump jr|don jr|donald trump jr|ivanka|trump sons|trump family|trump children)\M).*\m(business\w*|firms?|company|companies|deals?|invest\w*|stakes?|ventures?|startups?|backed|profit\w*|resorts?|develop\w*|loans?|contracts?|fund\w*|money|bankroll\w*|paid|portfolio|brand|licens\w*|towers?|golf|hotels?|rich|wealth\w*|windfalls?)\M|\m(donors?|megadonors?|fundraisers?|cronies|crony)\M.*\m(contracts?|pardon\w*|loans?)\M|\m(contracts?|pardon\w*)\M.*\m(donors?|megadonors?|fundraisers?|cronies|crony)\M|\m(trump\w*|jan(uary)?\.? 6)\M.*compensation fund|compensation fund.*\mtrump';
  c_prio   CONSTANT INTEGER := 15;
  c_agent  CONSTANT TEXT := c_sweep || '|\m(corrupt\w*|donors?|megadonors?|oligarchs?|bribe\w*|kickbacks?|conflicts? of interest|self[- ]enrich\w*|pay[- ]to[- ]play|grift\w*|cronies|crony|cronyism|payouts?|watchdogs?|inspectors? general|qatar\w*|crypto\w*|stablecoins?|memecoins?|golf|resorts?|licensing|gifts?|rose garden|arch|jared|special envoys?|board of peace|sazan|phoenix financial|public investment fund|pif|sovereign wealth|electronic arts|tahnoon|aryam|mgx|g42|saudi\w*|emirat\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\M';

  v_new    BIGINT;
  v_clash  TEXT;
  v_missing TEXT;
  v_updates INTEGER;
  v_moved  INTEGER;
BEGIN
  -- the four old fronts must exist (a typo or an earlier hand rename stops here)
  v_missing := (SELECT string_agg(s, ', ') FROM unnest(c_old) s
                 WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.slug = s));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'old front(s) not found: %; nothing changed', v_missing;
  END IF;

  -- editorial updates are human-approved copy; moving them is a decision, not a side effect
  v_updates := (SELECT COUNT(*) FROM public.event_updates u JOIN public.events e ON e.id = u.event_id
                 WHERE e.slug = ANY (c_old));
  IF v_updates > 0 THEN
    RAISE EXCEPTION 'the old fronts have % editorial update(s); move or reject them first; nothing changed', v_updates;
  END IF;

  -- priority guard: no OTHER still-sweeping front may share 15 (the old fronts are retired below)
  v_clash := (SELECT string_agg(slug, ', ' ORDER BY slug)
                FROM public.events
               WHERE sweep_pattern IS NOT NULL AND sweep_priority = c_prio
                 AND slug <> c_slug AND NOT (slug = ANY (c_old)));
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'sweep priority % already taken by %; nothing changed', c_prio, v_clash;
  END IF;

  -- backup the old fronts' settings BEFORE touching them (first run wins; a re-run keeps the original)
  INSERT INTO public.front_merge_backup_events (merge_tag, event_id, slug, publish_state, published_at,
              sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern)
  SELECT c_tag, e.id, e.slug, e.publish_state, e.published_at,
         e.sweep_pattern, e.sweep_coword, e.sweep_priority, e.sweep_summary, e.agent_pattern
    FROM public.events e
   WHERE e.slug = ANY (c_old)
  ON CONFLICT (merge_tag, event_id) DO NOTHING;

  -- create the front, or confirm an identical one
  IF EXISTS (SELECT 1 FROM public.events WHERE slug = c_slug) THEN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = c_slug
                     AND name = c_name AND dek = c_dek AND tier = 'flagship' AND alarm_level = 5
                     AND lifecycle = 'open' AND publish_state = v_state AND started_at = c_start
                     AND sweep_pattern = c_sweep AND sweep_coword IS NULL
                     AND sweep_priority = c_prio AND sweep_summary = false
                     AND main_line_alarm_floor IS NULL AND agent_pattern = c_agent) THEN
      RAISE EXCEPTION 'front % already exists with different values; nothing changed', c_slug;
    END IF;
    RAISE NOTICE 'front % already present with identical values', c_slug;
  ELSE
    INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at,
                               started_at, created_by, sweep_pattern, sweep_coword, sweep_priority,
                               sweep_summary, main_line_alarm_floor, agent_pattern)
    VALUES (c_slug, c_name, c_dek, 5, 'flagship', 'open', v_state,
            CASE WHEN v_state = 'published' THEN NOW() END,
            c_start, 'human', c_sweep, NULL, c_prio, false, NULL, c_agent);
    RAISE NOTICE 'INSERTED front %', c_slug;
  END IF;
  v_new := (SELECT id FROM public.events WHERE slug = c_slug);

  -- backup then move every membership of the old fronts
  INSERT INTO public.front_merge_backup_story_event (merge_tag, story_id, from_event_id)
  SELECT c_tag, se.story_id, se.event_id
    FROM public.story_event se JOIN public.events e ON e.id = se.event_id
   WHERE e.slug = ANY (c_old)
  ON CONFLICT (merge_tag, story_id) DO NOTHING;

  UPDATE public.story_event se
     SET event_id = v_new
    FROM public.events e
   WHERE e.id = se.event_id AND e.slug = ANY (c_old);
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'moved % stories into %', v_moved, c_slug;

  -- retire the old fronts: hidden, not deleted, and no longer sweeping or agent-judged
  UPDATE public.events
     SET publish_state = 'draft', sweep_pattern = NULL, sweep_coword = NULL, agent_pattern = NULL
   WHERE slug = ANY (c_old)
     AND (publish_state <> 'draft' OR sweep_pattern IS NOT NULL OR sweep_coword IS NOT NULL OR agent_pattern IS NOT NULL);
END $$;

-- (2c) TARGETED SWEEP (full backfill for THIS front only; the pipeline's own runs look back 48
-- hours). Same rules as assign_fronts_sweep(NULL) (migration 115): every front's sweep competes and
-- the lowest priority number wins a story, but only stories trump-corruption wins are filed. Never
-- moves an assigned story.
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
   WHERE b.slug = 'trump-corruption'
  ON CONFLICT (story_id) DO NOTHING
  RETURNING story_id, event_id
)
SELECT e.slug, COUNT(*) AS assigned
  FROM ins JOIN public.events e ON e.id = ins.event_id
 GROUP BY e.slug ORDER BY e.slug;

-- (2d) REFRESH the main line (convention after any front or assignment change).
SELECT * FROM public.refresh_tracker_derived();

COMMIT;

-- (3) RESULT (read-only). Expect: trump-corruption published with members = moved + swept (PROD:
-- 196 moved plus about 120 swept); the four old fronts draft, 0 members, no sweep.
-- IF AN OLD FRONT SHOWS MEMBERS ABOVE 0: a pipeline run filed a story there during the paste. Run
-- the apply block (2) again; it is idempotent and moves and backs up the stragglers.
-- moved_outside_pattern counts moved stories the new agent_pattern would not match on headline or
-- summary (hand-seeded ones can be legitimately outside); it is information, not a failure.
SELECT e.slug, e.publish_state, e.tier, e.alarm_level, e.sweep_priority,
       e.sweep_pattern IS NOT NULL                                                   AS sweeps,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id)         AS members,
       (SELECT COUNT(*) FROM public.front_merge_backup_story_event b
         WHERE b.merge_tag = 'ado-610' AND e.slug = 'trump-corruption')               AS moved_in,
       (SELECT COUNT(*) FROM public.story_event se
          JOIN public.front_merge_backup_story_event b ON b.merge_tag = 'ado-610' AND b.story_id = se.story_id
          JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))        AS moved_outside_pattern,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id AND st.main_line)                                  AS on_main_line
  FROM public.events e
 WHERE e.slug IN ('trump-corruption', 'trump-crypto', 'qatar-jet', 'selling-the-white-house', 'kushners-deals')
 ORDER BY e.publish_state DESC, e.slug;

-- ROLLBACK. It puts every moved story back in its old front, restores the old fronts' settings from
-- the backup, and deletes trump-corruption; every other member of it becomes unassigned (story_event
-- cascades on the event). It then sweeps ALL active unassigned stories once (assign_fronts_sweep(NULL),
-- migration 115) so the restored rules refile them, not only the last 48 hours the pipeline looks at;
-- that full sweep also files any other unassigned story a front's rule matches, as each front's own
-- creation backfill did.
-- HAND ASSIGNMENTS made to Trump Corruption after the merge are dropped. List them first (read-only):
--   SELECT se.story_id, st.primary_headline FROM public.story_event se
--     JOIN public.stories st ON st.id = se.story_id
--    WHERE se.event_id = (SELECT id FROM public.events WHERE slug = 'trump-corruption')
--      AND se.assigned_by = 'human'
--      AND NOT EXISTS (SELECT 1 FROM public.front_merge_backup_story_event b
--                       WHERE b.merge_tag = 'ado-610' AND b.story_id = se.story_id);
-- Then paste as one block:
-- BEGIN;
-- UPDATE public.story_event se SET event_id = b.from_event_id
--   FROM public.front_merge_backup_story_event b
--  WHERE b.merge_tag = 'ado-610' AND b.story_id = se.story_id
--    AND se.event_id = (SELECT id FROM public.events WHERE slug = 'trump-corruption');
-- UPDATE public.events e SET publish_state = b.publish_state, published_at = b.published_at,
--        sweep_pattern = b.sweep_pattern, sweep_coword = b.sweep_coword, sweep_priority = b.sweep_priority,
--        sweep_summary = b.sweep_summary, agent_pattern = b.agent_pattern
--   FROM public.front_merge_backup_events b
--  WHERE b.merge_tag = 'ado-610' AND b.event_id = e.id;
-- DELETE FROM public.events WHERE slug = 'trump-corruption';
-- SELECT * FROM public.assign_fronts_sweep(NULL);
-- DELETE FROM public.front_merge_backup_story_event WHERE merge_tag = 'ado-610';
-- DELETE FROM public.front_merge_backup_events WHERE merge_tag = 'ado-610';
-- SELECT * FROM public.refresh_tracker_derived();
-- COMMIT;

-- ADO-595 - three fronts: Kushner's Deals widens to "The Envoys' Deals" (Kushner + Witkoff),
-- new "Israel & Gaza", new "RFK Jr.'s HHS". Josh asked on October 2, 2026.
-- Run AFTER 2026-10-01-ado-592-hegseth-pentagon-front.sql (that file creates hegseth-pentagon,
-- now flagship per Josh, October 2, 2026). This file does not touch hegseth-pentagon.
-- APPLIED ON TEST October 2, 2026 (PostgREST writes of the same values, then
-- assign_fronts_sweep(NULL) and refresh_tracker_derived()). PROD: Josh pastes this file.
--
-- GOES LIVE IMMEDIATELY: both new fronts are inserted as publish_state 'published'. Set v_state to
-- 'draft' in part (2) to hold them back (the sweep still files stories into a draft front).
--
-- DECISIONS (Josh, October 2, 2026):
--   Envoys: Kushner + Witkoff together. Stories that name World Liberty or other crypto stay on
--   Trump Crypto (negative co-word below). Slug stays kushners-deals (the id and every existing
--   assignment are kept; the slug is not public yet, rename it before front pages ship, ADO-548).
--   Israel: three strands - elections and AIPAC, pushing the US toward war with Iran, Gaza.
--   Israel's government and US pro-Israel groups are named separately. Genocide findings are
--   attributed (UN commission of inquiry, ICJ, IAGS and so on) and never stated in the site's voice.
--   Tiers (Claude's call, a one-line UPDATE to change): all three major, alarm 4.
--
-- WHAT EACH SWEEP DOES (migration 115 rules: headline only, lowest sweep_priority wins an overlap,
-- only unassigned stories are filed, assigned stories never move):
--   kushners-deals (20): Kushner (also "Kushners"), Witkoff or Affinity Partners in the headline AND a
--     specific money phrase: Affinity, money, investors, fundraising, private equity, a Saudi/Qatari/
--     Emirati/Abu Dhabi/Gulf/foreign/sovereign fund or money, a financial empire or financial ties,
--     business deals, conflict of interest, ethics, probe, hotel, resort, disclosure, windfall, PIF,
--     Electronic Arts, Paramount, Warner, Sazan, Serbia, Albania. A bare "deal", "billion", "invest",
--     "conflict", a country name or "Gulf" is NOT enough: the sweep is permanent (assigned stories never
--     move) and priority 20 beats Iran and Israel, so diplomacy headlines ("Witkoff says Iran deal is
--     close", "Kushner unveils $112 billion Gaza reconstruction plan") are left for the front agent
--     (ADO-592) to judge. A money story that also mentions talks ("Witkoff family took $500 million
--     from Abu Dhabi fund as Gaza talks stalled") still lands here. Crypto words (World Liberty, USD1,
--     stablecoin, Binance...) and other Kushners (Charles, Josh, Tony) are excluded.
--   israel-gaza (75): Israel, Netanyahu, Gaza, Hamas, the West Bank, Palestinians, AIPAC, United
--     Democracy Project, pro-Israel. A headline that says "Iran" qualifies ONLY when Israel or
--     Netanyahu pushes the US in it: "Israel/Netanyahu <urges|presses|pressures|lobbies|pushes|
--     convinces|persuades|goads|lures|drags> ... US/Trump/Washington/Congress" (not followed by "back"
--     or "by"), or "Trump/Washington/Congress ... <pressured|pushed|urged...> by Israel/Netanyahu".
--     Everything else that says "Iran" stays on Iran (80): "US and Israel strike Iran", "Iran pushes
--     back after Israeli strikes", "Trump urged Netanyahu to hold off", "Israel under pressure from
--     Trump". Headlines naming only Tehran or Khamenei (not "Iran") are not on Iran's sweep, so they
--     come here. Pro-Palestinian and pro-Hamas protest or campus headlines are excluded.
--   rfk-hhs (85): RFK, Robert F. Kennedy, Kennedy Jr., Secretary Kennedy, MAHA, ACIP, vaccine panel
--     or schedule, CDC, HHS, health secretary, Monarez, Tylenol. A bare "Kennedy" is NOT swept (Sen.
--     John Kennedy is "Sen. Kennedy" in most headlines); the agent pattern keeps it, so the agent
--     judges those. Excludes the Kennedy Center, other Kennedys, JFK, RFK Stadium, assassination
--     stories and stories about a former health secretary.
-- agent_pattern = sweep_pattern verbatim | extras (same convention as the 592 files): every swept
-- member matches it by construction. The agent covers these fronts once ADO-592 ships.
--
-- RUBRIC (PRD section 2): all three are sustained (2025 to now), accumulating (seed timelines in
-- docs/features/events-tracker/seeds/, 48 to 60 developments each), alarm 4 to 5, unresolved and
-- nameable = 5 of 5.
--
-- TEST, October 2, 2026, before the apply (unassigned active stories the sweeps match):
-- rfk-hhs 21, israel-gaza 37, kushners-deals 1.
-- TEST apply, October 2, 2026: events ids 13 (Envoys), 16 (israel-gaza), 17 (rfk-hhs); the values
-- were written from this file's constants and read back byte for byte. assign_fronts_sweep(NULL)
-- filed israel-gaza 37, rfk-hhs 21, kushners-deals 1 and nothing for any other front.
-- refresh_tracker_derived(): main line Israel 5, RFK 4, Envoys 1. members_outside_pattern 0.
-- Code review round 1 (medium) tightened the Envoys money words, the Israel-over-Iran rule and the
-- bare "Kennedy" in the RFK sweep, and added kushner\w*. TEST was re-synced to this file the same day
-- (read back byte for byte); a re-sweep filed nothing new. Under these final patterns the TEST sweep
-- would file rfk-hhs 20 (story 16449 "Kennedy, other Trump officials balk..." is now agent-only; it
-- stays filed on TEST and is inside agent_pattern). Round 2 (medium) made the Israel-over-Iran rule
-- directional ("by" required for the passive form; no "push back", "pulled back" or "under pressure"),
-- dropped bare billion/million/invest/financing from the Envoys money words, and left Tehran- or
-- Khamenei-only headlines to Israel (Iran's sweep never matched them). TEST re-synced again, read
-- back byte for byte, membership unchanged. PGlite run of this whole file: 42 headlines placed as
-- expected, re-run files nothing, the hand-edit guard raises, rollback works.
-- TEST is thin for these fronts (its RSS window is short); the seed timelines and the backfill
-- plan (docs/features/events-tracker/plan-595-fronts-backfill.md) are how the 2025 record gets in.
--
-- Five pastes, in order: (1) pre-check, (2) DO block, (3) targeted sweep, (4) refresh, (5) result.

-- (1) PRE-CHECK (read-only). Lists every front that has a sweep, lowest priority number first.
-- Expect iran at 80. On a first run: kushners-deals at 20 with sweep_pattern 'kushner', and no
-- israel-gaza or rfk-hhs rows. If another front already uses 75 or 85, stop and ask (a tie falls
-- back to the lower event id).
SELECT id, slug, name, tier, alarm_level, publish_state, sweep_priority, sweep_pattern
  FROM public.events
 WHERE sweep_pattern IS NOT NULL
 ORDER BY sweep_priority, id;

-- (2) WRITE the three fronts. Idempotent: a front already holding exactly these values is a
-- NOTICE. A new front whose slug exists with different values raises (nothing changes). For
-- kushners-deals, the update only runs when the sweep is still the original 'kushner' (the August
-- 24, 2026 seed); any other value raises, so a hand edit is never overwritten.
DO $$
DECLARE
  v_state CONSTANT TEXT := 'published';   -- 'draft' holds the two NEW fronts back (not public)

  -- The Envoys' Deals (existing row, slug kushners-deals)
  k_name   CONSTANT TEXT := 'The Envoys'' Deals';
  k_dek    CONSTANT TEXT := 'Jared Kushner and Steve Witkoff negotiate for the United States in Gaza, Iran and Ukraine while their families'' businesses take billions from the same Gulf governments sitting across the table.';
  k_sweep  CONSTANT TEXT := '\m(kushner\w*|witkoff\w*|affinity partners)\M';
  k_coword CONSTANT TEXT := '^(?!.*\m(world liberty|wlfi|usd1|crypto\w*|memecoins?|meme coins?|stablecoins?|bitcoin|binance|charles kushner|josh kushner|tony kushner|thrive capital)\M)(?=.*\m(affinity|business (deal|deals|dealings|interests|ties|empire)|dealings|money|windfalls?|payday|payments?|fundrais\w*|investors?|investment (firm|fund|company)|private equity|profit\w*|conflicts? of interest|ethics?|hotels?|resorts?|real estate|financial (empire|interests?|ties|disclosures?|stakes?|dealings)|disclos\w*|empire|probes?|investigat\w*|(saudi|qatari|emirati|abu dhabi|uae|gulf|foreign|sovereign) (money|fund|funds|investors?|investment|cash|royals?|backers?|wealth)|pif|public investment fund|electronic arts|paramount|warner|sazan|albania\w*|serbia\w*|belgrade)\M)';
  k_agent  CONSTANT TEXT := '\m(kushner\w*|witkoff\w*|affinity partners)\M|\m(jared|special envoys?|board of peace|sazan|phoenix financial|public investment fund|pif|sovereign wealth|electronic arts|tahnoon|aryam|mgx|g42|saudi\w*|emirat\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\M';

  -- Israel & Gaza (new)
  i_slug   CONSTANT TEXT := 'israel-gaza';
  i_name   CONSTANT TEXT := 'Israel & Gaza';
  i_dek    CONSTANT TEXT := 'US weapons, money and UN vetoes behind Israel''s war in Gaza, which a UN commission of inquiry has called genocide (Israel and the US reject the finding). Israel''s push to pull the US into war with Iran. And the pro-Israel super PAC money and Israeli government influence campaigns aimed at American elections.';
  i_start  CONSTANT TIMESTAMPTZ := '2025-01-20T00:00:00+00:00';
  i_sweep  CONSTANT TEXT := '\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*)\M';
  i_coword CONSTANT TEXT := '^(?!.*\m(pro-palestinian|pro-hamas)\M)((?!.*\miran(ian)?\M)|.*\m(israel\w*|netanyahu)\M.{0,60}\m(urg(es|ed|ing)|press(es|ed|ing)|pressur(es|ed|ing)|lobb(ies|ied|ying)|push(es|ed|ing)|convinc(es|ed|ing)|persuad(es|ed|ing)|goad(s|ed|ing)|lur(es|ed|ing)|drag(s|ged|ging))\M(?!\s+(back|by)\M).{0,60}\m(us|u\.s|america\w*|trump|washington|white house|congress)\M|.*\m(trump|washington|white house|congress)\M.{0,40}\m(pressured|pushed|lobbied|urged|persuaded|convinced|dragged|goaded|lured)\s+by\s+(the\s+)?(israel\w*|netanyahu)\M)';
  i_prio   CONSTANT INTEGER := 75;
  i_agent  CONSTANT TEXT := '\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*)\M|\m(fara|foreign agents? registration|havas|clock tower x|bridges partners|esther project|stoic|diaspora ministry|ministry of diaspora|democratic majority for israel|dmfi|adelson|gaza humanitarian foundation|ghf|international stabilization force|international criminal court|icc|albanese|icj|international court of justice|famine|genocide|epic fury|midnight hammer|war powers)\M';

  -- RFK Jr.'s HHS (new)
  r_slug   CONSTANT TEXT := 'rfk-hhs';
  r_name   CONSTANT TEXT := 'RFK Jr.''s HHS';
  r_dek    CONSTANT TEXT := 'The anti-vaccine activist running the nation''s health agencies fired the vaccine advisers and the CDC director, cut the childhood vaccine schedule and tied Tylenol to autism, while measles came back and thousands of health workers lost their jobs.';
  r_start  CONSTANT TIMESTAMPTZ := '2025-02-13T00:00:00+00:00';
  r_sweep  CONSTANT TEXT := '\m(rfk|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c)\M';
  r_coword CONSTANT TEXT := '^(?!.*\m(kennedy center|kennedy honors|performing arts|schlossberg|rfk stadium|john kennedy|sen\. kennedy|senator kennedy|anthony kennedy|kennedy space|jfk|ted kennedy|caroline kennedy|kerry kennedy|joe kennedy|assassination|becerra|former health secretary|ex-us health secretary)\M)';
  r_prio   CONSTANT INTEGER := 85;
  r_agent  CONSTANT TEXT := '\m(rfk|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c)\M|\m(kennedy|vaccines?|vaccinations?|measles|autism|fluoride|mrna|fda|nih|makary|prasad|bhattacharya|surgeon general|public health|gavi|thimerosal|hepatitis b)\M';

  v_exists BOOLEAN;
  v_same   BOOLEAN;
  v_old    TEXT;
  missing  BIGINT[];
BEGIN
  -- Envoys: update in place
  v_exists := EXISTS (SELECT 1 FROM public.events WHERE slug = 'kushners-deals');
  IF NOT v_exists THEN
    RAISE EXCEPTION 'kushners-deals not found; nothing changed (expected the August 24, 2026 seed row)';
  END IF;
  v_same := EXISTS (SELECT 1 FROM public.events WHERE slug = 'kushners-deals'
                      AND name = k_name AND dek = k_dek AND tier = 'major' AND alarm_level = 4
                      AND sweep_pattern = k_sweep AND sweep_coword = k_coword
                      AND sweep_priority = 20 AND sweep_summary = false AND agent_pattern = k_agent);
  IF v_same THEN
    RAISE NOTICE 'kushners-deals already holds the Envoys values; nothing changed';
  ELSE
    v_old := (SELECT sweep_pattern FROM public.events WHERE slug = 'kushners-deals');
    IF v_old IS DISTINCT FROM 'kushner' THEN
      RAISE EXCEPTION 'kushners-deals sweep_pattern is %, not the original kushner; nothing changed', v_old;
    END IF;
    UPDATE public.events
       SET name = k_name, dek = k_dek, tier = 'major', alarm_level = 4,
           sweep_pattern = k_sweep, sweep_coword = k_coword, sweep_priority = 20,
           sweep_summary = false, agent_pattern = k_agent, updated_at = NOW()
     WHERE slug = 'kushners-deals';
    RAISE NOTICE 'UPDATED kushners-deals to The Envoys'' Deals';
  END IF;
  -- member gate: every current member must match the new agent_pattern. The old sweep was 'kushner'
  -- anywhere in the headline and the new pattern has kushner\w*, so expect none; any id listed here is
  -- a member to look at in admin, and part (5) shows it as members_outside_pattern.
  missing := (SELECT array_agg(st.id ORDER BY st.id)
                FROM public.story_event se
                JOIN public.events e ON e.id = se.event_id
                JOIN public.stories st ON st.id = se.story_id
               WHERE e.slug = 'kushners-deals'
                 AND NOT (COALESCE(st.primary_headline, '') ~* k_agent
                          OR COALESCE(st.summary_neutral, '') ~* k_agent));
  IF missing IS NOT NULL THEN
    RAISE NOTICE 'kushners-deals members outside agent_pattern (review in admin): %', missing;
  END IF;

  -- Israel & Gaza: insert or verify
  v_exists := EXISTS (SELECT 1 FROM public.events WHERE slug = i_slug);
  IF v_exists THEN
    v_same := EXISTS (SELECT 1 FROM public.events WHERE slug = i_slug
                        AND name = i_name AND dek = i_dek AND tier = 'major' AND alarm_level = 4
                        AND lifecycle = 'open' AND publish_state = v_state AND started_at = i_start
                        AND sweep_pattern = i_sweep AND sweep_coword = i_coword
                        AND sweep_priority = i_prio AND sweep_summary = false
                        AND main_line_alarm_floor IS NULL AND agent_pattern = i_agent);
    IF NOT v_same THEN
      RAISE EXCEPTION 'front % already exists with different values; nothing changed', i_slug;
    END IF;
    RAISE NOTICE 'front % already present with identical values; nothing changed', i_slug;
  ELSE
    INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at,
                               started_at, created_by, sweep_pattern, sweep_coword, sweep_priority,
                               sweep_summary, main_line_alarm_floor, agent_pattern)
    VALUES (i_slug, i_name, i_dek, 4, 'major', 'open', v_state,
            CASE WHEN v_state = 'published' THEN NOW() END,
            i_start, 'human', i_sweep, i_coword, i_prio, false, NULL, i_agent);
    RAISE NOTICE 'INSERTED front %', i_slug;
  END IF;

  -- RFK Jr.'s HHS: insert or verify
  v_exists := EXISTS (SELECT 1 FROM public.events WHERE slug = r_slug);
  IF v_exists THEN
    v_same := EXISTS (SELECT 1 FROM public.events WHERE slug = r_slug
                        AND name = r_name AND dek = r_dek AND tier = 'major' AND alarm_level = 4
                        AND lifecycle = 'open' AND publish_state = v_state AND started_at = r_start
                        AND sweep_pattern = r_sweep AND sweep_coword = r_coword
                        AND sweep_priority = r_prio AND sweep_summary = false
                        AND main_line_alarm_floor IS NULL AND agent_pattern = r_agent);
    IF NOT v_same THEN
      RAISE EXCEPTION 'front % already exists with different values; nothing changed', r_slug;
    END IF;
    RAISE NOTICE 'front % already present with identical values; nothing changed', r_slug;
  ELSE
    INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at,
                               started_at, created_by, sweep_pattern, sweep_coword, sweep_priority,
                               sweep_summary, main_line_alarm_floor, agent_pattern)
    VALUES (r_slug, r_name, r_dek, 4, 'major', 'open', v_state,
            CASE WHEN v_state = 'published' THEN NOW() END,
            r_start, 'human', r_sweep, r_coword, r_prio, false, NULL, r_agent);
    RAISE NOTICE 'INSERTED front %', r_slug;
  END IF;
END $$;

-- (3) TARGETED SWEEP (full backfill for THESE three fronts only; the pipeline's own runs look back
-- 48 hours). Same rules as assign_fronts_sweep(NULL) (migration 115): every front's sweep competes
-- and the lowest priority number wins a story, but only stories won by one of the three slugs below
-- are filed. Stories another front wins are left alone, so the rollback below undoes all of it.
-- Never moves an assigned story. Expect israel-gaza and rfk-hhs > 0 (TEST: see part (5) note).
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
   WHERE b.slug IN ('kushners-deals', 'israel-gaza', 'rfk-hhs')
  ON CONFLICT (story_id) DO NOTHING
  RETURNING story_id, event_id
)
SELECT e.slug, COUNT(*) AS assigned
  FROM ins JOIN public.events e ON e.id = ins.event_id
 GROUP BY e.slug ORDER BY e.slug;

-- (4) REFRESH the main line (convention after any front or assignment change).
SELECT * FROM public.refresh_tracker_derived();

-- (5) RESULT. Expect 3 rows, published, members_outside_pattern 0.
SELECT e.id, e.slug, e.name, e.tier, e.alarm_level, e.publish_state, e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))         AS members_outside_pattern,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id AND st.main_line)                                  AS on_main_line,
       COALESCE((SELECT MAX(c.pool_size) FROM public.front_agent_candidates(e.slug, 1) c), 0) AS agent_pool
  FROM public.events e
 WHERE e.slug IN ('kushners-deals', 'israel-gaza', 'rfk-hhs')
 ORDER BY e.sweep_priority;

-- Tier change (one line each), e.g. Israel to flagship:
-- UPDATE public.events SET tier = 'flagship', alarm_level = 5, updated_at = NOW() WHERE slug = 'israel-gaza';
-- SELECT * FROM public.refresh_tracker_derived();

-- Rollback:
-- New fronts: deleting a front removes its story_event rows (ON DELETE CASCADE), so those stories
-- become loose ends again. Step (3) filed only these three fronts.
--   DELETE FROM public.events WHERE slug IN ('israel-gaza', 'rfk-hhs');
-- Envoys: restore the August 24, 2026 values, then remove the rows step (3) or later sweeps filed
-- that the old 'kushner' sweep would not have filed (headline without "kushner"):
--   UPDATE public.events SET name = 'Kushner''s Deals', tier = 'standard', alarm_level = 3,
--          dek = 'Sovereign wealth keeps landing with the son-in-law. Gulf money, withheld disclosures, and a family business that never stopped running.',
--          sweep_pattern = 'kushner', sweep_coword = NULL, agent_pattern = NULL, updated_at = NOW()
--    WHERE slug = 'kushners-deals';
--   DELETE FROM public.story_event se USING public.events e, public.stories st
--    WHERE se.event_id = e.id AND st.id = se.story_id AND e.slug = 'kushners-deals'
--      AND se.assigned_by = 'agent' AND st.primary_headline !~* 'kushner';
-- Then: SELECT * FROM public.refresh_tracker_derived();

-- ADO-592 - new front: Hegseth's Pentagon (slug hegseth-pentagon). Josh asked for it on
-- October 1, 2026 ("a huge one right now that is super shady and the reasoning not clear").
-- APPLIED ON TEST October 1, 2026 (PostgREST POST of the same row, then assign_fronts_sweep(NULL)
-- and refresh_tracker_derived()). PROD: Josh pastes this file in the PROD SQL Editor.
--
-- GOES LIVE IMMEDIATELY: the row is inserted as publish_state 'published', so the moment parts
-- (2) to (4) run, the front is public on trumpytracker.com and its members can reach the main line.
-- STILL OPEN (Josh): the title, the tier (major here; flagship is the alternative) and whether the
-- boat strikes belong on this front. Each is a one-line change after the fact:
--   UPDATE public.events SET name = '<new title>', updated_at = NOW() WHERE slug = 'hegseth-pentagon';
--   UPDATE public.events SET tier = 'flagship', updated_at = NOW() WHERE slug = 'hegseth-pentagon';
--   Boat strikes out: remove 'boat strikes?|drug boats?|' from sweep_pattern and agent_pattern
--   (UPDATE events), then move the already-filed boat strike stories in admin.
-- To hold it back until Josh decides, set v_state to 'draft' in part (2) before pasting (the sweep
-- still files stories into a draft front; publish later with
--   UPDATE public.events SET publish_state = 'published', published_at = NOW() WHERE slug = 'hegseth-pentagon';
-- then SELECT * FROM public.refresh_tracker_derived();).
--
-- WHAT BELONGS: what Hegseth and the Pentagon leadership do to and with the military, and the
-- fights over it: generals, admirals and military lawyers (JAGs) fired or pushed out, the
-- Caribbean boat strikes and the orders behind them, the Signal chat, press restrictions at the
-- Pentagon, investigations of critics (Sen. Mark Kelly's "illegal orders" video), the renaming to
-- the Department of War, and Congress forcing the Pentagon to disclose.
-- WHAT DOES NOT: the conduct of the Iran war stays on the Iran front (Iran's sweep priority 80
-- beats this front's 90, and stories already on Iran are never moved: the sweep only touches
-- unassigned stories). Ordinary foreign policy (Russia, Ukraine, NATO, China, Taiwan) stays a
-- loose end (negative co-word below). National Guard deployments to US cities are NOT in the
-- patterns: they are ordered by the White House, their court fights already go to The Courts,
-- and they recur like ICE raids (a separate shape, maybe a front of its own); a Guard story still
-- lands here when the headline names the Pentagon or Hegseth.
--
-- RUBRIC (PRD section 2): sustained (since February 21, 2025), accumulating (60+ TEST stories),
-- stakes (alarm 5 stories), unresolved, nameable = 5 of 5.
--
-- SWEEP (migration 115 conventions): headline only (sweep_summary false), priority 90 = loses to
-- every existing front on an overlap (lower wins; Iran is 80, the broadest so far). Co-word is a
-- negative lookahead, the same trick as Iran's '^(?!.*iranian revolution)'.
-- agent_pattern = sweep_pattern verbatim | extras (same shape and member gate as
-- 2026-10-01-ado-592-agent-patterns.sql): every sweep member matches it by construction.
--
-- TEST, October 1, 2026, before the apply: the sweep matched 62 unassigned active stories
-- (65 without the co-word); 0 of them also match the Iran sweep; 4 stories already on Iran match
-- this sweep and stay on Iran.
-- TEST apply, October 1, 2026 (9:43 PM CT): events id 15. assign_fronts_sweep(NULL) returned
-- hegseth-pentagon 62, iran 3 (three September 22-23 Iran stories the manual TEST pipeline had not
-- swept yet; unrelated to this front), _candidates 2991. refresh_tracker_derived(): 1 row changed.
-- Result: 62 members (13 enriched), 0 outside agent_pattern, 5 on the main line, agent pool 9.
--
-- Five pastes, in order: (1) pre-check, (2) DO block, (3) sweep, (4) refresh, (5) result.

-- (1) PRE-CHECK (read-only). Lists every front that has a sweep, lowest priority number first
-- (lower wins an overlap). Expect the 8 existing fronts with priorities 10 to 80 (iran last at 80)
-- and NO hegseth-pentagon row; on a re-run, hegseth-pentagon appears last at 90. If any other front
-- shows 90 or more, stop: this front would no longer lose every overlap.
SELECT id, slug, name, publish_state, sweep_priority FROM public.events
 WHERE sweep_pattern IS NOT NULL ORDER BY sweep_priority, id;

-- (2) INSERT the front. Idempotent on slug: an identical row is a NOTICE; a row with different
-- values raises (nothing changes).
DO $$
DECLARE
  v_slug    CONSTANT TEXT := 'hegseth-pentagon';
  v_name    CONSTANT TEXT := 'Hegseth''s Pentagon';
  v_dek     CONSTANT TEXT := 'The Pentagon remade around loyalty, with the reasons rarely given. Generals and military lawyers pushed out, boat strikes that killed survivors, reporters locked out, and a senator investigated for telling troops to refuse illegal orders.';
  v_alarm   CONSTANT SMALLINT := 5;
  v_tier    CONSTANT TEXT := 'major';
  v_state   CONSTANT TEXT := 'published';   -- 'draft' holds the front back (not public)
  v_started CONSTANT TIMESTAMPTZ := '2025-02-21T00:00:00+00:00';
  v_sweep   CONSTANT TEXT := '\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate)\M';
  v_coword  CONSTANT TEXT := '^(?!.*\m(russia|moscow|ukraine|nato|china|taiwan)\M)';
  v_prio    CONSTANT INTEGER := 90;
  v_agent   CONSTANT TEXT := '\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate)\M|\m(defense secretary|secretary of defense|defense department|admirals?|generals and admirals|four-star|three-star|top brass|military (leaders?|leadership|officers?|lawyers?|brass|commanders?|chaplains?|academies|academy)|judge advocates?|jag|illegal orders|signal chat|service members?|warrior ethos)\M';
  r public.events%ROWTYPE;
  missing BIGINT[];
BEGIN
  SELECT * INTO r FROM public.events WHERE slug = v_slug;
  IF FOUND THEN
    IF r.name IS DISTINCT FROM v_name OR r.dek IS DISTINCT FROM v_dek
       OR r.alarm_level IS DISTINCT FROM v_alarm OR r.tier IS DISTINCT FROM v_tier
       OR r.lifecycle IS DISTINCT FROM 'open' OR r.publish_state IS DISTINCT FROM v_state
       OR r.started_at IS DISTINCT FROM v_started
       OR r.sweep_pattern IS DISTINCT FROM v_sweep OR r.sweep_coword IS DISTINCT FROM v_coword
       OR r.sweep_priority IS DISTINCT FROM v_prio OR r.sweep_summary IS DISTINCT FROM false
       OR r.main_line_alarm_floor IS NOT NULL OR r.agent_pattern IS DISTINCT FROM v_agent THEN
      RAISE EXCEPTION 'front % already exists with different values (id %); nothing changed', v_slug, r.id;
    END IF;
    -- member gate, same as the 7-front file: every current member must match agent_pattern
    SELECT array_agg(st.id ORDER BY st.id) INTO missing
      FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
     WHERE se.event_id = r.id
       AND NOT (COALESCE(st.primary_headline, '') ~* v_agent OR COALESCE(st.summary_neutral, '') ~* v_agent);
    IF missing IS NOT NULL THEN
      RAISE NOTICE 'front % exists; members outside agent_pattern: %', v_slug, missing;
    ELSE
      RAISE NOTICE 'front % already present with identical values (id %); nothing changed', v_slug, r.id;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at,
                             started_at, created_by, sweep_pattern, sweep_coword, sweep_priority,
                             sweep_summary, main_line_alarm_floor, agent_pattern)
  VALUES (v_slug, v_name, v_dek, v_alarm, v_tier, 'open', v_state,
          CASE WHEN v_state = 'published' THEN NOW() END,
          v_started, 'human', v_sweep, v_coword, v_prio,
          false, NULL, v_agent);
  RAISE NOTICE 'INSERTED front %', v_slug;
END $$;

-- (3) SWEEP (full backfill; the pipeline's own runs only look back 48 hours, so older stories
-- need this once). It only fills stories with NO front yet, for every front, and never moves an
-- assigned story. Expect a hegseth-pentagon row (TEST: 62) plus '_candidates'.
SELECT * FROM public.assign_fronts_sweep(NULL);

-- (4) REFRESH the main line (convention after any front or assignment change).
SELECT * FROM public.refresh_tracker_derived();

-- (5) RESULT. Expect 1 row: published, members > 0, members_outside_pattern 0.
SELECT e.id, e.slug, e.name, e.publish_state, e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))         AS members_outside_pattern,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id AND st.main_line)                                  AS on_main_line,
       COALESCE((SELECT MAX(c.pool_size) FROM public.front_agent_candidates(e.slug, 1) c), 0) AS agent_pool
  FROM public.events e
 WHERE e.slug = 'hegseth-pentagon';

-- Rename (public title only; the slug stays):
-- UPDATE public.events SET name = '<new title>', updated_at = NOW() WHERE slug = 'hegseth-pentagon';

-- Rollback: deleting the front removes its story_event rows (ON DELETE CASCADE), so those
-- stories become loose ends again; then refresh the main line.
-- DELETE FROM public.events WHERE slug = 'hegseth-pentagon';
-- SELECT * FROM public.refresh_tracker_derived();

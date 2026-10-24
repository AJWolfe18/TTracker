-- ============================================================================
-- Migration 134: admin Fronts tab RPCs (ADO-547)
-- ============================================================================
-- WHY: running fronts (filing stories, moving them, tuning the keyword rules)
-- has been hand-written SQL. The admin Fronts tab (public/admin.html) and its
-- edge function (supabase/functions/admin-fronts) do it instead. Three jobs need
-- the database itself, so they are RPCs:
--   A) admin_assign_stories_to_front(ids[], event_id, move)
--        file many stories at once, one result per story. Each story is its own
--        step (insert, or lock the existing row and move it), so a race with the
--        sweep or the agent can never error the batch, and a move always writes
--        reassigned_at + reassigned_from_event_id together.
--   B) admin_unassign_stories(ids[], event_id)
--        take stories off ONE front (a stale screen can't remove a story that
--        was moved elsewhere meanwhile). Says per story whether the keyword
--        sweep would file it again, so the admin can warn.
--   C) admin_check_front_pattern(pattern)
--        compiles a regex with the same operator the sweep uses (~*), so a bad
--        pattern fails in the admin, not in the 2-hourly sweep.
--   D) admin_preview_front_rule(...)
--        how many recent active stories a sweep or agent rule would catch, with
--        a short newest-first sample. Read-only.
-- Saving a front's fields stays a plain PostgREST update in the edge function.
--
-- Every function: SECURITY DEFINER, search_path pinned, service_role only
-- (REVOKE FROM PUBLIC/anon/authenticated by name + argument count, the 095/096
-- pattern). Callers must run refresh_tracker_derived() after A or B (the edge
-- function does).
-- APPLY: paste into the Supabase SQL Editor (TEST, then PROD). Idempotent.
-- DEPENDENCIES: 111 (events, story_event), 115 (sweep_* columns), 116/127
-- (agent_pattern).
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.admin_assign_stories_to_front(BIGINT[], BIGINT, BOOLEAN);
--   DROP FUNCTION IF EXISTS public.admin_unassign_stories(BIGINT[], BIGINT);
--   DROP FUNCTION IF EXISTS public.admin_check_front_pattern(TEXT);
--   DROP FUNCTION IF EXISTS public.admin_preview_front_rule(TEXT, TEXT, BOOLEAN, TEXT, INTEGER, BIGINT);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) admin_assign_stories_to_front
-- ----------------------------------------------------------------------------
-- status per story:
--   assigned          new membership written (assigned_by = 'human')
--   moved             was on another front and p_move = true; reassign columns set
--   already_on_front  already on this front, nothing changed
--   on_other_front    on another front and p_move = false; nothing changed
--                     (from_event_id says which, so the admin can offer a move)
--   story_not_found   no such story
--   story_not_active  merged away / closed / archived; never filed
-- A move clears event_update_id: the composite FK (migration 111 PART H) only
-- allows an update link on the SAME front, and the old update belongs to the old
-- front. reassigned_from_event_id keeps the FIRST front a story was on before a
-- human moved it (PRD 7.3 precision: "the front the agent originally chose"), so
-- a second move does not overwrite it.
CREATE OR REPLACE FUNCTION public.admin_assign_stories_to_front(
  p_story_ids BIGINT[],
  p_event_id  BIGINT,
  p_move      BOOLEAN DEFAULT false
)
RETURNS TABLE (story_id BIGINT, status TEXT, from_event_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id       BIGINT;
  v_status   TEXT;
  v_merged   BIGINT;
  v_inserted INTEGER;
  v_cur      RECORD;
BEGIN
  IF p_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'front % not found', p_event_id USING ERRCODE = 'P0002';
  END IF;
  IF p_story_ids IS NULL OR cardinality(p_story_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_story_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 stories per call, got %', cardinality(p_story_ids) USING ERRCODE = '22023';
  END IF;

  -- every reference is table-qualified: the OUT columns are plpgsql variables (42702)
  FOR v_id IN SELECT DISTINCT u.sid FROM unnest(p_story_ids) AS u(sid) WHERE u.sid IS NOT NULL ORDER BY u.sid LOOP
    SELECT st.status, st.merged_into_story_id INTO v_status, v_merged
      FROM public.stories st WHERE st.id = v_id;
    IF NOT FOUND THEN
      story_id := v_id; status := 'story_not_found'; from_event_id := NULL; RETURN NEXT; CONTINUE;
    END IF;
    IF v_status IS DISTINCT FROM 'active' OR v_merged IS NOT NULL THEN
      story_id := v_id; status := 'story_not_active'; from_event_id := NULL; RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
    VALUES (v_id, p_event_id, 'human', NULL)
    ON CONFLICT ON CONSTRAINT story_event_pkey DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      story_id := v_id; status := 'assigned'; from_event_id := NULL; RETURN NEXT; CONTINUE;
    END IF;

    -- A row exists: lock it so a concurrent move/remove can't interleave.
    SELECT se.event_id, se.reassigned_at, se.reassigned_from_event_id INTO v_cur
      FROM public.story_event se WHERE se.story_id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      -- removed between our insert attempt and the lock: file it now
      INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
      VALUES (v_id, p_event_id, 'human', NULL)
      ON CONFLICT ON CONSTRAINT story_event_pkey DO NOTHING;
      story_id := v_id; status := 'assigned'; from_event_id := NULL; RETURN NEXT; CONTINUE;
    END IF;

    IF v_cur.event_id = p_event_id THEN
      story_id := v_id; status := 'already_on_front'; from_event_id := NULL; RETURN NEXT; CONTINUE;
    END IF;
    IF NOT COALESCE(p_move, false) THEN
      story_id := v_id; status := 'on_other_front'; from_event_id := v_cur.event_id; RETURN NEXT; CONTINUE;
    END IF;

    UPDATE public.story_event se
       SET event_id                 = p_event_id,
           event_update_id          = NULL,
           reassigned_at            = NOW(),
           reassigned_from_event_id = CASE WHEN v_cur.reassigned_at IS NULL
                                           THEN v_cur.event_id
                                           ELSE v_cur.reassigned_from_event_id END
     WHERE se.story_id = v_id;
    story_id := v_id; status := 'moved'; from_event_id := v_cur.event_id; RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.admin_assign_stories_to_front(BIGINT[], BIGINT, BOOLEAN) IS
  'ADO-547: admin Fronts tab. Files up to 200 stories on one front, one result row per story (assigned | moved | already_on_front | on_other_front | story_not_found | story_not_active). p_move = true moves stories that are on another front (sets reassigned_at, keeps the first reassigned_from_event_id, clears event_update_id). Caller runs refresh_tracker_derived() after. service_role only.';

-- ----------------------------------------------------------------------------
-- B) admin_unassign_stories
-- ----------------------------------------------------------------------------
-- Removes memberships of p_event_id only. sweep_would_refile = an active,
-- headlined story that the keyword sweep (assign_fronts_sweep, migration 115)
-- would file again into ANY front on its next run that sees it (the sweep looks
-- at stories touched in the last 48 hours, and at everything on a full backfill).
-- Same matching rule as the sweep, kept in step by the PGlite test.
CREATE OR REPLACE FUNCTION public.admin_unassign_stories(
  p_story_ids BIGINT[],
  p_event_id  BIGINT
)
RETURNS TABLE (story_id BIGINT, status TEXT, sweep_would_refile BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF p_story_ids IS NULL OR cardinality(p_story_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_story_ids) > 200 THEN
    RAISE EXCEPTION 'at most 200 stories per call, got %', cardinality(p_story_ids) USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH ids AS (
    SELECT DISTINCT u.sid FROM unnest(p_story_ids) AS u(sid) WHERE u.sid IS NOT NULL
  ), del AS (
    DELETE FROM public.story_event se
     USING ids
     WHERE se.story_id = ids.sid AND se.event_id = p_event_id
    RETURNING se.story_id
  )
  SELECT ids.sid,
         CASE WHEN d.story_id IS NOT NULL THEN 'removed' ELSE 'not_on_front' END,
         CASE WHEN d.story_id IS NULL THEN false ELSE EXISTS (
           SELECT 1
             FROM public.stories st
             JOIN public.events r
               ON r.sweep_pattern IS NOT NULL
              AND (r.sweep_coword IS NULL OR st.primary_headline ~* r.sweep_coword)
              AND (st.primary_headline ~* r.sweep_pattern
                   OR (r.sweep_summary AND r.sweep_coword IS NOT NULL
                       AND st.summary_neutral IS NOT NULL AND st.summary_neutral ~* r.sweep_pattern))
            WHERE st.id = ids.sid
              AND st.status = 'active'
              AND st.primary_headline IS NOT NULL
         ) END
    FROM ids
    LEFT JOIN del d ON d.story_id = ids.sid
   ORDER BY ids.sid;
END;
$$;

COMMENT ON FUNCTION public.admin_unassign_stories(BIGINT[], BIGINT) IS
  'ADO-547: admin Fronts tab. Removes up to 200 stories from ONE front (removed | not_on_front). sweep_would_refile = the keyword sweep would file the story again (any front) next time it sees it. Caller runs refresh_tracker_derived() after. service_role only.';

-- ----------------------------------------------------------------------------
-- C) admin_check_front_pattern: NULL = valid, else the Postgres error text
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_check_front_pattern(p_pattern TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF p_pattern IS NULL THEN
    RETURN NULL;
  END IF;
  v_ok := 'x' ~* p_pattern;   -- compiles the pattern exactly as the sweep and the agent pool do
  RETURN NULL;
EXCEPTION WHEN invalid_regular_expression OR program_limit_exceeded THEN
  RETURN SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.admin_check_front_pattern(TEXT) IS
  'ADO-547: returns NULL when p_pattern compiles as a case-insensitive Postgres regex (~*), else the error message. Used by the admin Fronts tab before saving sweep_pattern / sweep_coword / agent_pattern. service_role only.';

-- ----------------------------------------------------------------------------
-- D) admin_preview_front_rule: what a rule would catch in recent stories
-- ----------------------------------------------------------------------------
-- p_kind 'sweep': the migration-115 rule (coword on the headline gates; pattern
--                 on the headline, or on the summary when p_summary + coword).
-- p_kind 'agent': the migration-127 pool rule (pattern on headline OR summary).
-- Pool: active, enriched stories first seen in the last p_days (1-90).
-- Returns one row per sample story (newest first, at most 10) plus totals that
-- repeat on every row; a zero-match preview returns a single row with NULL
-- story fields so the counts still arrive.
CREATE OR REPLACE FUNCTION public.admin_preview_front_rule(
  p_pattern  TEXT,
  p_coword   TEXT    DEFAULT NULL,
  p_summary  BOOLEAN DEFAULT false,
  p_kind     TEXT    DEFAULT 'sweep',
  p_days     INTEGER DEFAULT 30,
  p_event_id BIGINT  DEFAULT NULL
)
RETURNS TABLE (
  total_matches    INTEGER,
  on_this_front    INTEGER,
  on_other_front   INTEGER,
  unassigned       INTEGER,
  sample_story_id  BIGINT,
  sample_headline  TEXT,
  sample_front     TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER := LEAST(GREATEST(COALESCE(p_days, 30), 1), 90);
BEGIN
  IF p_pattern IS NULL OR btrim(p_pattern) = '' THEN
    RAISE EXCEPTION 'pattern is required' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('sweep', 'agent') THEN
    RAISE EXCEPTION 'kind must be sweep or agent' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH pool AS MATERIALIZED (
    SELECT st.id, st.primary_headline AS h, st.summary_neutral AS s
      FROM public.stories st
     WHERE st.status = 'active'
       AND st.primary_headline IS NOT NULL
       AND st.summary_neutral IS NOT NULL
       AND st.first_seen_at >= NOW() - make_interval(days => v_days)
  ), hits AS (
    SELECT p.id, p.h, se.event_id
      FROM pool p
      LEFT JOIN public.story_event se ON se.story_id = p.id
     WHERE CASE WHEN p_kind = 'agent'
                THEN (p.h ~* p_pattern OR p.s ~* p_pattern)
                ELSE (p_coword IS NULL OR btrim(p_coword) = '' OR p.h ~* p_coword)
                     AND (p.h ~* p_pattern
                          OR (COALESCE(p_summary, false) AND p_coword IS NOT NULL AND btrim(p_coword) <> ''
                              AND p.s ~* p_pattern))
           END
  ), totals AS (
    SELECT COUNT(*)::integer AS n_all,
           (COUNT(*) FILTER (WHERE p_event_id IS NOT NULL AND hits.event_id = p_event_id))::integer AS n_this,
           (COUNT(*) FILTER (WHERE hits.event_id IS NOT NULL
                               AND hits.event_id IS DISTINCT FROM p_event_id))::integer AS n_other,
           (COUNT(*) FILTER (WHERE hits.event_id IS NULL))::integer AS n_none
      FROM hits
  ), sample AS (
    SELECT hits.id, hits.h, e.name AS front_name
      FROM hits
      LEFT JOIN public.events e ON e.id = hits.event_id
     ORDER BY hits.id DESC
     LIMIT 10
  )
  SELECT t.n_all, t.n_this, t.n_other, t.n_none, sm.id, sm.h, sm.front_name
    FROM totals t
    LEFT JOIN sample sm ON true
   ORDER BY sm.id DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.admin_preview_front_rule(TEXT, TEXT, BOOLEAN, TEXT, INTEGER, BIGINT) IS
  'ADO-547: read-only preview for the admin Fronts tab. Counts active enriched stories first seen in the last p_days (1-90) that a sweep rule (p_kind sweep: migration 115 matching) or an agent pattern (p_kind agent: migration 127 matching) would catch, split into on this front / on another front / unassigned, plus up to 10 newest sample headlines. service_role only.';

-- ----------------------------------------------------------------------------
-- Grants: service_role only (by name + argument count, the 095/096 pattern)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (
       (p.proname = 'admin_assign_stories_to_front' AND p.pronargs = 3) OR
       (p.proname = 'admin_unassign_stories'        AND p.pronargs = 2) OR
       (p.proname = 'admin_check_front_pattern'     AND p.pronargs = 1) OR
       (p.proname = 'admin_preview_front_rule'      AND p.pronargs = 6)
     )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification (read-only; run after applying)
-- ============================================================================
-- 1. Privileges: anon/authenticated f, service_role t for all four.
--    SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
--           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
--      FROM pg_proc p WHERE p.proname LIKE 'admin\_%front%' OR p.proname = 'admin_unassign_stories';
-- 2. SELECT public.admin_check_front_pattern('(ok|fine)');   -- NULL
--    SELECT public.admin_check_front_pattern('(broken');     -- error text
-- 3. SELECT * FROM public.admin_preview_front_rule('epstein', NULL, false, 'sweep', 30,
--      (SELECT id FROM public.events WHERE slug = 'epstein-files'));

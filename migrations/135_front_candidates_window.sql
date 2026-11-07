-- ============================================================================
-- 135: front_agent_candidates_all gets a recency window (ADO-592)
-- WHY: on PROD the RPC regex-scans ~16,700 active stories and hit the API's
--   statement timeout (57014) on every run from October 25 to November 2, so
--   the all-fronts agent judged nothing. Default window: stories new or changed in the
--   last 30 days. p_days => NULL = no window (TEST only; times out on PROD).
--   Newest change first, so an old story with new articles is judged early. The existing agent call {p_limit} keeps working unchanged.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD).
--   The DROP triggers a "destructive operation" prompt: confirm Run.
--   Idempotent. On any error run ROLLBACK; alone before retrying.
-- EXPECT: last result, first column candidates_fn = 1; ms well under 5000.
-- ROLLBACK: BEGIN; DROP FUNCTION public.front_agent_candidates_all(integer, integer);
--   then paste 127 PART C (CREATE ... through GRANT, not its COMMIT); COMMIT;
-- ============================================================================

BEGIN;

-- The old one-argument version and this one cannot both exist: PostgREST
-- would refuse a {p_limit} call as ambiguous (PGRST203).
DROP FUNCTION IF EXISTS public.front_agent_candidates_all(integer);
DROP FUNCTION IF EXISTS public.front_agent_candidates_all(integer, integer);

-- Same body as 127 PART C plus the window in the cheap first pass, so the
-- regexes only run on recent stories.
CREATE FUNCTION public.front_agent_candidates_all(
  p_limit INTEGER DEFAULT 25,
  p_days  INTEGER DEFAULT 30
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
       AND (p_days IS NULL                                -- 135: recency window
            OR COALESCE(st.last_updated_at, st.first_seen_at)
               >= now() - make_interval(days => GREATEST(p_days, 1)))
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
   ORDER BY COALESCE(st.last_updated_at, st.first_seen_at) DESC, st.id DESC  -- 135: matches the window
   LIMIT GREATEST(COALESCE(p_limit, 25), 1);
$$;

COMMENT ON FUNCTION public.front_agent_candidates_all(INTEGER, INTEGER) IS
  'ADO-592: candidate pool for the all-fronts assignment agent - active enriched stories, not labeled coverage, with no story_event row, new or changed in the last p_days days (default 30; NULL = no window, migration 135), whose headline or summary_neutral matches the agent_pattern of at least one agent front (published, agent_pattern and agent_definition set). Declines (pipeline_skips front_assignment/agent_declined) since the story last changed hide it per front: metadata.front = none from each front in metadata.judged_fronts, metadata.front = <slug> (ADO-582) from that front only. Newest first; pool_size = total before LIMIT. service_role only. Prompt: docs/features/fronts-claude-agent/prompt-v1.md';

REVOKE ALL ON FUNCTION public.front_agent_candidates_all(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.front_agent_candidates_all(INTEGER, INTEGER) TO service_role;

-- Enforce: exactly one version, service_role only, and fast enough for the API
-- (PostgREST cancels at about 8 s; this fails the whole paste above 5 s).
DO $$
DECLARE
  v_fns int := (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'front_agent_candidates_all');
  v_t0  timestamptz;
  v_n   int;
  v_ms  numeric;
BEGIN
  IF v_fns <> 1 THEN
    RAISE EXCEPTION '135: expected 1 front_agent_candidates_all, found %', v_fns;
  END IF;
  IF has_function_privilege('anon', 'public.front_agent_candidates_all(integer, integer)', 'execute')
     OR has_function_privilege('authenticated', 'public.front_agent_candidates_all(integer, integer)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.front_agent_candidates_all(integer, integer)', 'execute') THEN
    RAISE EXCEPTION '135: grants are wrong (service_role only)';
  END IF;
  v_t0 := clock_timestamp();
  v_n  := (SELECT count(*) FROM public.front_agent_candidates_all(25));
  v_ms := round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  IF v_ms > 5000 THEN
    RAISE EXCEPTION '135: the 30-day pool still takes % ms (limit 5000); nothing applied', v_ms;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';  -- the API sees the new signature right away

COMMIT;

-- Read-only check. Expect candidates_fn = 1, pool_30d = the stories the agent
-- will judge (it takes 80 a run), ms = upper bound (the editor sends the
-- whole file at once, so it includes the steps above).
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'front_agent_candidates_all') AS candidates_fn,
  COALESCE(max(c.pool_size), 0)                                              AS pool_30d,
  count(*)                                                                   AS page_rows,
  round(extract(epoch FROM clock_timestamp() - statement_timestamp()) * 1000) AS ms
FROM public.front_agent_candidates_all(25) c;

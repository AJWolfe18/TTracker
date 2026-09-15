-- ============================================================================
-- Migration 116: election front assignment agent - candidate pool + audit note
-- ADO-582 (ADO-581 session 2). September 15, 2026.
-- ============================================================================
-- WHY: the migration-115 regex sweep is bounded by its pattern, and redistricting
-- was deliberately left OUT of that pattern on September 14, 2026 (125 of 357
-- alarm-3+ PROD matches were map fights that would have swamped the main line
-- under the floor-3 rule). A Claude cloud agent now judges the stories the regex
-- cannot: state action that changes who can vote, how votes are counted, who
-- certifies, or district maps -> assign; horse-race / commentary / history ->
-- decline. Prompt: docs/features/fronts-claude-agent/prompt-v1.md
--
-- WHAT:
--   A) events.agent_pattern      the agent's candidate regex is DATA, one row
--                                per front (same idea as sweep_pattern). NULL =
--                                no agent runs for that front. Tune with UPDATE.
--   B) story_event.note          one-line agent rationale (audit trail for the
--                                spot-check and for Josh). Hidden from anon via
--                                a column-level grant, same as tracker_pin.note.
--   C) front_agent_candidates()  the pool: active, enriched stories with NO
--                                story_event row whose headline OR summary
--                                matches agent_pattern, minus stories the agent
--                                already declined since their last update
--                                (pipeline_skips front_assignment/agent_declined).
--                                Each call is a page; decisions leave records, so
--                                "call until empty" needs no OFFSET.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS / OR REPLACE / re-issued grants.
-- Re-running PART D resets election-suppression.agent_pattern to the seed.
-- DEPENDENCIES: 111 (events/story_event), 115 (sweep columns), pipeline_skips
-- (supabase/migrations/20260412000000_pipeline_skips.sql).
-- Deploy order (cloud-agent rule): this migration lands on an environment BEFORE
-- the prompt that calls the RPC merges to that environment's branch.
-- ============================================================================

-- ============================================================================
-- PART A: events.agent_pattern
-- ============================================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS agent_pattern TEXT;

COMMENT ON COLUMN public.events.agent_pattern IS
  'ADO-582: case-insensitive regex; a story whose headline OR summary_neutral matches is a candidate for the front assignment agent (front_agent_candidates). Deliberately broader than sweep_pattern - the agent applies judgment, the regex only bounds the pool. NULL = no agent pass for this front. Tune with UPDATE, not a migration.';

-- ============================================================================
-- PART B: story_event.note + column-level anon grant
-- ============================================================================
ALTER TABLE public.story_event
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN public.story_event.note IS
  'ADO-582: one-line rationale written by the assignment agent (prompt version + why it qualifies). Admin audit trail only; not anon-readable (column-level grant below). NULL for sweep and hand assignments.';

-- Migration 111 granted table-wide SELECT to anon. Converge to columns-only so
-- the note stays admin-side (same shape as migration 112's tracker_pin.note).
-- Nothing anon-facing selects story_event directly (views v_event_stats /
-- v_tracker_stories read story_id + event_id only; verified September 15, 2026).
REVOKE SELECT ON public.story_event FROM anon;
GRANT SELECT (story_id, event_id, event_update_id, assigned_by, confidence,
              assigned_at, reassigned_at, reassigned_from_event_id)
  ON public.story_event TO anon;
GRANT ALL ON public.story_event TO service_role;

-- ============================================================================
-- PART C: front_agent_candidates(p_slug, p_limit)
-- ============================================================================
-- pool_size repeats on every row (COUNT(*) OVER () is evaluated before LIMIT)
-- so a caller can log "judged 25 of 140" without a second query.
-- Every column reference is table-qualified: RETURNS TABLE names are plpgsql
-- variables and a bare name is ambiguous (42702, learned on migration 115).
CREATE OR REPLACE FUNCTION public.front_agent_candidates(
  p_slug  TEXT,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  story_id         BIGINT,
  event_id         BIGINT,
  primary_headline TEXT,
  summary_neutral  TEXT,
  alarm_level      INTEGER,
  category         TEXT,
  first_seen_at    TIMESTAMPTZ,
  last_updated_at  TIMESTAMPTZ,
  pool_size        INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT st.id,
         e.id,
         st.primary_headline,
         st.summary_neutral,
         st.alarm_level::integer,
         st.category::text,
         st.first_seen_at,
         st.last_updated_at,
         COUNT(*) OVER ()::integer
    FROM public.events e
    JOIN public.stories st
      ON st.status = 'active'
     AND st.primary_headline IS NOT NULL
     AND st.summary_neutral IS NOT NULL          -- the publish gate: unenriched stories are invisible anyway
     AND (st.primary_headline ~* e.agent_pattern
          OR st.summary_neutral ~* e.agent_pattern)
   WHERE e.slug = p_slug
     AND e.agent_pattern IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
     AND NOT EXISTS (
           -- declined by the agent since the story last changed -> not re-judged
           SELECT 1 FROM public.pipeline_skips ps
            WHERE ps.pipeline    = 'front_assignment'
              AND ps.reason      = 'agent_declined'
              AND ps.entity_type = 'story'
              AND ps.entity_id   = st.id::text
              AND ps.metadata->>'front' = p_slug
              AND ps.created_at >= COALESCE(st.last_updated_at, st.first_seen_at))
   ORDER BY st.first_seen_at DESC, st.id DESC
   LIMIT GREATEST(COALESCE(p_limit, 25), 1);
$$;

COMMENT ON FUNCTION public.front_agent_candidates(TEXT, INTEGER) IS
  'ADO-582: candidate pool for the front assignment agent - active enriched stories with no story_event row whose headline or summary_neutral matches events.agent_pattern for p_slug, excluding stories the agent declined (pipeline_skips front_assignment/agent_declined, metadata.front = slug) since their last update. Newest first; pool_size = total before LIMIT. service_role only. Prompt: docs/features/fronts-claude-agent/prompt-v1.md';

REVOKE ALL ON FUNCTION public.front_agent_candidates(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.front_agent_candidates(TEXT, INTEGER) TO service_role;

-- ============================================================================
-- PART D: seed - Election Suppression agent pattern
-- ============================================================================
-- The ADO-581 co-word list plus the redistricting terms Josh pulled out of the
-- sweep on September 14, 2026. Word-bounded (\m \M) so "poll" does not match
-- "pollution"; plural/derived forms listed explicitly. Broad on purpose: the
-- agent declines the noise, the regex only keeps the pool finite.
UPDATE public.events
   SET agent_pattern = '\m(elections?|electoral|votes?|voters?|voting|ballots?|midterms?|polls?|polling|pollsters?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|voting rights|certif(y|ies|ied|ying|ication))\M'
 WHERE slug = 'election-suppression';

-- Idempotency check (should be a single row with agent_pattern set):
-- SELECT slug, agent_pattern IS NOT NULL AS has_agent_pattern FROM public.events WHERE slug = 'election-suppression';

-- Migration: 101_clustering_judge_hardening.sql
-- Purpose: Session-2 hardening of the Clustering Judge merge machinery (ADO-533), before live auto-merge.
--   Migration 100 is already applied to TEST and PROD; it is immutable. This migration layers three fixes:
--
--   A) P1 (Codex, PR #106) — exclude merged tombstones from ANN clustering candidates.
--      merge_stories tombstones a loser with status='merged_into', but the live RSS clustering candidate
--      paths gate on lifecycle_state (NOT status) and never check merged_into_story_id. So a future article
--      similar to the tombstoned loser could re-attach to the hidden tombstone instead of the survivor,
--      silently re-corrupting the cluster the merge just repaired. Here we fix the RPC path
--      (find_similar_stories, migration 026); the three PostgREST candidate blocks (time/entity/slug) are
--      fixed in scripts/rss/candidate-generation.js in the same PR.
--
--   B) P2 (Codex, PR #106) — recompute survivor recency + carry loser slugs on merge.
--      merge_stories recomputed centroid/entities but left latest_article_published_at (the candidate
--      generator's time-block gate) and topic_slugs (the slug block) stale. If the loser held the newest
--      article or unique slugs, the survivor could be missed by future attachments that should have matched
--      the loser side. We now recompute latest_article_published_at = MAX(member article published_at) and
--      union the loser's topic_slugs into the survivor. (topic_slugs stays owned by the enrichment agent;
--      this union is a clustering bridge until the survivor re-enriches within ~12h.)
--
--   C) Hard merge cap (defense-in-depth) — the per-run cap of 10 is otherwise prompt-enforced only
--      (LLM-honored). This adds a DB-side guard so a run can never execute more than 10 merges even if the
--      agent ignores the prompt. merge_stories gains p_run_id; a small judge_run_merge_count table tracks
--      executed merges per run and the RPC refuses once the run hits the cap.
--
--   D) Reversibility (review finding) — merge_stories hard-deletes the loser's article_story links, after
--      which nothing records which articles came from the loser. story_merge_audit snapshots the loser's
--      article ids (pre-repoint) so a WRONG merge caught in the 3-day monitoring window can be un-merged.
--
-- Applied to TEST first (Supabase SQL Editor / MCP), then PROD, before enabling the live cron.
-- SECURITY: merge_stories stays SECURITY DEFINER + locked search_path, EXECUTE service_role-only
-- (migration 095/096 pattern). find_similar_stories keeps its existing grants (service_role, authenticated)
-- across CREATE OR REPLACE.

-- ============================================================================
-- PART A: find_similar_stories — exclude merged tombstones (P1)
-- ============================================================================
-- Re-declares the CURRENT live definition (migration 048: 11-column return incl. first_seen_at +
-- latest_article_published_at; migration 052: locked search_path; migration 023/048 grants:
-- anon, authenticated, service_role) with a SINGLE added predicate:  AND s.merged_into_story_id IS NULL
--
-- DROP first: Postgres cannot change a RETURNS TABLE via CREATE OR REPLACE (the project hit this in
-- migrations 027/048 and dropped first). We keep the exact 048 return shape so the ANN caller
-- (candidate-generation.js / hybrid-clustering.js) still receives first_seen_at + latest_article_published_at,
-- and re-apply the 052 search_path lock + the 048 grants so nothing regresses.

DROP FUNCTION IF EXISTS public.find_similar_stories(vector, integer, double precision);

CREATE FUNCTION public.find_similar_stories(
  query_embedding vector(1536),
  match_limit int DEFAULT 60,
  min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  id bigint,
  primary_headline text,
  entity_counter jsonb,
  top_entities text[],
  topic_slugs text[],
  last_updated_at timestamptz,
  first_seen_at timestamptz,
  latest_article_published_at timestamptz,
  primary_source_domain text,
  lifecycle_state text,
  similarity double precision
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT
    s.id,
    s.primary_headline,
    s.entity_counter,
    s.top_entities,
    s.topic_slugs,
    s.last_updated_at,
    s.first_seen_at,
    s.latest_article_published_at,
    s.primary_source_domain,
    s.lifecycle_state,
    1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.centroid_embedding_v1 IS NOT NULL
    AND s.lifecycle_state IN ('emerging','growing','stable','stale')
    AND s.merged_into_story_id IS NULL   -- ADO-533 P1: never attach to a tombstoned loser
    AND (1 - (s.centroid_embedding_v1 <=> query_embedding)) >= min_similarity
  ORDER BY similarity DESC
  LIMIT GREATEST(1, COALESCE(match_limit, 60));
$$;

COMMENT ON FUNCTION public.find_similar_stories(vector, integer, double precision) IS
'ANN search for story clustering. TTRC-319: no centroid in return (egress). TTRC-326: latest_article_published_at for recency. ADO-533: excludes merged tombstones (merged_into_story_id IS NULL) so a new article cannot attach to a merged-away loser.';

-- Restore grants (matching migration 048).
GRANT EXECUTE ON FUNCTION public.find_similar_stories(vector, integer, double precision)
  TO anon, authenticated, service_role;

-- ============================================================================
-- PART B: judge_run_merge_count — per-run executed-merge counter (hard cap)
-- ============================================================================

CREATE TABLE IF NOT EXISTS judge_run_merge_count (
  run_id      TEXT PRIMARY KEY,
  merge_count INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE judge_run_merge_count IS
  'ADO-533: DB-side hard cap for the Clustering Judge. One row per run_id counting executed merges; merge_stories refuses once a run reaches the cap (defense-in-depth vs a misbehaving LLM ignoring the prompt cap).';

ALTER TABLE judge_run_merge_count ENABLE ROW LEVEL SECURITY;  -- service_role bypasses; no anon/authenticated grant

-- Loser-membership snapshot so a WRONG merge can be cleanly un-merged during the monitoring window.
-- merge_stories repoints + hard-deletes the loser's article_story links, after which nothing records
-- which article_ids came from the loser. This captures them (pre-repoint) + the survivor's own prior
-- members, making an un-merge mechanical (repoint the snapshot back, re-tombstone-clear the loser).
CREATE TABLE IF NOT EXISTS story_merge_audit (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merged_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id             TEXT,
  loser_id           BIGINT NOT NULL,
  survivor_id        BIGINT NOT NULL,
  loser_article_ids  TEXT[] NOT NULL DEFAULT ARRAY[]::text[]   -- articles.id is TEXT (art-<uuid>)
);

CREATE INDEX IF NOT EXISTS idx_story_merge_audit_loser ON story_merge_audit (loser_id);
CREATE INDEX IF NOT EXISTS idx_story_merge_audit_merged_at ON story_merge_audit (merged_at DESC);

COMMENT ON TABLE story_merge_audit IS
  'ADO-533: pre-merge snapshot of a loser story''s article_story membership so a wrong merge can be reversed. Written by merge_stories before repointing.';

ALTER TABLE story_merge_audit ENABLE ROW LEVEL SECURITY;  -- service_role bypasses; no anon/authenticated grant

-- ============================================================================
-- PART C: merge_stories — recompute recency/slugs (P2) + hard cap (p_run_id)
-- ============================================================================
-- Drop the 2-arg version from migration 100 and re-create with a 3rd optional p_run_id argument.
-- (CREATE OR REPLACE cannot change arity — it would create an overload — so DROP then CREATE. Nothing
-- depends on the function, so the DROP is safe.)

DROP FUNCTION IF EXISTS public.merge_stories(BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.merge_stories(
  p_loser_id    BIGINT,
  p_survivor_id BIGINT,
  p_run_id      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_merge_cap CONSTANT INT := 10;   -- hard per-run cap (matches prompt cap)
  v_run_count INT;
  v_loser_status      TEXT;
  v_loser_merged      BIGINT;
  v_loser_first_seen  TIMESTAMPTZ;
  v_loser_last_upd    TIMESTAMPTZ;
  v_surv_status       TEXT;
  v_surv_merged       BIGINT;
  v_loser_article_ids TEXT[];
  v_moved   INT := 0;
  v_new_count INT := 0;
BEGIN
  -- 1. Validate
  IF p_loser_id IS NULL OR p_survivor_id IS NULL OR p_loser_id = p_survivor_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ids');
  END IF;

  -- 1b. Hard per-run merge cap (defense-in-depth). Only enforced when a run_id is supplied.
  IF p_run_id IS NOT NULL THEN
    SELECT merge_count INTO v_run_count FROM judge_run_merge_count WHERE run_id = p_run_id;
    IF COALESCE(v_run_count, 0) >= v_merge_cap THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'run_merge_cap_reached',
                                'cap', v_merge_cap, 'run_id', p_run_id);
    END IF;
  END IF;

  SELECT status, merged_into_story_id, first_seen_at, last_updated_at
    INTO v_loser_status, v_loser_merged, v_loser_first_seen, v_loser_last_upd
    FROM stories WHERE id = p_loser_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'loser_not_found');
  END IF;

  SELECT status, merged_into_story_id
    INTO v_surv_status, v_surv_merged
    FROM stories WHERE id = p_survivor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_not_found');
  END IF;

  -- Already merged (idempotent no-op) — do not double-merge or reopen a tombstone.
  IF v_loser_status = 'merged_into' OR v_loser_merged IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'loser_already_merged',
                              'survivor_id', v_loser_merged);
  END IF;
  IF v_surv_status = 'merged_into' OR v_surv_merged IS NOT NULL THEN
    -- Refuse to merge into a tombstone; caller should target the ultimate survivor.
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_is_merged',
                              'survivor_points_to', v_surv_merged);
  END IF;

  -- 1c. Snapshot the loser's article membership BEFORE repointing, so a wrong merge is reversible.
  SELECT COALESCE(ARRAY_AGG(article_id), ARRAY[]::text[])
    INTO v_loser_article_ids
    FROM article_story WHERE story_id = p_loser_id;
  INSERT INTO story_merge_audit (run_id, loser_id, survivor_id, loser_article_ids)
  VALUES (p_run_id, p_loser_id, p_survivor_id, v_loser_article_ids);

  -- 2. Repoint article_story loser -> survivor.
  UPDATE article_story a
  SET story_id = p_survivor_id
  WHERE a.story_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM article_story b
      WHERE b.story_id = p_survivor_id AND b.article_id = a.article_id
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Drop any loser links that couldn't move (article already on survivor).
  DELETE FROM article_story WHERE story_id = p_loser_id;

  -- 3 + 4 + P2. Recompute survivor centroid + entity_counter + top_entities + latest_article_published_at
  -- from its (now-merged) members; widen time span; union the loser's topic_slugs (clustering bridge).
  WITH sa AS (
    SELECT a.embedding_v1, a.published_at
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    WHERE asg.story_id = p_survivor_id
  ),
  ctr AS (
    SELECT AVG(embedding_v1) AS exact_centroid
    FROM sa WHERE embedding_v1 IS NOT NULL
  ),
  recency AS (
    SELECT MAX(published_at) AS max_pub FROM sa
  ),
  ent_counts AS (
    SELECT (ent->>'id') AS entity_id, COUNT(*)::int AS cnt
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.entities, '[]'::jsonb)) ent
    WHERE asg.story_id = p_survivor_id
      AND (ent->>'id') IS NOT NULL AND (ent->>'id') <> ''
    GROUP BY (ent->>'id')
  ),
  counter AS (
    SELECT
      COALESCE(jsonb_object_agg(entity_id, cnt), '{}'::jsonb) AS counter_json,
      COALESCE(ARRAY(
        SELECT entity_id FROM ent_counts
        ORDER BY cnt DESC, entity_id ASC
        LIMIT 5
      ), ARRAY[]::text[]) AS top5
    FROM ent_counts
  ),
  -- Union survivor + loser topic_slugs (dedup, drop NULLs) so the slug candidate block still matches
  -- future articles that would have hit the loser's unique slugs. ADO-533 P2.
  slugs AS (
    SELECT COALESCE(ARRAY(
      SELECT DISTINCT sl FROM (
        SELECT unnest(COALESCE((SELECT topic_slugs FROM stories WHERE id = p_survivor_id), ARRAY[]::text[])) AS sl
        UNION
        SELECT unnest(COALESCE((SELECT topic_slugs FROM stories WHERE id = p_loser_id), ARRAY[]::text[])) AS sl
      ) u
      WHERE sl IS NOT NULL AND sl <> ''
    ), ARRAY[]::text[]) AS merged_slugs
  )
  UPDATE stories s
  SET centroid_embedding_v1      = COALESCE((SELECT exact_centroid FROM ctr), s.centroid_embedding_v1),
      entity_counter             = (SELECT counter_json FROM counter),
      top_entities               = (SELECT top5 FROM counter),
      topic_slugs                = (SELECT merged_slugs FROM slugs),
      latest_article_published_at = COALESCE((SELECT max_pub FROM recency), s.latest_article_published_at),
      first_seen_at              = LEAST(s.first_seen_at, v_loser_first_seen),
      last_updated_at            = GREATEST(s.last_updated_at, v_loser_last_upd)
  WHERE s.id = p_survivor_id;

  -- 5. Recount source_count from actual member rows.
  SELECT COUNT(*)::int INTO v_new_count FROM article_story WHERE story_id = p_survivor_id;
  UPDATE stories SET source_count = v_new_count WHERE id = p_survivor_id;

  -- 6. Tombstone the loser (redirect, never delete).
  UPDATE stories
  SET status = 'merged_into',
      merged_into_story_id = p_survivor_id
  WHERE id = p_loser_id;

  -- 7. Record the executed merge against the run cap (only after a successful merge).
  IF p_run_id IS NOT NULL THEN
    INSERT INTO judge_run_merge_count (run_id, merge_count, updated_at)
    VALUES (p_run_id, 1, NOW())
    ON CONFLICT (run_id)
    DO UPDATE SET merge_count = judge_run_merge_count.merge_count + 1, updated_at = NOW();
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'loser_id', p_loser_id,
    'survivor_id', p_survivor_id,
    'articles_moved', v_moved,
    'survivor_source_count', v_new_count
  );
END;
$$;

COMMENT ON FUNCTION public.merge_stories(BIGINT, BIGINT, TEXT) IS
  'ADO-533: merge loser story into survivor. Repoints article_story, recomputes survivor centroid/entity_counter/top_entities/latest_article_published_at/source_count server-side, unions topic_slugs, widens time span, tombstones loser (status=merged_into + merged_into_story_id). Optional p_run_id enforces a DB-side hard cap of 10 executed merges/run. Atomic, idempotent, never deletes. service_role only.';

-- ============================================================================
-- PART D: Security lockdown for the re-created merge_stories (migration 095/096 pattern)
-- ============================================================================
-- find_similar_stories keeps its grants across CREATE OR REPLACE (not re-locked here). Only the newly
-- re-created merge_stories(BIGINT,BIGINT,TEXT) needs its default PUBLIC/anon/authenticated EXECUTE revoked.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'merge_stories'
      AND p.pronargs = 3
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) find_similar_stories now excludes tombstones (expect the predicate in the body):
--    SELECT pg_get_functiondef('find_similar_stories(vector,int,double precision)'::regprocedure) LIKE '%merged_into_story_id IS NULL%';
-- 2) merge_stories is now the 3-arg version, locked down (expect anon=f, authenticated=f, service_role=t):
--    SELECT p.pronargs,
--           has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--           has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='merge_stories';
--    -- Expect exactly ONE row with pronargs=3 (the 2-arg version is dropped).
-- 3) Cap + audit tables exist:
--    SELECT to_regclass('public.judge_run_merge_count'), to_regclass('public.story_merge_audit');
-- 4) find_similar_stories still returns 11 columns incl. first_seen_at + latest_article_published_at
--    (regression guard for the ANN caller) and has search_path locked:
--    SELECT pg_get_function_result('find_similar_stories(vector,int,double precision)'::regprocedure);
--    SELECT proconfig FROM pg_proc WHERE proname='find_similar_stories';  -- expect {search_path=...}

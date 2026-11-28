-- ============================================================================
-- 140: the clustering ANN search finally uses its HNSW index (ADO-635)
-- WHY: find_similar_stories (migration 101) never used the HNSW index
--   ix_stories_centroid_emb_v1_hnsw, so every call scanned all ~19,600 story
--   centroids: 2.2 s average on PROD, and "ANN block error: statement timeout"
--   up to 6 times per RSS run. Two causes:
--   1. It sorted by `similarity DESC`. pgvector can only walk an HNSW index for
--      `ORDER BY <column> <=> <query>` ascending.
--   2. Its LIMIT is a parameter. A LANGUAGE sql function is planned without
--      knowing the value, the planner guesses 10% of the table, and a sort
--      wins (EXPLAIN (GENERIC_PLAN) on TEST: seq scan + sort; with LIMIT 60:
--      index scan).
-- FIX:
--   - ORDER BY distance ascending (the same order as similarity descending).
--   - plpgsql with plan_cache_mode = force_custom_plan, so each call is
--     planned with its real match_limit.
--   - min_similarity is applied after the LIMIT. Rows arrive nearest first,
--     so the result is the same, but a high threshold (check-fragmentation
--     uses 0.85) can no longer make the index walk the whole table.
--   - hnsw.ef_search = 200: candidates looked at per search (the default 40
--     is below match_limit 60 and would return fewer rows).
--   - hnsw.iterative_scan = strict_order (pgvector 0.8.0, on TEST and PROD):
--     when the lifecycle/merged filters drop rows, the index keeps scanning
--     instead of returning a short list, in exact distance order.
--   The settings sit on the function, not the database, so no other query
--   changes. HNSW is approximate; measured recall is on ADO-635.
--   - EXECUTE is revoked from anon and authenticated: only service-role
--     scripts call it, and a public vector search costs database time.
-- SAME: signature, return columns, filters, STABLE, search_path lock.
--   Callers need no change.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD).
--   Any time: it only replaces one function. Idempotent. On any error run
--   ROLLBACK; alone before retrying.
-- EXPECT: last result, one row: is_plpgsql = true, uses_distance_order = true,
--   has_custom_plan = true, has_ef_search = true, has_iterative_scan = true,
--   anon_can_call = false, service_can_call = true.
-- ROLLBACK: re-run migration 101 PART A (its DROP + CREATE FUNCTION
--   find_similar_stories through its GRANT), which also clears the settings
--   and restores the anon grant.
-- ============================================================================

BEGIN;

-- Load pgvector's library in this session first. Until it is loaded, the
-- hnsw.* settings below are unknown names and CREATE FUNCTION fails with
-- "permission denied to set parameter" (seen on TEST, November 28, 2026).
SELECT '[1]'::vector IS NOT NULL AS pgvector_loaded;

CREATE OR REPLACE FUNCTION public.find_similar_stories(
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
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, extensions
SET plan_cache_mode = force_custom_plan
SET hnsw.ef_search = 200
SET hnsw.iterative_scan = strict_order
AS $$
BEGIN
  RETURN QUERY
  SELECT nearest.*
  FROM (
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
    ORDER BY s.centroid_embedding_v1 <=> query_embedding   -- ascending distance: walks the HNSW index
    LIMIT GREATEST(1, COALESCE(match_limit, 60))
  ) AS nearest
  WHERE nearest.similarity >= min_similarity
  ORDER BY nearest.similarity DESC;
END;
$$;

COMMENT ON FUNCTION public.find_similar_stories(vector, integer, double precision) IS
'ANN search for story clustering, walking ix_stories_centroid_emb_v1_hnsw (ADO-635: ORDER BY distance ascending, custom plans, ef_search 200, strict iterative scan, threshold after the LIMIT). Service role only. TTRC-319: no centroid in return (egress). TTRC-326: latest_article_published_at for recency. ADO-533: excludes merged tombstones.';

REVOKE EXECUTE ON FUNCTION public.find_similar_stories(vector, integer, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_stories(vector, integer, double precision)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify: plpgsql, ordered by distance, all three settings on the function, service role only.
SELECT
  l.lanname = 'plpgsql' AS is_plpgsql,
  position('ORDER BY s.centroid_embedding_v1 <=> query_embedding' in pg_get_functiondef(p.oid)) > 0 AS uses_distance_order,
  coalesce('plan_cache_mode=force_custom_plan' = ANY (p.proconfig), false) AS has_custom_plan,
  coalesce('hnsw.ef_search=200' = ANY (p.proconfig), false) AS has_ef_search,
  coalesce('hnsw.iterative_scan=strict_order' = ANY (p.proconfig), false) AS has_iterative_scan,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_call,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_call
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid = 'public.find_similar_stories(vector, integer, double precision)'::regprocedure;

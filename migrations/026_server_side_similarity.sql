-- Migration 026: Server-side similarity for egress optimization (TTRC-319)
--
-- Problem: Fetching centroid_embedding_v1 (14KB each) for 330 candidates/article
--          causes ~5MB egress per article clustered = 200GB/month at PROD scale
--
-- Solution: Compute similarity server-side, return only float values
--           Reduces egress by 95%+ (5MB -> 15-25KB per article)
--
-- Changes:
-- 1. New RPC get_embedding_similarities() for batch similarity calculation
-- 2. Update find_similar_stories() to remove centroid from return (saves 840KB/article for ANN block)

-- =============================================================================
-- Part A: New RPC for batch similarity computation
-- =============================================================================
-- CRITICAL: Uses float8[] not vector(1536) - supabase-js may not serialize vector cleanly
-- The JS client passes embedding as array, we cast inside SQL to avoid "works in SQL, fails in JS" issues

CREATE OR REPLACE FUNCTION get_embedding_similarities(
  p_query_embedding float8[],
  p_story_ids bigint[]
)
RETURNS TABLE (story_id bigint, similarity double precision)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id AS story_id,
    1 - (s.centroid_embedding_v1 <=> (p_query_embedding::vector(1536))) AS similarity
  FROM stories s
  WHERE s.id = ANY(p_story_ids)
    AND s.centroid_embedding_v1 IS NOT NULL;
$$;

COMMENT ON FUNCTION get_embedding_similarities IS
'TTRC-319: Compute embedding similarities server-side to avoid 14KB/centroid egress.
Returns similarity scores for requested story IDs. Stories with null centroids are filtered.
Called by hybrid-clustering.js after candidate generation.';

GRANT EXECUTE ON FUNCTION get_embedding_similarities TO service_role, authenticated;

-- =============================================================================
-- Part B: Update find_similar_stories to remove centroid from return
-- =============================================================================
-- This saves 840KB per article for the ANN block (60 stories × 14KB each)
-- Also adds topic_slugs to return (was missing, needed for slug block dedup)
--
-- Verified: Only caller is candidate-generation.js:169 (safe to modify)
-- Grep confirmed no Edge Functions call this RPC

CREATE OR REPLACE FUNCTION find_similar_stories(
  query_embedding vector(1536),
  match_limit int DEFAULT 60,
  min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  id bigint,
  primary_headline text,
  -- REMOVED: centroid_embedding_v1 vector(1536) -- TTRC-319 egress optimization
  entity_counter jsonb,
  top_entities text[],
  topic_slugs text[],  -- ADDED: was missing, needed for slug candidate dedup
  last_updated_at timestamptz,
  primary_source_domain text,
  lifecycle_state text,
  similarity double precision
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    s.id,
    s.primary_headline,
    -- REMOVED: s.centroid_embedding_v1 -- TTRC-319: similarity returned instead
    s.entity_counter,
    s.top_entities,
    s.topic_slugs,  -- ADDED
    s.last_updated_at,
    s.primary_source_domain,
    s.lifecycle_state,
    1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.centroid_embedding_v1 IS NOT NULL
    AND s.lifecycle_state IN ('emerging','growing','stable','stale')
    AND (1 - (s.centroid_embedding_v1 <=> query_embedding)) >= min_similarity
  ORDER BY similarity DESC
  LIMIT GREATEST(1, COALESCE(match_limit, 60));
$$;

COMMENT ON FUNCTION find_similar_stories IS
'ANN search for story clustering. Returns top-K similar stories by centroid embedding.
TTRC-319: No longer returns centroid_embedding_v1 to reduce egress.
The similarity field contains the computed cosine similarity.';

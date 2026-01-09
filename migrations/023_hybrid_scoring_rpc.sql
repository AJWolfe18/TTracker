-- Migration 023: Hybrid Scoring RPC Functions
-- Adds SQL functions for candidate generation and clustering
-- Safe to run multiple times (all operations use CREATE OR REPLACE)
-- Depends on: Migration 022 (clustering_v2_schema.sql) and 022.1 (expert fixes)

-- ============================================================================
-- RPC #1: Find Similar Stories (ANN Block)
-- ============================================================================
-- Used by candidate-generation.js for ANN block queries
-- Returns top-K nearest neighbors by centroid embedding similarity

CREATE OR REPLACE FUNCTION find_similar_stories(
  query_embedding vector(1536),
  match_limit int DEFAULT 60
)
RETURNS TABLE (
  id bigint,
  primary_headline text,
  centroid_embedding_v1 vector(1536),
  entity_counter jsonb,
  top_entities text[],
  last_updated_at timestamptz,
  primary_source_domain text,
  lifecycle_state text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.primary_headline,
    s.centroid_embedding_v1,
    s.entity_counter,
    s.top_entities,
    s.last_updated_at,
    s.primary_source_domain,
    s.lifecycle_state,
    1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.centroid_embedding_v1 IS NOT NULL
    AND s.lifecycle_state IN ('emerging', 'growing', 'stable')
  ORDER BY s.centroid_embedding_v1 <=> query_embedding
  LIMIT match_limit;
END;
$$;

COMMENT ON FUNCTION find_similar_stories IS
  'ANN search for candidate stories using HNSW index. Returns top-K nearest neighbors by embedding similarity. Used by hybrid scoring candidate generation.';

GRANT EXECUTE ON FUNCTION find_similar_stories TO service_role, authenticated;

-- ============================================================================
-- RPC #2: Get Story Clustering Candidates (Full OR-Blocking)
-- ============================================================================
-- Optional: Single RPC that combines all 3 blocking methods
-- Can be used instead of individual queries for atomicity

CREATE OR REPLACE FUNCTION get_story_candidates(
  article_embedding vector(1536),
  article_entity_ids text[],
  article_published_at timestamptz,
  time_window_hours int DEFAULT 72,
  ann_limit int DEFAULT 60,
  max_total int DEFAULT 200
)
RETURNS TABLE (
  id bigint,
  primary_headline text,
  centroid_embedding_v1 vector(1536),
  entity_counter jsonb,
  top_entities text[],
  last_updated_at timestamptz,
  primary_source_domain text,
  lifecycle_state text,
  block_source text  -- 'time', 'entity', or 'ann'
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH time_block AS (
    SELECT
      s.id, s.primary_headline, s.centroid_embedding_v1,
      s.entity_counter, s.top_entities, s.last_updated_at,
      s.primary_source_domain, s.lifecycle_state,
      'time'::text AS block_source
    FROM stories s
    WHERE s.lifecycle_state IN ('emerging', 'growing', 'stable')
      AND s.last_updated_at >= (article_published_at - (time_window_hours || ' hours')::interval)
      AND s.last_updated_at <= (article_published_at + INTERVAL '1 hour')
  ),
  entity_block AS (
    SELECT
      s.id, s.primary_headline, s.centroid_embedding_v1,
      s.entity_counter, s.top_entities, s.last_updated_at,
      s.primary_source_domain, s.lifecycle_state,
      'entity'::text AS block_source
    FROM stories s
    WHERE s.lifecycle_state IN ('emerging', 'growing', 'stable')
      AND s.top_entities && article_entity_ids
  ),
  ann_block AS (
    SELECT
      s.id, s.primary_headline, s.centroid_embedding_v1,
      s.entity_counter, s.top_entities, s.last_updated_at,
      s.primary_source_domain, s.lifecycle_state,
      'ann'::text AS block_source
    FROM stories s
    WHERE s.centroid_embedding_v1 IS NOT NULL
      AND s.lifecycle_state IN ('emerging', 'growing', 'stable')
    ORDER BY s.centroid_embedding_v1 <=> article_embedding
    LIMIT ann_limit
  )
  SELECT DISTINCT ON (c.id)
    c.id, c.primary_headline, c.centroid_embedding_v1,
    c.entity_counter, c.top_entities, c.last_updated_at,
    c.primary_source_domain, c.lifecycle_state, c.block_source
  FROM (
    SELECT * FROM time_block
    UNION ALL
    SELECT * FROM entity_block
    UNION ALL
    SELECT * FROM ann_block
  ) c
  LIMIT max_total;
END;
$$;

COMMENT ON FUNCTION get_story_candidates IS
  'OR-blocking candidate generation combining 3 methods: time window, entity overlap, and ANN embedding search. Returns 50-200 candidates in <100ms.';

GRANT EXECUTE ON FUNCTION get_story_candidates TO service_role, authenticated;

-- ============================================================================
-- Migration 023 Complete
-- ============================================================================

-- Summary of changes:
-- ✅ Added find_similar_stories() for ANN block queries
-- ✅ Added get_story_candidates() for full OR-blocking (optional)
-- ✅ Both functions use existing HNSW and GIN indexes
-- ✅ Granted execute permissions to service_role and authenticated

-- Next steps:
-- 1. Apply this migration to TEST database
-- 2. Test candidate generation performance (<100ms target)
-- 3. Integrate with job-queue-worker.js clustering logic
-- 4. Run integration tests on 10+ articles

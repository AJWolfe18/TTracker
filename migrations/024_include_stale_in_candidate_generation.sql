-- Migration 024: Include 'stale' stories in candidate generation (TTRC-230)
--
-- Updates find_similar_stories RPC to include 'stale' lifecycle state
-- canReopenStaleStory() enforces stricter criteria (score >=0.80)
--
-- Improvements:
-- - Use SQL function (STABLE, PARALLEL SAFE) for better planner optimization
-- - Sort by similarity DESC (clearer intent)
-- - Guard match_limit against invalid values
-- - Add min_similarity parameter for flexible thresholding
-- - Use double precision for similarity type

CREATE OR REPLACE FUNCTION find_similar_stories(
  query_embedding vector(1536),
  match_limit int DEFAULT 60,
  min_similarity double precision DEFAULT 0.0
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
  similarity double precision
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
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
    AND s.lifecycle_state IN ('emerging','growing','stable','stale')
    AND (1 - (s.centroid_embedding_v1 <=> query_embedding)) >= min_similarity
  ORDER BY similarity DESC
  LIMIT GREATEST(1, COALESCE(match_limit, 60));
$$;

-- Ensure lifecycle_state constraint includes 'stale'
ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_lifecycle_state_check;

ALTER TABLE stories
  ADD CONSTRAINT stories_lifecycle_state_check
  CHECK (lifecycle_state IN ('emerging','growing','stable','stale','closed','archived'));

-- Ensure HNSW index exists for fast cosine similarity search
CREATE INDEX IF NOT EXISTS ix_stories_centroid_hnsw
  ON stories USING hnsw (centroid_embedding_v1 vector_cosine_ops);

-- Note: For runtime tuning, can set in worker/session:
-- SET LOCAL hnsw.ef_search = 80;  -- Raises recall at small extra cost

-- Migration 027: Add first_seen_at to find_similar_stories for TTRC-321
--
-- TTRC-321: Same-Run High-Embedding Override
-- Need first_seen_at to detect if a candidate story was created in the current RSS run.
-- (stories table uses first_seen_at as creation timestamp, not created_at)
-- Without this, the override can't distinguish same-run stories from older ones.
--
-- CRITICAL: Must DROP first to avoid ERROR 42725 "function not unique"
-- when changing the RETURNS TABLE signature.

DROP FUNCTION IF EXISTS public.find_similar_stories(vector, integer, double precision);

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
  first_seen_at timestamptz,  -- ADDED for TTRC-321 same-run detection
  primary_source_domain text,
  lifecycle_state text,
  similarity double precision
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT
    s.id,
    s.primary_headline,
    s.entity_counter,
    s.top_entities,
    s.topic_slugs,
    s.last_updated_at,
    s.first_seen_at,  -- ADDED for TTRC-321 (stories use first_seen_at, not created_at)
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

-- CRITICAL: Use explicit signature to avoid ambiguity error
COMMENT ON FUNCTION public.find_similar_stories(vector, integer, double precision)
IS 'ANN search for story clustering. Returns top-K similar stories by centroid embedding.
TTRC-319: No longer returns centroid_embedding_v1 to reduce egress.
TTRC-321: Added first_seen_at for same-run detection in override logic.
The similarity field contains the computed cosine similarity.';

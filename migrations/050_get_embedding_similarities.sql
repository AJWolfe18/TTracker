-- Migration 050: Add get_embedding_similarities RPC
-- JIRA: TTRC-362
-- Purpose: Enable embedding similarity calculations for hybrid clustering
-- Impact: Clustering currently at ~17% merge rate; this RPC provides 45% of clustering score
--
-- This function was in TEST but never migrated to PROD.
-- Root cause: Migration 026_server_side_similarity.sql was never committed to repo.

CREATE OR REPLACE FUNCTION public.get_embedding_similarities(
  p_query_embedding double precision[],
  p_story_ids bigint[]
)
RETURNS TABLE(story_id bigint, similarity double precision)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    s.id AS story_id,
    1 - (s.centroid_embedding_v1 <=> (p_query_embedding::vector(1536))) AS similarity
  FROM stories s
  WHERE s.id = ANY(p_story_ids)
    AND s.centroid_embedding_v1 IS NOT NULL;
$function$;

-- Grant execute to the roles that need it
GRANT EXECUTE ON FUNCTION public.get_embedding_similarities(double precision[], bigint[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_embedding_similarities(double precision[], bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_embedding_similarities(double precision[], bigint[]) TO service_role;

-- Verification query (run after applying):
-- SELECT has_function_privilege('anon', 'public.get_embedding_similarities(double precision[], bigint[])', 'execute');

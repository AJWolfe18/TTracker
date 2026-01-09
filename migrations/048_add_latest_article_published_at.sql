-- TTRC-326: Add latest_article_published_at to stories
-- Tracks most recent article's publication time (not last modification)
-- This column is updated atomically via RPC when articles are attached.

-- 1. Add column
ALTER TABLE public.stories
ADD COLUMN IF NOT EXISTS latest_article_published_at TIMESTAMPTZ;

-- 2. Backfill from first_seen_at for existing stories
-- NOTE: This is story birth time, not truly "latest article". Intentional for v1.
-- Future: could backfill from MAX(articles.published_at) per story if needed.
UPDATE public.stories
SET latest_article_published_at = first_seen_at
WHERE latest_article_published_at IS NULL
  AND first_seen_at IS NOT NULL;

-- 3. Index for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_stories_latest_article_published_at
ON public.stories(latest_article_published_at DESC NULLS LAST);

COMMENT ON COLUMN public.stories.latest_article_published_at IS
  'Most recent attached article published_at. Only updated on article attachment, not enrichment. Backfilled from first_seen_at for existing stories.';

-- 4. Atomic update RPC - avoids JS-side race conditions
-- SECURITY: service_role only, SECURITY DEFINER with fixed search_path
CREATE OR REPLACE FUNCTION public.update_story_latest_article_published_at(
  p_story_id BIGINT,
  p_article_published_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ  -- Returns updated value for observability/logging
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stories
  SET latest_article_published_at = CASE
    WHEN p_article_published_at IS NULL THEN latest_article_published_at
    ELSE GREATEST(COALESCE(latest_article_published_at, p_article_published_at), p_article_published_at)
  END
  WHERE id = p_story_id
  RETURNING latest_article_published_at;
$$;

COMMENT ON FUNCTION public.update_story_latest_article_published_at IS
  'Atomically updates latest_article_published_at using GREATEST. Returns updated value. SECURITY DEFINER with fixed search_path.';

-- SECURITY: Only service_role (RSS job uses service role)
GRANT EXECUTE ON FUNCTION public.update_story_latest_article_published_at(BIGINT, TIMESTAMPTZ)
TO service_role;

-- 5. Update find_similar_stories RPC to include new column
-- NOTE: DROP required - Postgres can't change RETURNS TABLE via CREATE OR REPLACE
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
  first_seen_at timestamptz,
  latest_article_published_at timestamptz,  -- NEW for TTRC-326
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
    s.first_seen_at,
    s.latest_article_published_at,
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

COMMENT ON FUNCTION public.find_similar_stories(vector, integer, double precision)
IS 'ANN search for story clustering. TTRC-326: Added latest_article_published_at for recency gating.';

-- Restore grants (matching existing permissions from migration 027)
GRANT EXECUTE ON FUNCTION public.find_similar_stories(vector, integer, double precision)
TO anon, authenticated, service_role;

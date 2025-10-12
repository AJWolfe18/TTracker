-- Migration 022: Production-Grade Story Clustering Schema (TTRC-225)
-- VERSION: No CONCURRENTLY (for Supabase SQL Editor compatibility)
--
-- This migration adds the infrastructure for hybrid scoring clustering:
-- - Versioned embeddings (future-proof for model changes)
-- - Entity extraction metadata (top-5 entities + existing primary_actor)
-- - Quote fingerprinting for presser detection
-- - Artifact URLs for press release linking
-- - Performance indexes (HNSW for ANN, GIN for entities)
-- - Cost tracking for OpenAI API usage
--
-- Based on battle-tested expert recipe with PM/arch review feedback

-- ============================================================================
-- PART 1: Enable Required Extensions
-- ============================================================================

-- pgvector for embeddings and ANN search
CREATE EXTENSION IF NOT EXISTS vector;

-- fuzzystrmatch for string similarity (backup to trigram)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ============================================================================
-- PART 2: Articles Table - Add Clustering Metadata
-- ============================================================================

-- Versioned embeddings (allows model upgrades without breaking changes)
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS embedding_v1 vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model_v1 text DEFAULT 'text-embedding-ada-002';

-- Entity and content metadata for hybrid scoring
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS entities jsonb DEFAULT '[]'::jsonb,  -- top-5 entities with canonical IDs
  ADD COLUMN IF NOT EXISTS keyphrases text[] DEFAULT ARRAY[]::text[],  -- TF-IDF extracted phrases
  ADD COLUMN IF NOT EXISTS quote_hashes bigint[] DEFAULT ARRAY[]::bigint[],  -- SimHash of 12+ word quotes
  ADD COLUMN IF NOT EXISTS artifact_urls text[] DEFAULT ARRAY[]::text[],  -- FR docs, PDFs, press releases
  ADD COLUMN IF NOT EXISTS geo jsonb;  -- {country, state, city}

-- TF-IDF vector for title similarity (smaller dimension)
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS title_tfidf_vector vector(100);

COMMENT ON COLUMN articles.embedding_v1 IS 'OpenAI ada-002 embedding (1536 dim) of title + first 3 sentences';
COMMENT ON COLUMN articles.embedding_model_v1 IS 'Model version used for embedding_v1 (allows future model changes)';
COMMENT ON COLUMN articles.entities IS 'Array of top entities: [{"id":"US-TRUMP","name":"Donald Trump","type":"PERSON","confidence":0.95}, ...]';
COMMENT ON COLUMN articles.keyphrases IS 'TF-IDF extracted keyphrases for Jaccard similarity';
COMMENT ON COLUMN articles.quote_hashes IS 'SimHash signatures of 12+ word quotes (normalized)';
COMMENT ON COLUMN articles.artifact_urls IS 'Referenced artifacts (PDFs, FR docs, press releases) for shared-source bonus';
COMMENT ON COLUMN articles.geo IS 'Extracted geography: {country, state, city}';
COMMENT ON COLUMN articles.title_tfidf_vector IS 'TF-IDF vector of title n-grams (100 dim) for title similarity';

-- ============================================================================
-- PART 3: Stories Table - Add Centroid Tracking & Lifecycle
-- ============================================================================

-- Centroid tracking for online clustering
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS centroid_embedding_v1 vector(1536),
  ADD COLUMN IF NOT EXISTS entity_counter jsonb DEFAULT '{}'::jsonb,  -- {entity_id: count}
  ADD COLUMN IF NOT EXISTS time_range tstzrange;

-- Lifecycle and quality metrics
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS lifecycle_state text DEFAULT 'emerging',
  ADD COLUMN IF NOT EXISTS internal_coherence numeric(3,2),  -- median pairwise score
  ADD COLUMN IF NOT EXISTS thresholds_profile text DEFAULT 'wire';  -- wire|opinion|policy

-- Representative article (highest centrality)
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS representative_title text,
  ADD COLUMN IF NOT EXISTS representative_link text;

COMMENT ON COLUMN stories.centroid_embedding_v1 IS 'Running average embedding of all articles in story';
COMMENT ON COLUMN stories.entity_counter IS 'Entity frequency map: {entity_id: count} for centroid scoring';
COMMENT ON COLUMN stories.time_range IS 'Timestamp range of articles in story (first_seen to last_updated)';
COMMENT ON COLUMN stories.lifecycle_state IS 'Story state: emerging (0-6h) | growing (6-48h) | stable (48-120h) | stale (>5d)';
COMMENT ON COLUMN stories.internal_coherence IS 'Median pairwise similarity score within story (quality metric)';
COMMENT ON COLUMN stories.thresholds_profile IS 'Clustering threshold profile: wire (0.58) | opinion (0.66) | policy (0.62)';
COMMENT ON COLUMN stories.representative_title IS 'Title of most central article (for UI cards)';
COMMENT ON COLUMN stories.representative_link IS 'Link to most central article';

-- ============================================================================
-- PART 4: Performance Indexes (Critical for Speed)
-- ============================================================================

-- ANN search on embeddings (HNSW with cosine distance)
-- This is the primary index for candidate generation
CREATE INDEX IF NOT EXISTS ix_articles_emb_v1_hnsw
  ON articles USING hnsw (embedding_v1 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Entity overlap queries (GIN index for jsonb - default ops for flexibility)
CREATE INDEX IF NOT EXISTS ix_articles_entities_gin
  ON articles USING gin (entities);  -- default jsonb_ops supports more operators

-- Keyphrase overlap (GIN index for text arrays - NO CONCURRENTLY)
CREATE INDEX IF NOT EXISTS ix_articles_keyphrases_gin
  ON articles USING gin (keyphrases);

-- Quote hash overlap (GIN index for bigint arrays - for shared quote detection)
CREATE INDEX IF NOT EXISTS ix_articles_quote_hashes_gin
  ON articles USING gin (quote_hashes);

-- Time windowing (btree for range queries)
CREATE INDEX IF NOT EXISTS ix_articles_published_at_btree
  ON articles (published_at);

-- URL deduplication (for canonical URL matching - NO CONCURRENTLY)
CREATE INDEX IF NOT EXISTS ix_articles_url_canonical
  ON articles (url_canonical)
  WHERE url_canonical IS NOT NULL;

-- Geography lookups (for geo overlap scoring)
CREATE INDEX IF NOT EXISTS ix_articles_geo_state
  ON articles ((geo->>'state'));

CREATE INDEX IF NOT EXISTS ix_articles_geo_country
  ON articles ((geo->>'country'));

-- Title TF-IDF ANN search (optional - only if used for candidate generation)
CREATE INDEX IF NOT EXISTS ix_articles_title_tfidf_hnsw
  ON articles USING hnsw (title_tfidf_vector vector_cosine_ops)
  WITH (m = 12, ef_construction = 64);

-- Story centroid ANN search
CREATE INDEX IF NOT EXISTS ix_stories_centroid_emb_v1_hnsw
  ON stories USING hnsw (centroid_embedding_v1 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Story lifecycle queries
CREATE INDEX IF NOT EXISTS ix_stories_lifecycle_state
  ON stories (lifecycle_state)
  WHERE lifecycle_state IN ('emerging', 'growing', 'stable');

-- Speed up article lookups by story (for lifecycle calculation)
CREATE INDEX IF NOT EXISTS ix_article_story_story_id
  ON article_story (story_id);

-- ============================================================================
-- PART 5: Constraints & Validation
-- ============================================================================

-- Lifecycle state constraint
ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_lifecycle_state_chk;

ALTER TABLE stories
  ADD CONSTRAINT stories_lifecycle_state_chk
  CHECK (lifecycle_state IN ('emerging', 'growing', 'stable', 'stale')) NOT VALID;

-- Thresholds profile constraint
ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_thresholds_profile_chk;

ALTER TABLE stories
  ADD CONSTRAINT stories_thresholds_profile_chk
  CHECK (thresholds_profile IN ('wire', 'opinion', 'policy')) NOT VALID;

-- Embedding dimension guards (future-proof for model upgrades)
ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_embedding_v1_dim_chk;

ALTER TABLE articles
  ADD CONSTRAINT articles_embedding_v1_dim_chk
  CHECK (embedding_v1 IS NULL OR vector_dims(embedding_v1) = 1536) NOT VALID;

ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_centroid_v1_dim_chk;

ALTER TABLE stories
  ADD CONSTRAINT stories_centroid_v1_dim_chk
  CHECK (centroid_embedding_v1 IS NULL OR vector_dims(centroid_embedding_v1) = 1536) NOT VALID;

-- Entities must be array
ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS entities_is_array_chk;

ALTER TABLE articles
  ADD CONSTRAINT entities_is_array_chk
  CHECK (jsonb_typeof(entities) = 'array') NOT VALID;

-- ============================================================================
-- PART 6: OpenAI Cost Tracking
-- ============================================================================

-- Create enum for operation types (stricter typing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'openai_op') THEN
    CREATE TYPE openai_op AS ENUM ('entity_extraction', 'embedding', 'quote_extraction');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS openai_usage (
  id bigserial PRIMARY KEY,
  operation openai_op NOT NULL,
  article_id text,
  story_id bigint,
  tokens_used int NOT NULL,
  cost_usd numeric(10,6) NOT NULL,
  model text NOT NULL,  -- gpt-4o-mini, text-embedding-ada-002
  created_at timestamptz DEFAULT NOW()
);

-- Foreign keys with SET NULL (lightweight, non-blocking)
ALTER TABLE openai_usage
  DROP CONSTRAINT IF EXISTS openai_usage_article_fk,
  DROP CONSTRAINT IF EXISTS openai_usage_story_fk;

ALTER TABLE openai_usage
  ADD CONSTRAINT openai_usage_article_fk
    FOREIGN KEY (article_id) REFERENCES articles(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT openai_usage_story_fk
    FOREIGN KEY (story_id) REFERENCES stories(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS ix_openai_usage_created
  ON openai_usage (created_at);

CREATE INDEX IF NOT EXISTS ix_openai_usage_operation
  ON openai_usage (operation);

COMMENT ON TABLE openai_usage IS 'Tracks OpenAI API usage for cost monitoring and budget enforcement';
COMMENT ON COLUMN openai_usage.operation IS 'Type of operation: entity_extraction, embedding, quote_extraction';
COMMENT ON COLUMN openai_usage.cost_usd IS 'Cost in USD based on model pricing and tokens used';

-- ============================================================================
-- PART 7: Helper Functions
-- ============================================================================

-- Calculate daily OpenAI spend (for budget enforcement)
CREATE OR REPLACE FUNCTION get_daily_openai_spend(target_date date DEFAULT CURRENT_DATE)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)
  FROM openai_usage
  WHERE created_at::date = target_date;
$$;

COMMENT ON FUNCTION get_daily_openai_spend IS 'Returns total OpenAI spend for a given date (default: today)';

-- Calculate rolling 30-day OpenAI spend
CREATE OR REPLACE FUNCTION get_monthly_openai_spend()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)
  FROM openai_usage
  WHERE created_at > NOW() - INTERVAL '30 days';
$$;

COMMENT ON FUNCTION get_monthly_openai_spend IS 'Returns total OpenAI spend for last 30 days';

-- Update story lifecycle state based on age (uses actual existing columns)
CREATE OR REPLACE FUNCTION update_story_lifecycle_states()
RETURNS void
LANGUAGE sql
AS $$
  WITH s AS (
    SELECT
      st.id,
      COALESCE(
        upper(st.time_range),               -- explicit range upper if populated
        max_a.latest_pub,                   -- newest linked article time
        st.last_updated_at,                 -- story last_updated_at (exists)
        st.first_seen_at,                   -- story creation time
        NOW() - INTERVAL '999 years'        -- extreme fallback
      ) AS last_ts
    FROM stories st
    LEFT JOIN LATERAL (
      SELECT MAX(a.published_at) AS latest_pub
      FROM article_story asg
      JOIN articles a ON a.id = asg.article_id
      WHERE asg.story_id = st.id
    ) max_a ON TRUE
  )
  UPDATE stories t
  SET lifecycle_state = CASE
    WHEN s.last_ts > NOW() - INTERVAL '6 hours' THEN 'emerging'
    WHEN s.last_ts > NOW() - INTERVAL '48 hours' THEN 'growing'
    WHEN s.last_ts > NOW() - INTERVAL '120 hours' THEN 'stable'
    ELSE 'stale'
  END
  FROM s
  WHERE t.id = s.id
    AND t.lifecycle_state IS DISTINCT FROM CASE
      WHEN s.last_ts > NOW() - INTERVAL '6 hours' THEN 'emerging'
      WHEN s.last_ts > NOW() - INTERVAL '48 hours' THEN 'growing'
      WHEN s.last_ts > NOW() - INTERVAL '120 hours' THEN 'stable'
      ELSE 'stale'
    END;
$$;

COMMENT ON FUNCTION update_story_lifecycle_states IS 'Updates story lifecycle states using upper(time_range), newest linked article published_at, last_updated_at, then first_seen_at as fallback';

-- ============================================================================
-- PART 8: Grants
-- ============================================================================

GRANT SELECT, INSERT ON openai_usage TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE openai_usage_id_seq TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION get_daily_openai_spend TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION get_monthly_openai_spend TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION update_story_lifecycle_states TO service_role, authenticated;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Note: This migration is safe to run multiple times (all operations use IF NOT EXISTS)
-- Existing data in articles and stories tables is preserved
-- New columns default to NULL or empty arrays
-- Backfill script will populate embeddings and entities for existing articles

-- ============================================================================
-- Optional Post-Backfill: Validate Constraints
-- ============================================================================

-- Run these AFTER backfill completes to enforce constraints on future writes:
-- ALTER TABLE articles VALIDATE CONSTRAINT articles_embedding_v1_dim_chk;
-- ALTER TABLE stories  VALIDATE CONSTRAINT stories_centroid_v1_dim_chk;
-- ALTER TABLE stories  VALIDATE CONSTRAINT stories_lifecycle_state_chk;
-- ALTER TABLE stories  VALIDATE CONSTRAINT stories_thresholds_profile_chk;
-- ALTER TABLE articles VALIDATE CONSTRAINT entities_is_array_chk;

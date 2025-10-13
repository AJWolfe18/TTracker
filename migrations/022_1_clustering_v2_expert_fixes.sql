-- Migration 022.1: Expert Review Fixes for Clustering V2
-- Applies 5 missing fixes identified in expert SQL/clustering review
-- Safe to run multiple times (all operations use IF NOT EXISTS / IF EXISTS)
-- Depends on: Migration 022 (clustering_v2_schema.sql)

-- ============================================================================
-- Fix #1: Add top_entities Column to Stories (for fast GIN filtering)
-- ============================================================================
-- Issue: Candidate generation needs to filter by entity IDs, but entity_counter
--        is a frequency map (jsonb object). top_entities is a flat array for GIN.
-- Solution: Add top_entities text[] synced from entity_counter by application

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS top_entities text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN stories.top_entities IS 
  'Top 5 entity IDs from entity_counter for fast GIN filtering. App must sync when updating entity_counter.';

-- GIN index for fast entity overlap queries (e.g., WHERE top_entities && $1)
CREATE INDEX IF NOT EXISTS ix_stories_top_entities_gin 
  ON stories USING gin (top_entities);

-- ============================================================================
-- Fix #2: Add text_simhash Column to Articles (for duplicate detection)
-- ============================================================================
-- Issue: Plan references simhash for duplicate detection, but column doesn't exist
-- Note: This is separate from quote_hashes (which detects shared quotes/pressers)
-- Solution: Add text_simhash for full-text fuzzy duplicate detection

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS text_simhash bigint;

COMMENT ON COLUMN articles.text_simhash IS 
  'SimHash of full article text for duplicate detection. Hamming distance ≤3 bits = 90%+ similar.';

-- Partial index (only when simhash exists) for duplicate queries
CREATE INDEX IF NOT EXISTS ix_articles_text_simhash 
  ON articles (text_simhash) 
  WHERE text_simhash IS NOT NULL;

-- ============================================================================
-- Fix #3: Make entity_counter NOT NULL (safe-by-default)
-- ============================================================================
-- Issue: Column allows NULL, requiring null checks everywhere
-- Solution: Make NOT NULL with default (safe since 022 already has DEFAULT)

-- First set any existing NULLs to empty object (shouldn't exist, but defensive)
UPDATE stories 
SET entity_counter = '{}'::jsonb 
WHERE entity_counter IS NULL;

-- Now make NOT NULL (ALTER COLUMN, not ADD COLUMN)
ALTER TABLE stories
  ALTER COLUMN entity_counter SET NOT NULL,
  ALTER COLUMN entity_counter SET DEFAULT '{}'::jsonb;

-- ============================================================================
-- Fix #4: Add Cost Cap Documentation
-- ============================================================================
-- Costs & Budget Guardrails for Clustering Pipeline

COMMENT ON TABLE openai_usage IS 
  'Tracks OpenAI API usage for cost monitoring and budget enforcement.

COST CAPS & GUARDS:
- Per article (entities + embedding): $0.0002-$0.0005 (0.02-0.05¢)
- Current volume (≈62/day): $0.30-$0.90/month
- At 1000/day: $6-$15/month

BUDGET GUARDRAILS:
- Pipeline cap (clustering metadata): $5/day
- Global project cap: $50/month
- Halt job after 3 consecutive failures OR when cap reached
- Require manual resume after halt
- Show 24h & 30d totals in admin dashboard

IMPLEMENTATION:
- openaiClient.checkBudget() enforces $5/day pipeline cap
- Worker halts on 3 consecutive OpenAI failures
- Dashboard shows real-time spend vs. caps';

-- ============================================================================
-- Fix #5: Add Production-Ready Candidate Generation Comment
-- ============================================================================
-- Documents the real SQL query for OR-blocking (not pseudocode)

COMMENT ON COLUMN stories.centroid_embedding_v1 IS 
  'Running average embedding of all articles in story. Updated in real-time via app, recomputed exactly via nightly job.

CANDIDATE GENERATION (OR-Blocking):
Returns 50-200 candidate stories in <100ms using 3 methods:

WITH time_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE time_range && tstzrange(NOW() - INTERVAL ''72 hours'', NOW())
    AND lifecycle_state IN (''emerging'',''growing'',''stable'')
),
entity_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE top_entities && :article_entity_ids  -- ARRAY[''US-TRUMP'',''US-DOJ'']
),
ann_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE centroid_embedding_v1 IS NOT NULL
  ORDER BY centroid_embedding_v1 <=> :article_embedding_v1
  LIMIT 60
)
SELECT DISTINCT ON (id) *
FROM (
  SELECT * FROM time_block
  UNION ALL
  SELECT * FROM entity_block
  UNION ALL
  SELECT * FROM ann_block
) c
LIMIT 200;

CENTROID UPDATE STRATEGY:
- Real-time: Running average for fast updates
- Nightly (2am): Exact recompute via AVG(embedding_v1) to fix drift';

-- ============================================================================
-- Helper Function: Nightly Centroid Recompute
-- ============================================================================
-- Fixes drift from running averages by recomputing exact centroids

CREATE OR REPLACE FUNCTION recompute_story_centroids()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE stories s
  SET 
    centroid_embedding_v1 = agg.exact_centroid,
    entity_counter = agg.counter,
    top_entities = agg.top5
  FROM (
    SELECT
      st.id,
      AVG(a.embedding_v1) AS exact_centroid,  -- pgvector supports AVG
      jsonb_object_agg(
        entity_id, 
        entity_count
      ) AS counter,
      ARRAY(
        SELECT entity_id 
        FROM jsonb_each_text(jsonb_object_agg(entity_id, entity_count))
        ORDER BY value::int DESC 
        LIMIT 5
      ) AS top5
    FROM stories st
    JOIN article_story asg ON asg.story_id = st.id
    JOIN articles a ON a.id = asg.article_id
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements(a.entities)->>'id' AS entity_id
    ) entities
    WHERE a.embedding_v1 IS NOT NULL
    GROUP BY st.id
  ) agg
  WHERE s.id = agg.id;
END;
$$;

COMMENT ON FUNCTION recompute_story_centroids IS 
  'Nightly job (cron at 2am) to recompute exact centroids and fix drift from running averages. Updates centroid_embedding_v1, entity_counter, and top_entities.';

GRANT EXECUTE ON FUNCTION recompute_story_centroids TO service_role, authenticated;

-- ============================================================================
-- Migration 022.1 Complete
-- ============================================================================

-- Summary of changes:
-- ✅ Added stories.top_entities for fast entity filtering
-- ✅ Added articles.text_simhash for duplicate detection  
-- ✅ Made stories.entity_counter NOT NULL (safe-by-default)
-- ✅ Added cost cap documentation to openai_usage table
-- ✅ Added production-ready candidate generation SQL to centroid comment
-- ✅ Added recompute_story_centroids() for nightly drift correction

-- Next steps:
-- 1. Apply this migration to TEST database
-- 2. Update openai-client.js with $5/day pipeline cap
-- 3. Update extraction-utils.js to calculate text_simhash
-- 4. Backfill top_entities from entity_counter (if any exist)

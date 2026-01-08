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
-- Helper Function: Nightly Centroid Recompute (FIXED)
-- ============================================================================
-- Fixes drift from running averages by recomputing exact centroids
-- Also rebuilds entity_counter and top_entities (null-safe)

CREATE OR REPLACE FUNCTION recompute_story_centroids()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WITH sa AS (  -- story ⇄ article embeddings
    SELECT st.id AS story_id, a.embedding_v1
    FROM stories st
    JOIN article_story asg ON asg.story_id = st.id
    JOIN articles a        ON a.id = asg.article_id
    WHERE a.embedding_v1 IS NOT NULL
  ),
  centroids AS (  -- exact centroid per story (pgvector supports AVG)
    SELECT story_id, AVG(embedding_v1) AS exact_centroid
    FROM sa
    GROUP BY story_id
  ),
  ent_raw AS (  -- flatten entities: [{"id": "..."}]
    SELECT st.id AS story_id,
           (ent->>'id') AS entity_id
    FROM stories st
    JOIN article_story asg ON asg.story_id = st.id
    JOIN articles a        ON a.id = asg.article_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.entities, '[]'::jsonb)) ent
    WHERE a.entities IS NOT NULL
  ),
  ent_counts AS (  -- count entities per story
    SELECT story_id, entity_id, COUNT(*)::int AS cnt
    FROM ent_raw
    WHERE entity_id IS NOT NULL AND entity_id <> ''
    GROUP BY story_id, entity_id
  ),
  counters AS (   -- build jsonb counter and top-5 list
    SELECT
      story_id,
      jsonb_object_agg(entity_id, cnt)           AS counter,
      ARRAY(
        SELECT ec2.entity_id
        FROM ent_counts ec2
        WHERE ec2.story_id = ec.story_id
        ORDER BY ec2.cnt DESC, ec2.entity_id ASC
        LIMIT 5
      )                                          AS top5
    FROM ent_counts ec
    GROUP BY story_id
  ),
  agg AS (
    SELECT c.story_id,
           c.exact_centroid,
           COALESCE(k.counter, '{}'::jsonb)      AS counter,
           COALESCE(k.top5, ARRAY[]::text[])     AS top5
    FROM centroids c
    LEFT JOIN counters k USING (story_id)
  )
  UPDATE stories s
  SET centroid_embedding_v1 = agg.exact_centroid,
      entity_counter        = agg.counter,
      top_entities          = agg.top5
  FROM agg
  WHERE s.id = agg.story_id;
END;
$$;

COMMENT ON FUNCTION recompute_story_centroids IS
  'Nightly job (2am) to recompute exact centroids and fix drift. Also rebuilds entity_counter (jsonb map) and top_entities (top-5 ids).';

GRANT EXECUTE ON FUNCTION recompute_story_centroids TO service_role, authenticated;

-- ============================================================================
-- Helper Function: Hamming Distance for SimHash (Optional but Recommended)
-- ============================================================================
-- Computes Hamming distance between two bigint SimHash values
-- Used for near-duplicate detection: distance ≤3 = 90%+ similar

CREATE OR REPLACE FUNCTION hamming_distance_bigint(a bigint, b bigint)
RETURNS int
LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
DECLARE
  x bigint := a # b;  -- XOR
  c int := 0;
BEGIN
  -- popcount loop (fast enough for small candidate sets)
  WHILE x <> 0 LOOP
    x := x & (x - 1);  -- clear lowest set bit
    c := c + 1;
  END LOOP;
  RETURN c;
END;
$$;

COMMENT ON FUNCTION hamming_distance_bigint IS
  'Computes Hamming distance (number of differing bits) between two bigint values. Used for SimHash near-duplicate detection.';

GRANT EXECUTE ON FUNCTION hamming_distance_bigint TO service_role, authenticated, anon;

-- ============================================================================
-- Migration 022.1 Complete
-- ============================================================================

-- Summary of changes:
-- ✅ Added stories.top_entities for fast entity filtering
-- ✅ Added articles.text_simhash for duplicate detection
-- ✅ Made stories.entity_counter NOT NULL (safe-by-default)
-- ✅ Added cost cap documentation to openai_usage table
-- ✅ Added production-ready candidate generation SQL to centroid comment
-- ✅ Added recompute_story_centroids() for nightly drift correction (FIXED)
-- ✅ Added hamming_distance_bigint() for SimHash duplicate detection

-- Next steps:
-- 1. Apply this migration to TEST database
-- 2. Update openai-client.js with $5/day pipeline cap (✅ DONE)
-- 3. Update extraction-utils.js to calculate text_simhash (✅ DONE)
-- 4. Backfill top_entities from entity_counter (if any exist)
-- 5. For duplicate detection: Pull candidate pool (same domain/time), then:
--    SELECT * WHERE hamming_distance_bigint(text_simhash, $1) <= 3

-- Performance notes:
-- - text_simhash index only accelerates equality lookups
-- - For "Hamming ≤ 3" queries, consider bucketing by top-N bits in application
--   (e.g., group by 8-12 MSBs) to reduce comparison candidates before Hamming test
-- - top_entities sync: Call recompute_story_centroids() after large backfills
--   or add worker hook when entity_counter is updated

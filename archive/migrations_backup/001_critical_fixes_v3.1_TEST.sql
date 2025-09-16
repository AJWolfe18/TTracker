-- TrumpyTracker Critical Migration v3.1 - TEST ENVIRONMENT VERSION
-- TTRC-160: Database Schema Fixes
-- This version handles the test environment's INTEGER id issue
-- 
-- Run this on TEST database: wnrjrywpcadwutfykflu

BEGIN;

-- ================================================
-- 0. FIX TEST ENVIRONMENT ID MISMATCH
-- ================================================

-- Check and fix political_entries.id type if needed
DO $$ 
DECLARE
    id_type text;
BEGIN
    SELECT data_type INTO id_type
    FROM information_schema.columns 
    WHERE table_name = 'political_entries' 
    AND column_name = 'id';
    
    IF id_type = 'integer' OR id_type = 'bigint' THEN
        -- Need to convert to TEXT
        EXECUTE 'ALTER TABLE political_entries ALTER COLUMN id TYPE TEXT USING id::TEXT';
        RAISE NOTICE 'Converted political_entries.id from % to TEXT', id_type;
    END IF;
END $$;

-- ================================================
-- 1. ADD MISSING COLUMNS TO political_entries
-- ================================================
ALTER TABLE political_entries 
  ADD COLUMN IF NOT EXISTS url_canonical TEXT,
  ADD COLUMN IF NOT EXISTS url_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_domain TEXT,
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_type TEXT CHECK (
    content_type IN ('news_report', 'opinion', 'analysis', 'editorial')
  ),
  ADD COLUMN IF NOT EXISTS excerpt TEXT;

-- ================================================
-- 2. CREATE STORIES TABLE WITH ALL REQUIRED COLUMNS
-- ================================================
CREATE TABLE IF NOT EXISTS stories (
  id BIGSERIAL PRIMARY KEY,
  story_hash TEXT UNIQUE NOT NULL,
  primary_headline TEXT NOT NULL,
  primary_source TEXT,
  primary_source_url TEXT,
  primary_source_domain TEXT,
  primary_actor TEXT,  -- Required for clustering algorithm
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT DEFAULT 'active',
  closed_at TIMESTAMPTZ,
  reopen_count INTEGER DEFAULT 0,
  severity TEXT CHECK (severity IN ('critical', 'severe', 'moderate', 'minor')),
  topic_tags TEXT[],
  source_count INTEGER DEFAULT 1,
  summary_neutral TEXT,
  summary_spicy TEXT,
  has_opinion BOOLEAN DEFAULT FALSE,
  last_enriched_at TIMESTAMPTZ,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', 
      primary_headline || ' ' || 
      COALESCE(summary_neutral, '') || ' ' || 
      COALESCE(summary_spicy, '')
    )
  ) STORED
);

-- Fix status constraint to include 'archived'
ALTER TABLE stories 
  DROP CONSTRAINT IF EXISTS stories_status_check,
  ADD CONSTRAINT stories_status_check 
  CHECK (status IN ('active', 'closed', 'archived'));

-- ================================================
-- 3. CREATE ARTICLE_STORY JUNCTION TABLE
-- ================================================
-- Drop if exists to avoid foreign key issues
DROP TABLE IF EXISTS article_story;

CREATE TABLE article_story (
  article_id TEXT REFERENCES political_entries(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  is_primary_source BOOLEAN DEFAULT FALSE,
  similarity_score NUMERIC(3,2) CHECK (similarity_score >= 0 AND similarity_score <= 1),
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(article_id)
);

-- ================================================
-- 4. CREATE FEED_REGISTRY WITH ALL COLUMNS
-- ================================================
CREATE TABLE IF NOT EXISTS feed_registry (
  feed_url TEXT PRIMARY KEY,
  feed_name TEXT NOT NULL,
  topics TEXT[] NOT NULL,
  tier INTEGER DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
  etag TEXT,  -- For 304 support
  last_modified TEXT,  -- For 304 support
  last_fetched TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  last_304_at TIMESTAMPTZ
);

-- ================================================
-- 5. CREATE JOB_QUEUE TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS job_queue (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT GENERATED ALWAYS AS (md5(payload::text)) STORED,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  run_after TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE(type, payload_hash)  -- Idempotency
);

-- ================================================
-- 6. CREATE BUDGETS TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS budgets (
  day DATE PRIMARY KEY,
  cap_usd NUMERIC(8,2) DEFAULT 50.00,
  spent_usd NUMERIC(8,2) DEFAULT 0.00,
  openai_calls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- 7. CREATE ALL REQUIRED INDEXES
-- ================================================

-- Stories indexes
CREATE INDEX IF NOT EXISTS idx_stories_search ON stories USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_stories_topics ON stories USING gin(topic_tags);
CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories(last_updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_stories_archived ON stories(id) WHERE status = 'archived';

-- Political entries indexes (URL uniqueness strategy)
DROP INDEX IF EXISTS political_entries_url_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_url_date 
  ON political_entries(url_hash, (published_at::date))
  WHERE published_at > NOW() - INTERVAL '30 days' AND url_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_created ON political_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_published ON political_entries(published_at DESC) 
  WHERE published_at IS NOT NULL;

-- Article-Story indexes
CREATE INDEX IF NOT EXISTS idx_article_story_story ON article_story(story_id);
CREATE INDEX IF NOT EXISTS idx_article_story_matched ON article_story(matched_at DESC);

-- Feed registry indexes
CREATE INDEX IF NOT EXISTS idx_feeds_active ON feed_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_feeds_tier ON feed_registry(tier);

-- Job queue indexes
CREATE INDEX IF NOT EXISTS idx_queue_pending ON job_queue(created_at) 
  WHERE status = 'pending' AND run_after <= NOW();

-- ================================================
-- 8. CREATE HELPER FUNCTION FOR BUDGET TRACKING
-- ================================================
CREATE OR REPLACE FUNCTION increment_daily_spend(amount NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO budgets (day, spent_usd, updated_at)
  VALUES (CURRENT_DATE, amount, NOW())
  ON CONFLICT (day) DO UPDATE
  SET spent_usd = budgets.spent_usd + EXCLUDED.spent_usd,
      updated_at = NOW();
END;
$$;

-- ================================================
-- 9. VERIFY CRITICAL COMPONENTS
-- ================================================
DO $$ 
DECLARE
    pe_id_type text;
    story_exists boolean;
    article_story_exists boolean;
BEGIN
    -- Check political_entries.id is TEXT
    SELECT data_type INTO pe_id_type
    FROM information_schema.columns 
    WHERE table_name = 'political_entries' 
    AND column_name = 'id';
    
    -- Check tables exist
    SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'stories') INTO story_exists;
    SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'article_story') INTO article_story_exists;
    
    RAISE NOTICE 'political_entries.id type: %', pe_id_type;
    RAISE NOTICE 'stories table exists: %', story_exists;
    RAISE NOTICE 'article_story table exists: %', article_story_exists;
    
    IF pe_id_type NOT IN ('text', 'character varying') THEN
        RAISE EXCEPTION 'political_entries.id must be TEXT type';
    END IF;
END $$;

COMMIT;

-- ================================================
-- Migration Complete!
-- Next steps:
-- 1. Run migration_verification.sql to verify
-- 2. Run test_data_fixtures.sql to add test data
-- 3. Start Edge Functions development
-- ================================================
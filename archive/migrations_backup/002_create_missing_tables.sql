-- Fix Missing Tables in Test Environment
-- Run this to create the 4 missing tables

BEGIN;

-- ================================================
-- 1. CREATE ARTICLE_STORY JUNCTION TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS article_story (
  article_id TEXT REFERENCES political_entries(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  is_primary_source BOOLEAN DEFAULT FALSE,
  similarity_score NUMERIC(3,2) CHECK (similarity_score >= 0 AND similarity_score <= 1),
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(article_id)
);

-- ================================================
-- 2. CREATE FEED_REGISTRY TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS feed_registry (
  feed_url TEXT PRIMARY KEY,
  feed_name TEXT NOT NULL,
  topics TEXT[] NOT NULL,
  tier INTEGER DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
  etag TEXT,
  last_modified TEXT,
  last_fetched TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  last_304_at TIMESTAMPTZ
);

-- ================================================
-- 3. CREATE JOB_QUEUE TABLE
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
  UNIQUE(type, payload_hash)
);

-- ================================================
-- 4. CREATE BUDGETS TABLE
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
-- 5. CREATE INDEXES FOR NEW TABLES
-- ================================================

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
-- 6. CREATE HELPER FUNCTION
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
-- 7. VERIFY TABLES NOW EXIST
-- ================================================
DO $$ 
DECLARE
    table_count INTEGER;
    missing_tables TEXT;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('political_entries', 'stories', 'article_story', 
                        'job_queue', 'feed_registry', 'budgets');
    
    IF table_count = 6 THEN
        RAISE NOTICE '✅ SUCCESS: All 6 tables now exist!';
    ELSE
        -- Find which tables are still missing
        SELECT string_agg(t.table_name, ', ') INTO missing_tables
        FROM (VALUES ('political_entries'), ('stories'), ('article_story'), 
              ('job_queue'), ('feed_registry'), ('budgets')) AS t(table_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_name = t.table_name
        );
        
        RAISE NOTICE '⚠️  Still missing tables: %', missing_tables;
        RAISE NOTICE 'Found % of 6 tables', table_count;
    END IF;
END $$;

COMMIT;

-- Show what tables we have now
SELECT table_name, 
       CASE 
         WHEN table_name IN ('political_entries', 'stories', 'article_story', 
                            'job_queue', 'feed_registry', 'budgets') 
         THEN '✅ Required' 
         ELSE '📍 Other' 
       END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY 
  CASE 
    WHEN table_name IN ('political_entries', 'stories', 'article_story', 
                        'job_queue', 'feed_registry', 'budgets') 
    THEN 0 
    ELSE 1 
  END, 
  table_name;
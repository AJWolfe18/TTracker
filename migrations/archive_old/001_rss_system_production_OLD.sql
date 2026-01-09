-- TrumpyTracker RSS System Migration - TEST VERSION
-- Run this FIRST on TEST Database
-- This creates all missing tables and columns for RSS system

BEGIN;

-- ================================================
-- 1. CREATE ARTICLES TABLE (new for RSS system)
-- ================================================
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY DEFAULT 'art-' || gen_random_uuid()::text,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  headline TEXT NOT NULL,
  source_name TEXT,
  source_domain TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  content TEXT,
  content_type TEXT CHECK (
    content_type IN ('news_report', 'opinion', 'analysis', 'editorial')
  ) DEFAULT 'news_report',
  opinion_flag BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for articles
CREATE INDEX IF NOT EXISTS idx_articles_url_hash ON articles(url_hash);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url_date ON articles(url_hash, DATE(published_at));

-- ================================================
-- 2. UPDATE STORIES TABLE (add missing columns)
-- ================================================
-- Add missing columns to stories
ALTER TABLE stories 
  ADD COLUMN IF NOT EXISTS primary_actor TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3,2) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS severity_level INTEGER DEFAULT 5;

-- Add search vector if missing
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stories' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE stories ADD COLUMN search_vector tsvector;
    UPDATE stories SET search_vector = 
      to_tsvector('english', 
        COALESCE(headline, '') || ' ' || 
        COALESCE(neutral_summary, '') || ' ' || 
        COALESCE(spicy_summary, '')
      );
    CREATE INDEX idx_stories_search_vector ON stories USING GIN (search_vector);
  END IF;
END $;

-- ================================================
-- 3. UPDATE FEED_REGISTRY (add RSS columns)
-- ================================================
ALTER TABLE feed_registry
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS last_modified TEXT,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topics TEXT[],
  ADD COLUMN IF NOT EXISTS is_opinion_source BOOLEAN DEFAULT FALSE;

-- ================================================
-- 4. UPDATE ARTICLE_STORY (fix relationships)
-- ================================================
ALTER TABLE article_story
  ADD COLUMN IF NOT EXISTS article_id TEXT,
  ADD COLUMN IF NOT EXISTS story_id BIGINT,
  ADD COLUMN IF NOT EXISTS is_primary_source BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ DEFAULT NOW();

-- Add foreign keys
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'article_story_article_id_fkey'
  ) THEN
    ALTER TABLE article_story
    ADD CONSTRAINT article_story_article_id_fkey
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'article_story_story_id_fkey'
  ) THEN
    ALTER TABLE article_story
    ADD CONSTRAINT article_story_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE;
  END IF;
END $;

-- ================================================
-- 5. GRANT PERMISSIONS
-- ================================================
GRANT SELECT ON articles TO anon, authenticated;
GRANT SELECT ON stories TO anon, authenticated;
GRANT SELECT ON article_story TO anon, authenticated;
GRANT SELECT ON feed_registry TO anon, authenticated;
GRANT SELECT ON job_queue TO anon, authenticated;

GRANT INSERT, UPDATE ON articles TO authenticated;
GRANT INSERT, UPDATE ON stories TO authenticated;
GRANT INSERT, UPDATE ON article_story TO authenticated;

-- ================================================
-- 6. CREATE RLS POLICIES
-- ================================================
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_story ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Allow public read" ON articles;
DROP POLICY IF EXISTS "Allow public read access" ON articles;
CREATE POLICY "Allow public read" ON articles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read" ON stories;
DROP POLICY IF EXISTS "Allow public read access" ON stories;
CREATE POLICY "Allow public read" ON stories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read" ON article_story;
DROP POLICY IF EXISTS "Allow public read access" ON article_story;
CREATE POLICY "Allow public read" ON article_story
  FOR SELECT USING (true);

COMMIT;

-- ================================================
-- 7. VERIFY EVERYTHING
-- ================================================
SELECT 'Tables created:' as status;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('articles', 'stories', 'article_story', 'feed_registry', 'job_queue')
ORDER BY table_name;
);

-- ================================================
-- 3. CREATE ARTICLE_STORY JUNCTION TABLE
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
-- 4. CREATE FEED_REGISTRY TABLE
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
  UNIQUE(type, payload_hash)
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
-- 7. CREATE INDEXES
-- ================================================
-- Stories indexes
CREATE INDEX IF NOT EXISTS idx_stories_search ON stories USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_stories_topics ON stories USING gin(topic_tags);
CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories(last_updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_stories_archived ON stories(id) WHERE status = 'archived';

-- Political entries indexes
DROP INDEX IF EXISTS political_entries_url_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_url_date 
  ON political_entries(url_hash, (published_at::date))
  WHERE published_at > NOW() - INTERVAL '30 days' AND url_hash IS NOT NULL;

-- Other indexes
CREATE INDEX IF NOT EXISTS idx_article_story_story ON article_story(story_id);
CREATE INDEX IF NOT EXISTS idx_article_story_matched ON article_story(matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_feeds_active ON feed_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_feeds_tier ON feed_registry(tier);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON job_queue(created_at) 
  WHERE status = 'pending' AND run_after <= NOW();

-- ================================================
-- 8. CREATE HELPER FUNCTION
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

COMMIT;
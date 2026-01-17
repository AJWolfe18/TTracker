-- ============================================
-- Migration 000: PROD Base Schema
-- Creates all base tables missing from PROD
-- Run FIRST before any other migrations
-- ============================================

BEGIN;

-- Pre-req: gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ================================================
-- 1) STORIES TABLE (base table for RSS system)
-- ================================================
CREATE TABLE IF NOT EXISTS stories (
  id BIGSERIAL PRIMARY KEY,
  story_hash TEXT UNIQUE,
  headline TEXT,
  primary_headline TEXT,
  neutral_summary TEXT,
  spicy_summary TEXT,
  summary_neutral TEXT,
  summary_spicy TEXT,
  topic_tags TEXT[],
  primary_actor TEXT,
  confidence_score NUMERIC(4,3) DEFAULT 0.5,
  category TEXT,
  severity INTEGER DEFAULT 5,
  severity_level INTEGER DEFAULT 5,
  status TEXT CHECK (status IN ('active', 'closed', 'archived', 'merged')) DEFAULT 'active',
  article_count INTEGER DEFAULT 0,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  search_vector tsvector
);

-- Stories indexes
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories(last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_hash ON stories(story_hash);

-- ================================================
-- 2) ARTICLES TABLE
-- ================================================
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY DEFAULT ('art-' || gen_random_uuid()::text),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  headline TEXT NOT NULL,
  source_name TEXT,
  source_domain TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  published_date DATE,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  content TEXT,
  content_type TEXT CHECK (
    content_type IN ('news_report','opinion','analysis','editorial')
  ) DEFAULT 'news_report',
  opinion_flag BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Articles indexes
CREATE INDEX IF NOT EXISTS idx_articles_url_hash ON articles(url_hash);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_domain);

-- ================================================
-- 3) ARTICLE_STORY junction table
-- ================================================
CREATE TABLE IF NOT EXISTS article_story (
  article_id TEXT PRIMARY KEY,
  story_id BIGINT,
  is_primary_source BOOLEAN DEFAULT FALSE,
  similarity_score NUMERIC(4,2),
  matched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction indexes
CREATE INDEX IF NOT EXISTS idx_article_story_story ON article_story(story_id);

-- ================================================
-- 4) FEED_REGISTRY table
-- ================================================
CREATE TABLE IF NOT EXISTS feed_registry (
  id BIGSERIAL PRIMARY KEY,
  feed_url TEXT UNIQUE NOT NULL,
  feed_name TEXT NOT NULL,
  topics TEXT[] NOT NULL DEFAULT '{}',
  tier INTEGER DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
  etag TEXT,
  last_modified TEXT,
  last_fetched TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  last_304_at TIMESTAMPTZ,
  is_opinion_source BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feed indexes
CREATE INDEX IF NOT EXISTS idx_feeds_active ON feed_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_feeds_tier ON feed_registry(tier);

-- ================================================
-- 5) JOB_QUEUE table
-- ================================================
CREATE TABLE IF NOT EXISTS job_queue (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT CHECK (status IN ('pending', 'claimed', 'completed', 'failed')) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  run_after TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);

-- Job queue indexes
CREATE INDEX IF NOT EXISTS idx_queue_pending ON job_queue(created_at)
  WHERE status = 'pending' AND run_after <= NOW();

-- ================================================
-- 6) BUDGETS table
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
-- 7) Basic updated_at trigger
-- ================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END$$;

-- Apply to tables
DROP TRIGGER IF EXISTS trg_articles_set_updated_at ON articles;
CREATE TRIGGER trg_articles_set_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_stories_set_updated_at ON stories;
CREATE TRIGGER trg_stories_set_updated_at
BEFORE UPDATE ON stories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================
-- 8) Basic RLS and grants
-- ================================================
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_story ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read" ON articles;
CREATE POLICY "Allow public read" ON articles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read" ON stories;
CREATE POLICY "Allow public read" ON stories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read" ON article_story;
CREATE POLICY "Allow public read" ON article_story FOR SELECT USING (true);

GRANT SELECT ON articles TO anon, authenticated;
GRANT SELECT ON stories TO anon, authenticated;
GRANT SELECT ON article_story TO anon, authenticated;
GRANT SELECT ON feed_registry TO anon, authenticated;
GRANT SELECT ON job_queue TO anon, authenticated;
GRANT SELECT ON budgets TO anon, authenticated;

COMMIT;

-- ================================================
-- VERIFY
-- ================================================
SELECT 'Base tables created:' AS status;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('articles', 'stories', 'article_story', 'feed_registry', 'job_queue', 'budgets')
ORDER BY table_name;

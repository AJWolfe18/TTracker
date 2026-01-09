-- Create articles table (missing from RSS system)
-- Run this BEFORE fixing relationships

BEGIN;

-- Create articles table (renamed from political_entries for RSS system)
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

-- Now fix the article_story relationship
ALTER TABLE article_story 
  ADD COLUMN IF NOT EXISTS article_id TEXT,
  ADD COLUMN IF NOT EXISTS story_id BIGINT,
  ADD COLUMN IF NOT EXISTS is_primary_source BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ DEFAULT NOW();

-- Add foreign keys
DO $$
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
END $$;

-- Grant permissions
GRANT SELECT ON articles TO anon, authenticated;
GRANT INSERT, UPDATE ON articles TO authenticated;
GRANT DELETE ON articles TO service_role;

-- Create RLS policies
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON articles
  FOR SELECT USING (true);

CREATE POLICY "Allow authenticated write" ON articles
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update" ON articles
  FOR UPDATE USING (auth.role() = 'authenticated');

COMMIT;

-- Verify the table was created
SELECT 'articles' as table_name, COUNT(*) as row_count FROM articles;
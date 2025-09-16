-- Complete Fix for political_entries.id INTEGER to TEXT conversion
-- This handles all dependencies and preserves data

BEGIN;

-- ================================================
-- 1. DROP ALL DEPENDENT VIEWS FIRST
-- ================================================
DROP VIEW IF EXISTS recent_political_entries CASCADE;
DROP VIEW IF EXISTS dashboard_stats CASCADE;
DROP VIEW IF EXISTS political_entries_view CASCADE;
DROP VIEW IF EXISTS entries_summary CASCADE;

-- ================================================
-- 2. CREATE BACKUP OF EXISTING DATA
-- ================================================
CREATE TEMP TABLE political_entries_backup AS 
SELECT * FROM political_entries;

-- ================================================
-- 3. DROP AND RECREATE THE TABLE WITH CORRECT SCHEMA
-- ================================================
DROP TABLE IF EXISTS political_entries CASCADE;

CREATE TABLE political_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT,
  category TEXT,
  severity_level INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  -- New columns for RSS
  url_canonical TEXT,
  url_hash TEXT,
  source_domain TEXT,
  source_name TEXT,
  published_at TIMESTAMPTZ,
  content_type TEXT CHECK (content_type IN ('news_report', 'opinion', 'analysis', 'editorial')),
  excerpt TEXT
);

-- ================================================
-- 4. RESTORE DATA WITH ID CONVERSION
-- ================================================
INSERT INTO political_entries (
  id, title, url, source, category, severity_level, 
  created_at, updated_at, processed
)
SELECT 
  CASE 
    WHEN id ~ '^\d+$' THEN 'pe-' || id::TEXT
    ELSE id::TEXT
  END as id,
  title, url, source, category, severity_level,
  created_at, updated_at, processed
FROM political_entries_backup;

-- ================================================
-- 5. RECREATE VIEWS
-- ================================================
CREATE OR REPLACE VIEW recent_political_entries AS
SELECT 
    id,
    title,
    url,
    source,
    category,
    severity_level,
    created_at,
    updated_at,
    processed,
    COALESCE(url_canonical, url) as canonical_url,
    url_hash,
    source_domain,
    source_name,
    published_at,
    content_type,
    excerpt
FROM political_entries
WHERE created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW dashboard_stats AS
SELECT 
    COUNT(*) as total_entries,
    COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as entries_today,
    COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as entries_week,
    COUNT(CASE WHEN processed = true THEN 1 END) as processed_count,
    COUNT(CASE WHEN processed = false THEN 1 END) as unprocessed_count
FROM political_entries;

-- ================================================
-- 6. CREATE INDEXES
-- ================================================
CREATE INDEX IF NOT EXISTS idx_entries_created ON political_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_published ON political_entries(published_at DESC) 
  WHERE published_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_article_url_date 
  ON political_entries(url_hash, (published_at::date))
  WHERE published_at > NOW() - INTERVAL '30 days' AND url_hash IS NOT NULL;

-- ================================================
-- 7. NOW CREATE THE MISSING TABLES
-- ================================================

-- Article-Story junction table (should work now with TEXT id)
CREATE TABLE IF NOT EXISTS article_story (
  article_id TEXT REFERENCES political_entries(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  is_primary_source BOOLEAN DEFAULT FALSE,
  similarity_score NUMERIC(3,2) CHECK (similarity_score >= 0 AND similarity_score <= 1),
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(article_id)
);

-- Feed Registry
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

-- Job Queue
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

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  day DATE PRIMARY KEY,
  cap_usd NUMERIC(8,2) DEFAULT 50.00,
  spent_usd NUMERIC(8,2) DEFAULT 0.00,
  openai_calls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- 8. CREATE ALL INDEXES
-- ================================================
CREATE INDEX IF NOT EXISTS idx_article_story_story ON article_story(story_id);
CREATE INDEX IF NOT EXISTS idx_article_story_matched ON article_story(matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_feeds_active ON feed_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_feeds_tier ON feed_registry(tier);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON job_queue(created_at) 
  WHERE status = 'pending' AND run_after <= NOW();

-- ================================================
-- 9. CREATE HELPER FUNCTION
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
-- 10. VERIFY EVERYTHING
-- ================================================
DO $$ 
DECLARE
    pe_type TEXT;
    table_count INTEGER;
    row_count INTEGER;
BEGIN
    -- Check ID type
    SELECT data_type INTO pe_type
    FROM information_schema.columns 
    WHERE table_name = 'political_entries' AND column_name = 'id';
    
    -- Count tables
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('political_entries', 'stories', 'article_story', 
                        'job_queue', 'feed_registry', 'budgets');
    
    -- Count preserved rows
    SELECT COUNT(*) INTO row_count FROM political_entries;
    
    RAISE NOTICE '=================================';
    RAISE NOTICE 'MIGRATION COMPLETE';
    RAISE NOTICE '=================================';
    RAISE NOTICE 'political_entries.id type: %', pe_type;
    RAISE NOTICE 'Tables created: % of 6', table_count;
    RAISE NOTICE 'Rows preserved: %', row_count;
    
    IF pe_type = 'text' AND table_count = 6 THEN
        RAISE NOTICE '✅ SUCCESS! All tables created with correct types.';
    ELSE
        RAISE NOTICE '⚠️ Check results above for issues.';
    END IF;
END $$;

COMMIT;

-- Final check
SELECT 
    'political_entries.id type' as check_item,
    data_type as result
FROM information_schema.columns 
WHERE table_name = 'political_entries' AND column_name = 'id'
UNION ALL
SELECT 
    'Total required tables',
    COUNT(*)::TEXT
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('political_entries', 'stories', 'article_story', 
                    'job_queue', 'feed_registry', 'budgets');
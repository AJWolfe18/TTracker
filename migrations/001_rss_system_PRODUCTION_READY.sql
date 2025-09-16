-- TrumpyTracker RSS System Migration - PRODUCTION READY VERSION
-- This version has been reviewed, tested, and successfully deployed to TEST
-- Use this for PRODUCTION deployment

BEGIN;

-- Pre-req: gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ================================================
-- 1) ARTICLES
-- ================================================
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY DEFAULT ('art-' || gen_random_uuid()::text),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  headline TEXT NOT NULL,
  source_name TEXT,
  source_domain TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_articles_url_hash     ON articles(url_hash);
CREATE INDEX IF NOT EXISTS idx_articles_published    ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source       ON articles(source_domain);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_articles_set_updated_at ON articles;
CREATE TRIGGER trg_articles_set_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================
-- 2) STORIES: add columns + search vector
-- ================================================
ALTER TABLE stories 
  ADD COLUMN IF NOT EXISTS primary_actor   TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS category        TEXT,
  ADD COLUMN IF NOT EXISTS severity_level  INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS headline        TEXT,
  ADD COLUMN IF NOT EXISTS search_vector   tsvector;

-- Optional safety: bound confidence to [0,1]
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stories'::regclass AND conname = 'stories_confidence_score_ck'
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT stories_confidence_score_ck CHECK (confidence_score BETWEEN 0 AND 1);
  END IF;
END
$$ LANGUAGE plpgsql;

-- Backfill search_vector once where null
UPDATE stories SET search_vector =
  to_tsvector('english',
    COALESCE(headline,'') || ' ' ||
    COALESCE(neutral_summary,'') || ' ' ||
    COALESCE(spicy_summary,'')
  )
WHERE search_vector IS NULL;

-- Ensure GIN index exists
CREATE INDEX IF NOT EXISTS idx_stories_search_vector ON stories USING GIN (search_vector);

-- Keep search_vector fresh
CREATE OR REPLACE FUNCTION stories_search_vector_tgr()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.headline,'') || ' ' ||
    COALESCE(NEW.neutral_summary,'') || ' ' ||
    COALESCE(NEW.spicy_summary,'')
  );
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_stories_search ON stories;
CREATE TRIGGER trg_stories_search
BEFORE INSERT OR UPDATE OF headline, neutral_summary, spicy_summary
ON stories FOR EACH ROW EXECUTE FUNCTION stories_search_vector_tgr();

-- ================================================
-- 3) FEED_REGISTRY (only if table exists)
-- ================================================
DO $$
BEGIN
  IF to_regclass('public.feed_registry') IS NOT NULL THEN
    ALTER TABLE feed_registry
      ADD COLUMN IF NOT EXISTS etag              TEXT,
      ADD COLUMN IF NOT EXISTS last_modified     TEXT,
      ADD COLUMN IF NOT EXISTS failure_count     INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS topics            TEXT[],
      ADD COLUMN IF NOT EXISTS is_opinion_source BOOLEAN DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_feed_registry_topics ON feed_registry USING GIN (topics);
  END IF;
END
$$ LANGUAGE plpgsql;

-- ================================================
-- 4) ARTICLE_STORY link table + FKs
-- ================================================
-- Ensure columns exist
ALTER TABLE article_story
  ADD COLUMN IF NOT EXISTS article_id        TEXT,
  ADD COLUMN IF NOT EXISTS story_id          BIGINT,
  ADD COLUMN IF NOT EXISTS is_primary_source BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS similarity_score  NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS matched_at        TIMESTAMPTZ DEFAULT NOW();

-- Clean up orphans (safer NOT EXISTS form)
DELETE FROM article_story a
WHERE a.article_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM articles ar WHERE ar.id = a.article_id);

DELETE FROM article_story a
WHERE a.story_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = a.story_id);

-- Helpful FK indexes
CREATE INDEX IF NOT EXISTS idx_article_story_article ON article_story(article_id);
CREATE INDEX IF NOT EXISTS idx_article_story_story   ON article_story(story_id);

-- Add FKs as NOT VALID, then validate (avoids immediate scan/failure)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'article_story_article_id_fkey'
  ) THEN
    ALTER TABLE article_story
      ADD CONSTRAINT article_story_article_id_fkey
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'article_story_story_id_fkey'
  ) THEN
    ALTER TABLE article_story
      ADD CONSTRAINT article_story_story_id_fkey
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$ LANGUAGE plpgsql;

-- Validate after cleanup
ALTER TABLE article_story VALIDATE CONSTRAINT article_story_article_id_fkey;
ALTER TABLE article_story VALIDATE CONSTRAINT article_story_story_id_fkey;

-- (Optional, if you want strict link semantics later)
-- ALTER TABLE article_story ALTER COLUMN article_id SET NOT NULL;
-- ALTER TABLE article_story ALTER COLUMN story_id   SET NOT NULL;
-- ALTER TABLE article_story ADD CONSTRAINT article_story_pk PRIMARY KEY (article_id, story_id);

-- ================================================
-- 5) GRANTS (guard tables that might not exist)
-- ================================================
GRANT SELECT ON articles      TO anon, authenticated;
GRANT SELECT ON stories       TO anon, authenticated;
GRANT SELECT ON article_story TO anon, authenticated;
DO $$
BEGIN
  IF to_regclass('public.feed_registry') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON feed_registry TO anon, authenticated';
  END IF;
  IF to_regclass('public.job_queue') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON job_queue TO anon, authenticated';
  END IF;
END
$$ LANGUAGE plpgsql;

-- NOTE: With RLS enabled below, these INSERT/UPDATE grants do not allow client writes
-- unless matching RLS policies exist. Keep or remove based on your intent.
GRANT INSERT, UPDATE ON articles      TO authenticated;
GRANT INSERT, UPDATE ON stories       TO authenticated;
GRANT INSERT, UPDATE ON article_story TO authenticated;

-- ================================================
-- 6) RLS
-- ================================================
ALTER TABLE articles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_story ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read"        ON articles;
DROP POLICY IF EXISTS "Allow public read access" ON articles;
CREATE POLICY "Allow public read" ON articles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read"        ON stories;
DROP POLICY IF EXISTS "Allow public read access" ON stories;
CREATE POLICY "Allow public read" ON stories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read"        ON article_story;
DROP POLICY IF EXISTS "Allow public read access" ON article_story;
CREATE POLICY "Allow public read" ON article_story FOR SELECT USING (true);

-- If you do want authenticated client writes, uncomment:
-- CREATE POLICY "auth can insert articles"  ON articles      FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "auth can update articles"  ON articles      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "auth can insert stories"   ON stories       FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "auth can update stories"   ON stories       FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "auth can insert a_s"       ON article_story FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "auth can update a_s"       ON article_story FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ================================================
-- 7) VERIFY
-- ================================================
SELECT 'Tables present:' AS status;
SELECT table_name
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND table_name IN ('articles','stories','article_story','feed_registry','job_queue')
ORDER BY table_name;
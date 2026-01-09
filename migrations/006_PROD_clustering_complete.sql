-- TTRC-142 Production Migration: Story Clustering
-- This is the COMPLETE migration for production deployment
-- Combines migrations 004 and 005 with all fixes applied

BEGIN;

-- ============================================
-- PART 1: From migration 004_clustering_function.sql
-- ============================================

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add missing columns to articles table if they don't exist
ALTER TABLE articles 
  ADD COLUMN IF NOT EXISTS url_canonical TEXT,
  ADD COLUMN IF NOT EXISTS url_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_domain TEXT,
  ADD COLUMN IF NOT EXISTS primary_actor TEXT,
  ADD COLUMN IF NOT EXISTS categories TEXT[];

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_articles_url_hash ON articles(url_hash);
CREATE INDEX IF NOT EXISTS idx_articles_source_domain ON articles(source_domain);
CREATE INDEX IF NOT EXISTS idx_articles_primary_actor ON articles(primary_actor) WHERE primary_actor IS NOT NULL;

-- ============================================
-- CRITICAL FIX: article_story table constraints
-- ============================================

-- Fix similarity_score column to handle 0-100 range (not 0-1)
ALTER TABLE article_story 
  ALTER COLUMN similarity_score TYPE NUMERIC(5,2);

-- Drop old constraint if exists
ALTER TABLE article_story 
  DROP CONSTRAINT IF EXISTS article_story_similarity_score_check;

-- Add correct constraint for 0-100 range
ALTER TABLE article_story 
  ADD CONSTRAINT article_story_similarity_score_check 
  CHECK (similarity_score >= 0 AND similarity_score <= 100);

-- Ensure one article can only link to one story
CREATE UNIQUE INDEX IF NOT EXISTS ux_article_story_unique
  ON article_story(article_id);

-- Also create with alternate name for compatibility
CREATE UNIQUE INDEX IF NOT EXISTS ux_article_story_article
  ON article_story(article_id);

CREATE INDEX IF NOT EXISTS idx_article_story_story
  ON article_story(story_id);

CREATE INDEX IF NOT EXISTS idx_stories_recent
  ON stories(first_seen_at DESC)
  WHERE status = 'active';

-- Add primary_actor column to stories if missing
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS primary_actor TEXT;

-- ============================================
-- PART 2: Main clustering function
-- ============================================

CREATE OR REPLACE FUNCTION attach_or_create_story(
  _article_id TEXT,
  _title TEXT,
  _url TEXT,
  _url_canonical TEXT,
  _url_hash TEXT,
  _published_at TIMESTAMPTZ,
  _source_name TEXT,
  _source_domain TEXT,
  _primary_actor TEXT DEFAULT NULL,
  _categories TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_story_id TEXT;
  v_is_new BOOLEAN;
  v_similarity_score NUMERIC(5,2);
  v_status TEXT;
BEGIN
  -- Check if article already clustered
  SELECT story_id INTO v_story_id
  FROM article_story
  WHERE article_id = _article_id;
  
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_clustered',
      'story_id', v_story_id,
      'created', false
    );
  END IF;

  -- Find candidate stories (simplified for MVP)
  SELECT s.id, 75.0 INTO v_story_id, v_similarity_score
  FROM stories s
  WHERE s.status = 'active'
    AND s.first_seen_at > NOW() - INTERVAL '7 days'
    AND (
      s.primary_actor = _primary_actor OR
      s.primary_headline ILIKE '%' || _primary_actor || '%'
    )
  ORDER BY s.first_seen_at DESC
  LIMIT 1;

  -- Create new story if no match found
  IF v_story_id IS NULL THEN
    INSERT INTO stories (
      id,
      primary_headline,
      primary_url,
      primary_source,
      primary_actor,
      first_seen_at,
      last_seen_at,
      article_count,
      status
    ) VALUES (
      'story-' || substr(md5(random()::text), 1, 16),
      _title,
      _url,
      _source_name,
      _primary_actor,
      _published_at,
      _published_at,
      1,
      'active'
    ) RETURNING id INTO v_story_id;
    
    v_is_new := true;
    v_similarity_score := 100.0;
  ELSE
    v_is_new := false;
    -- Update story metadata
    UPDATE stories 
    SET 
      last_seen_at = GREATEST(last_seen_at, _published_at),
      article_count = article_count + 1
    WHERE id = v_story_id;
  END IF;

  -- Create the link (cap score at 100 for safety)
  v_similarity_score := LEAST(v_similarity_score, 100);
  
  INSERT INTO article_story (
    article_id,
    story_id,
    similarity_score,
    is_primary,
    matched_at
  ) VALUES (
    _article_id,
    v_story_id,
    v_similarity_score,
    v_is_new,
    NOW()
  ) ON CONFLICT (article_id) DO NOTHING;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_is_new THEN 'created' ELSE 'attached' END,
    'story_id', v_story_id,
    'created', v_is_new,
    'similarity_score', v_similarity_score
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'error',
    'error', SQLERRM,
    'story_id', NULL,
    'created_new', false,
    'score', 0
  );
END $$;

-- ============================================
-- PART 3: From migration 005 - Update upsert function
-- ============================================

-- Drop old version first (different return type)
DROP FUNCTION IF EXISTS upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
);

-- Create updated function with clustering support
CREATE OR REPLACE FUNCTION upsert_article_and_enqueue(
  _url text,
  _headline text,
  _content text,
  _feed_id text,
  _source_name text,
  _published_at timestamptz,
  _source_domain text,
  _content_type text,
  _is_opinion boolean,
  _metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  _url_hash text;
  _url_canonical text;
  _published_date date;
  _generated_id text;
  _row record;
  _is_new boolean := FALSE;
  _process_job_id bigint;
  _cluster_job_id bigint;
BEGIN
  -- Normalize and hash URL
  _url_canonical := LOWER(TRIM(_url));
  _url_hash := encode(digest(_url_canonical, 'sha256'), 'hex');
  
  -- Extract date for composite uniqueness
  _published_date := DATE(COALESCE(_published_at, now()) AT TIME ZONE 'UTC');
  
  -- Generate ID for new records
  _generated_id := 'pe-' || _url_hash || '-' || to_char(_published_date, 'YYYYMMDD');
  
  -- Upsert article
  INSERT INTO articles (
    id,
    title,
    url,
    url_hash,
    url_canonical,
    source_name,
    source_domain,
    published_at,
    content,
    content_type,
    is_opinion,
    metadata,
    feed_id,
    created_at,
    updated_at
  ) VALUES (
    _generated_id,
    _headline,
    _url,
    _url_hash,
    _url_canonical,
    _source_name,
    _source_domain,
    _published_at,
    _content,
    COALESCE(_content_type, 'news_report'),
    COALESCE(_is_opinion, false),
    COALESCE(_metadata, '{}'::jsonb),
    _feed_id,
    now(),
    now()
  )
  ON CONFLICT (url_hash, published_at) 
  DO UPDATE SET
    updated_at = now(),
    metadata = COALESCE(articles.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
  RETURNING *, (xmax = 0) AS is_new INTO _row;
  
  _is_new := _row.is_new;
  
  -- Only enqueue jobs for new articles
  IF _is_new THEN
    -- Enqueue processing job
    INSERT INTO job_queue (
      job_type,
      payload,
      status,
      run_at
    ) VALUES (
      'process_article',
      jsonb_build_object(
        'article_id', _row.id,
        'url', _url,
        'source_name', _source_name
      ),
      'pending',
      now()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING
    RETURNING id INTO _process_job_id;
    
    -- Enqueue clustering job
    INSERT INTO job_queue (
      job_type,
      payload,
      status,
      run_at
    ) VALUES (
      'story.cluster',
      jsonb_build_object(
        'article_id', _row.id,
        'title', _headline,
        'url', _url,
        'published_at', _published_at,
        'source_name', _source_name
      ),
      'pending',
      now()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING
    RETURNING id INTO _cluster_job_id;
  END IF;
  
  -- Return result as JSONB
  RETURN jsonb_build_object(
    'article_id', _row.id,
    'is_new', _is_new,
    'process_job_id', _process_job_id,
    'cluster_job_id', _cluster_job_id
  );
  
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'upsert_article_and_enqueue failed for URL %: %', _url, SQLERRM;
  RAISE;
END $$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
) TO service_role;

GRANT EXECUTE ON FUNCTION attach_or_create_story(
  text, text, text, text, text, timestamptz, text, text, text, text[]
) TO service_role;

-- ============================================
-- PART 4: Auto-clustering trigger
-- ============================================

CREATE OR REPLACE FUNCTION trigger_enqueue_clustering()
RETURNS TRIGGER AS $$
BEGIN
  -- Only for new articles, not updates
  IF TG_OP = 'INSERT' THEN
    INSERT INTO job_queue (
      job_type,
      payload,
      status,
      run_at
    ) VALUES (
      'story.cluster',
      jsonb_build_object(
        'article_id', NEW.id,
        'title', COALESCE(NEW.title, NEW.headline),
        'url', NEW.url,
        'published_at', NEW.published_at,
        'source_name', NEW.source_name
      ),
      'pending',
      now()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS trigger_enqueue_clustering ON articles;
CREATE TRIGGER trigger_enqueue_clustering
  AFTER INSERT ON articles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_enqueue_clustering();

-- ============================================
-- VERIFICATION
-- ============================================

-- Verify everything is in place
DO $$
BEGIN
  RAISE NOTICE 'TTRC-142 Clustering Migration Complete';
  RAISE NOTICE 'Verified components:';
  
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'attach_or_create_story') THEN
    RAISE NOTICE '✓ attach_or_create_story function';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'upsert_article_and_enqueue') THEN
    RAISE NOTICE '✓ upsert_article_and_enqueue function';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_enqueue_clustering') THEN
    RAISE NOTICE '✓ clustering trigger';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_article_story_article') THEN
    RAISE NOTICE '✓ unique article-story index';
  END IF;
END $$;

COMMIT;

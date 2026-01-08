-- ============================================================================
-- Migration 005: Fix RSS System Critical Issues
-- Date: 2025-09-23
-- Purpose: Align SQL function with JS implementation
-- 
-- CRITICAL: This fixes the mismatch between fetch_feed.js and the SQL function
-- ============================================================================

BEGIN;

-- Drop any existing functions with either name
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue CASCADE;
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue_jobs CASCADE;

-- Create function with correct name and signature matching JS calls
CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(
  p_url           text,
  p_title         text,
  p_content       text,
  p_published_at  timestamptz,
  p_feed_id       text,
  p_source_name   text,
  p_source_domain text,
  p_content_type  text DEFAULT 'news_report',
  p_is_opinion    boolean DEFAULT FALSE,
  p_metadata      jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb  -- Return JSONB to match JS expectations
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url_hash text;
  v_article_id text;
  v_is_new boolean;
  v_job_created boolean := false;
  v_job_id bigint;
  v_published_date date;
BEGIN
  -- Validate required fields
  IF p_url IS NULL OR p_title IS NULL THEN
    RAISE EXCEPTION 'URL and title are required';
  END IF;
  
  -- Generate URL hash (since JS doesn't pass it)
  v_url_hash := encode(digest(p_url, 'sha256'), 'hex');
  
  -- Calculate published date for constraint
  v_published_date := (p_published_at AT TIME ZONE 'UTC')::date;
  
  -- Upsert article
  INSERT INTO public.articles (
    id,
    url,
    url_hash,
    title,
    source_name,
    source_domain,
    published_at,
    published_date,
    excerpt,  -- Map content to excerpt
    content_type,
    created_at,
    updated_at
  )
  VALUES (
    'art-' || gen_random_uuid()::text,
    p_url,
    v_url_hash,
    p_title,
    p_source_name,
    p_source_domain,
    p_published_at,
    v_published_date,
    left(p_content, 500),  -- Truncate content for excerpt
    p_content_type,
    now(),
    now()
  )
  ON CONFLICT (url_hash, published_date)
  DO UPDATE SET
    title = EXCLUDED.title,
    source_name = COALESCE(EXCLUDED.source_name, articles.source_name),
    source_domain = COALESCE(EXCLUDED.source_domain, articles.source_domain),
    excerpt = COALESCE(EXCLUDED.excerpt, articles.excerpt),
    updated_at = now()
  RETURNING 
    id, 
    (created_at = updated_at) 
  INTO v_article_id, v_is_new;
  
  -- Create clustering job for new articles
  IF v_is_new THEN
    BEGIN
      INSERT INTO public.job_queue (
        job_type,
        payload,
        run_at,
        status
      )
      VALUES (
        'story.cluster',
        jsonb_build_object(
          'article_id', v_article_id,
          'feed_id', p_feed_id,
          'source_name', p_source_name
        ),
        now(),
        'pending'
      )
      ON CONFLICT (job_type, payload_hash) DO NOTHING
      RETURNING id INTO v_job_id;
      
      v_job_created := (v_job_id IS NOT NULL);
    EXCEPTION WHEN OTHERS THEN
      -- Log but don't fail if job creation fails
      RAISE WARNING 'Failed to create job for article %: %', v_article_id, SQLERRM;
    END;
  END IF;
  
  -- Return JSONB matching JS expectations
  RETURN jsonb_build_object(
    'article_id', v_article_id,
    'is_new', v_is_new,
    'job_enqueued', v_job_created,
    'job_id', v_job_id
  );
  
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'upsert_article_and_enqueue_jobs failed: %', SQLERRM;
  RAISE;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs TO authenticated;

-- Ensure articles table has all required columns
ALTER TABLE articles 
ADD COLUMN IF NOT EXISTS title text;

-- Add the missing published_date column if not exists
ALTER TABLE articles 
ADD COLUMN IF NOT EXISTS published_date date 
GENERATED ALWAYS AS ((published_at AT TIME ZONE 'UTC')::date) STORED;

-- Add excerpt column if missing
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS excerpt text;

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_articles_urlhash_day'
  ) THEN
    ALTER TABLE articles 
    ADD CONSTRAINT uq_articles_urlhash_day 
    UNIQUE (url_hash, published_date);
  END IF;
END$$;

-- Ensure job_queue has payload_hash for idempotency
ALTER TABLE job_queue
ADD COLUMN IF NOT EXISTS payload_hash text
GENERATED ALWAYS AS (
  encode(digest(coalesce(payload::text,''), 'sha256'), 'hex')
) STORED;

-- Create index for job queue idempotency if not exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_type_hash
ON job_queue (job_type, payload_hash);

-- Add status column to job_queue if missing
ALTER TABLE job_queue
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

COMMIT;

-- ============================================================================
-- Verification Queries (run these after migration to confirm success)
-- ============================================================================

/*
-- Test the function
SELECT * FROM upsert_article_and_enqueue_jobs(
  p_url := 'https://test.com/article-' || extract(epoch from now()),
  p_title := 'Test Article',
  p_content := 'Test content here',
  p_published_at := now(),
  p_feed_id := 'test-feed',
  p_source_name := 'Test Source',
  p_source_domain := 'test.com'
);

-- Verify articles table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'articles'
  AND column_name IN ('title', 'url_hash', 'published_date', 'excerpt')
ORDER BY ordinal_position;

-- Check constraints
SELECT 
  conname,
  contype
FROM pg_constraint
WHERE conrelid = 'articles'::regclass
  AND conname = 'uq_articles_urlhash_day';

-- Verify function exists with correct name
SELECT 
  proname,
  pronargs as param_count
FROM pg_proc
WHERE proname = 'upsert_article_and_enqueue_jobs';
*/

-- P1 Fix: Atomic Article Upsert + Job Enqueue
-- Prevents orphaned articles and ensures data consistency
-- Part of TTRC-140 RSS Fetcher implementation

BEGIN;

-- Create atomic function for article upsert + job enqueue
CREATE OR REPLACE FUNCTION upsert_article_and_enqueue(
  _url text,
  _url_hash text,
  _headline text,
  _source_name text,
  _source_domain text,
  _published_at timestamptz,
  _content text DEFAULT NULL,
  _content_type text DEFAULT 'news_report',
  _opinion_flag boolean DEFAULT FALSE,
  _metadata jsonb DEFAULT '{}'::jsonb
) 
RETURNS TABLE(article_id text, enqueued boolean, is_new boolean)
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE 
  _id text;
  _is_new boolean;
BEGIN
  -- Upsert article with conflict resolution
  INSERT INTO articles (
    url, 
    url_hash, 
    headline, 
    source_name, 
    source_domain, 
    published_at,
    content,
    content_type,
    opinion_flag,
    metadata,
    fetched_at
  )
  VALUES (
    _url, 
    _url_hash, 
    _headline, 
    _source_name, 
    _source_domain, 
    _published_at,
    _content,
    _content_type,
    _opinion_flag,
    _metadata,
    NOW()
  )
  ON CONFLICT (url_hash) DO UPDATE SET
    headline = EXCLUDED.headline,
    source_name = EXCLUDED.source_name,
    source_domain = EXCLUDED.source_domain,
    published_at = COALESCE(articles.published_at, EXCLUDED.published_at),
    content = COALESCE(EXCLUDED.content, articles.content),
    content_type = EXCLUDED.content_type,
    opinion_flag = EXCLUDED.opinion_flag,
    metadata = articles.metadata || EXCLUDED.metadata, -- Merge metadata
    updated_at = NOW(),
    fetched_at = NOW()
  RETURNING id, (xmax = 0) INTO _id, _is_new;

  -- Only enqueue processing job for new articles or significant updates
  IF _is_new OR OLD.headline != _headline THEN
    INSERT INTO job_queue (job_type, payload, run_at)
    VALUES (
      'process_article', 
      jsonb_build_object(
        'article_id', _id,
        'article_url', _url,
        'source_domain', _source_domain,
        'published_at', _published_at,
        'is_update', NOT _is_new
      ), 
      NOW()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING;
    
    RETURN QUERY SELECT _id::text, true, _is_new;
  ELSE
    RETURN QUERY SELECT _id::text, false, _is_new;
  END IF;
  
EXCEPTION WHEN OTHERS THEN
  -- Log error and re-raise to ensure transaction rollback
  RAISE LOG 'upsert_article_and_enqueue failed for URL %: %', _url, SQLERRM;
  RAISE;
END $$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION upsert_article_and_enqueue TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION upsert_article_and_enqueue IS 
'Atomically upserts an article and enqueues processing job. Used by RSS fetcher to ensure data consistency.';

COMMIT;

-- Verification query
SELECT 'upsert_article_and_enqueue function created successfully' as status;

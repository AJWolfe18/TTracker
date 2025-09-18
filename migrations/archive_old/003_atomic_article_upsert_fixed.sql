-- P1 Fix: Atomic Article Upsert + Job Enqueue (Fixed for political_entries table)
-- Prevents orphaned articles and ensures data consistency
-- Part of TTRC-140 RSS Fetcher implementation

BEGIN;

-- Drop the incorrect function first
DROP FUNCTION IF EXISTS upsert_article_and_enqueue;

-- Create atomic function for article upsert + job enqueue
-- FIXED: Uses political_entries table and composite unique constraint
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
  _is_new boolean := true;
  _existing_headline text;
BEGIN
  -- Check if article exists (using composite unique constraint logic)
  SELECT id, title INTO _id, _existing_headline
  FROM political_entries 
  WHERE url_hash = _url_hash 
    AND published_at::date = _published_at::date
    AND published_at > NOW() - INTERVAL '30 days';
  
  IF _id IS NOT NULL THEN
    -- Update existing article
    _is_new := false;
    UPDATE political_entries SET
      title = _headline,
      url = _url,
      source_name = _source_name,
      source_domain = _source_domain,
      published_at = COALESCE(political_entries.published_at, _published_at),
      content_type = _content_type,
      excerpt = LEFT(_content, 500),
      updated_at = NOW()
    WHERE id = _id;
  ELSE
    -- Insert new article
    INSERT INTO political_entries (
      id,
      title,
      url, 
      url_hash, 
      source_name, 
      source_domain, 
      published_at,
      content_type,
      excerpt,
      url_canonical,
      created_at,
      updated_at
    )
    VALUES (
      'pe-' || encode(gen_random_bytes(8), 'hex'),
      _headline,
      _url, 
      _url_hash, 
      _source_name, 
      _source_domain, 
      _published_at,
      _content_type,
      LEFT(_content, 500),
      _url,
      NOW(),
      NOW()
    )
    RETURNING id INTO _id;
  END IF;

  -- Only enqueue processing job for new articles or significant updates
  IF _is_new OR (_existing_headline IS NOT NULL AND _existing_headline != _headline) THEN
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
'Atomically upserts an article in political_entries and enqueues processing job. Uses composite uniqueness strategy.';

COMMIT;

-- Verification query
SELECT 'upsert_article_and_enqueue function updated for political_entries table' as status;

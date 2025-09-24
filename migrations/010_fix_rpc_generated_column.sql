-- FIX: Create corrected RPC function that doesn't insert into GENERATED columns
-- Minimal changes - just removes published_date from INSERT

BEGIN;

-- Drop the broken function
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue_jobs CASCADE;

-- Create the FIXED function (keeping same signature and behavior)
CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(
  p_url text,
  p_title text,
  p_content text,
  p_published_at timestamptz,
  p_feed_id text,
  p_source_name text,
  p_source_domain text,
  p_content_type text DEFAULT 'news_report',
  p_is_opinion boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_article_id text;  -- Keep as TEXT since that's what articles table uses
  v_url_hash text;
  v_is_new boolean;
  v_job_id bigint;
  v_job_enqueued boolean := false;
BEGIN
  -- Generate URL hash for deduplication
  v_url_hash := encode(digest(p_url, 'sha256'), 'hex');
  
  -- Insert or update article (NO published_date in INSERT - it's GENERATED)
  INSERT INTO public.articles (
    id,
    url,
    url_hash,
    title,
    excerpt,  -- First 500 chars
    content,  -- Full content
    source_name,
    source_domain,
    published_at,
    content_type,
    opinion_flag,  -- Use the actual column name
    metadata,
    created_at,
    updated_at
  ) VALUES (
    'art-' || gen_random_uuid()::text,  -- Keep TEXT ID format
    p_url,
    v_url_hash,
    p_title,
    LEFT(p_content, 500),  -- excerpt is first 500 chars
    p_content,             -- full content
    p_source_name,
    p_source_domain,
    p_published_at,
    p_content_type,
    p_is_opinion,  -- Maps to opinion_flag column
    p_metadata,
    NOW(),
    NOW()
  )
  ON CONFLICT (url_hash, published_date) DO UPDATE SET
    title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    content = EXCLUDED.content,
    source_name = EXCLUDED.source_name,
    source_domain = EXCLUDED.source_domain,
    content_type = EXCLUDED.content_type,
    opinion_flag = EXCLUDED.opinion_flag,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING id, (created_at = updated_at) INTO v_article_id, v_is_new;
  
  -- Create process_article job (use job_type only, not type)
  BEGIN
    INSERT INTO public.job_queue (
      job_type,
      payload,
      status,
      run_at,
      created_at
    ) VALUES (
      'process_article',
      jsonb_build_object(
        'article_id', v_article_id,
        'article_url', p_url,
        'source_domain', p_source_domain,
        'feed_id', p_feed_id,
        'is_new', v_is_new
      ),
      'pending',
      NOW(),
      NOW()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING
    RETURNING id INTO v_job_id;
    
    v_job_enqueued := (v_job_id IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    -- If job creation fails, log but don't fail the whole operation
    RAISE WARNING 'Failed to create job: %', SQLERRM;
    v_job_enqueued := false;
  END;
  
  -- Return result as JSONB
  RETURN jsonb_build_object(
    'article_id', v_article_id,
    'is_new', v_is_new,
    'job_enqueued', v_job_enqueued,
    'job_id', v_job_id
  );
END;
$$;

-- Grant permissions - ONLY service_role for security
GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs(
  text, text, text, timestamptz, text, text, text, text, boolean, jsonb
) TO service_role;

-- Remove permissions from public/anon/authenticated
REVOKE ALL ON FUNCTION public.upsert_article_and_enqueue_jobs(
  text, text, text, timestamptz, text, text, text, text, boolean, jsonb
) FROM PUBLIC, anon, authenticated;

-- Add helpful comment
COMMENT ON FUNCTION public.upsert_article_and_enqueue_jobs IS 
  'FIXED VERSION: Upserts article to articles table. Does NOT insert into GENERATED column published_date. 
   Maps p_is_opinion to opinion_flag column. Uses TEXT id as expected by articles table.';

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify it works (run this separately, not in migration):
-- SELECT public.upsert_article_and_enqueue_jobs(
--   'https://test.com/test',
--   'Test',
--   'Content',
--   NOW(),
--   'feed-1',
--   'Source',
--   'test.com',
--   'news_report',
--   false,
--   '{}'::jsonb
-- );

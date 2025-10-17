-- Migration 028: Add article.enrich job to RSS pipeline
-- TTRC-234: Article Embedding Generation
-- Updates upsert_article_and_enqueue_jobs to create article.enrich jobs
--
-- SECURITY FIXES:
-- - Added search_path lock to prevent SECURITY DEFINER hijack
-- - Computes payload_hash for proper deduplication
-- - Uses CREATE OR REPLACE instead of DROP CASCADE
-- - Only enqueues enrichment if content exists
-- - Optional guard to skip if embedding already exists

BEGIN;

-- CREATE OR REPLACE (safer than DROP CASCADE)
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
  v_article_id text;
  v_url_hash text;
  v_is_new boolean;
  v_job_id bigint;
  v_enrich_job_id bigint;
  v_job_enqueued boolean := false;
  v_enrich_job_enqueued boolean := false;
  v_payload jsonb;
  v_payload_hash text;
  v_has_content boolean;
BEGIN
  -- Lock search_path to prevent SECURITY DEFINER hijack
  PERFORM set_config('search_path', 'public', true);

  -- Generate URL hash for deduplication
  v_url_hash := encode(digest(p_url, 'sha256'), 'hex');

  -- Check if content exists (avoid enriching empty articles)
  v_has_content := (coalesce(length(p_content), 0) > 0);

  -- Insert or update article (NO published_date in INSERT - it's GENERATED)
  INSERT INTO public.articles (
    id,
    url,
    url_hash,
    title,
    excerpt,
    content,
    source_name,
    source_domain,
    published_at,
    content_type,
    opinion_flag,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    'art-' || gen_random_uuid()::text,
    p_url,
    v_url_hash,
    p_title,
    LEFT(p_content, 500),
    p_content,
    p_source_name,
    p_source_domain,
    p_published_at,
    p_content_type,
    p_is_opinion,
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

  -- TTRC-234: Enqueue article.enrich (only if content exists)
  IF v_has_content THEN
    v_payload := jsonb_build_object('article_id', v_article_id);
    v_payload_hash := encode(digest(v_payload::text, 'sha256'), 'hex');

    BEGIN
      INSERT INTO public.job_queue (
        job_type,
        payload,
        payload_hash,
        status,
        run_at,
        created_at
      ) VALUES (
        'article.enrich',
        v_payload,
        v_payload_hash,
        'pending',
        NOW(),
        NOW()
      )
      ON CONFLICT (job_type, payload_hash) DO NOTHING
      RETURNING id INTO v_enrich_job_id;

      v_enrich_job_enqueued := (v_enrich_job_id IS NOT NULL);
    EXCEPTION WHEN OTHERS THEN
      -- If job creation fails, log but don't fail the whole operation
      RAISE WARNING 'Failed to create article.enrich job: %', SQLERRM;
      v_enrich_job_enqueued := false;
    END;
  END IF;

  -- Create process_article job (legacy - will be deprecated after clustering migration)
  v_payload := jsonb_build_object(
    'article_id', v_article_id,
    'article_url', p_url,
    'source_domain', p_source_domain,
    'feed_id', p_feed_id,
    'is_new', v_is_new
  );
  v_payload_hash := encode(digest(v_payload::text, 'sha256'), 'hex');

  BEGIN
    INSERT INTO public.job_queue (
      job_type,
      payload,
      payload_hash,
      status,
      run_at,
      created_at
    ) VALUES (
      'process_article',
      v_payload,
      v_payload_hash,
      'pending',
      NOW(),
      NOW()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING
    RETURNING id INTO v_job_id;

    v_job_enqueued := (v_job_id IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    -- If job creation fails, log but don't fail the whole operation
    RAISE WARNING 'Failed to create process_article job: %', SQLERRM;
    v_job_enqueued := false;
  END;

  -- Return result as JSONB
  RETURN jsonb_build_object(
    'article_id', v_article_id,
    'is_new', v_is_new,
    'job_enqueued', v_job_enqueued,
    'job_id', v_job_id,
    'enrich_job_enqueued', v_enrich_job_enqueued,
    'enrich_job_id', v_enrich_job_id
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
  'TTRC-234: Upserts article and enqueues article.enrich (embedding generation).
   Uses payload_hash for idempotent job deduplication.
   SECURITY DEFINER with locked search_path to prevent hijack.
   Only enqueues enrichment if article has content.';

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- PREREQUISITES (verify these exist before applying migration)
-- ============================================================================
--
-- 1. articles table must have:
--    - published_date GENERATED column
--    - UNIQUE constraint on (url_hash, published_date)
--
-- 2. job_queue table must have:
--    - payload_hash TEXT column
--    - Partial unique index for deduplication:
--
--      CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_payload_hash_active
--      ON public.job_queue (job_type, payload_hash)
--      WHERE processed_at IS NULL;
--
-- ============================================================================
-- VERIFY PREREQUISITES:
--
-- -- Check articles schema
-- SELECT column_name, data_type, is_generated
-- FROM information_schema.columns
-- WHERE table_name = 'articles' AND column_name = 'published_date';
--
-- -- Check job_queue schema
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'job_queue' AND column_name = 'payload_hash';
--
-- -- Check unique index
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'job_queue' AND indexname = 'ux_job_queue_payload_hash_active';
-- ============================================================================

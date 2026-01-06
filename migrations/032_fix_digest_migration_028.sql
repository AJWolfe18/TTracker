-- Migration 032: Fix digest() in Migration 028 function
-- Date: 2025-11-15
-- Issue: Migration 028's upsert_article_and_enqueue_jobs uses unqualified digest() + wrong arg type
-- Related: TTRC-268/272, Migration 031 (fixed different overload)
-- Fix: Replace digest(text, ...) with extensions.digest(convert_to(text, 'UTF8'), ...)
--
-- Background:
-- Migration 031 fixed the OLD signature (with p_url_hash, p_categories, etc)
-- But Migration 028 created a NEW signature (with p_source_domain, p_is_opinion, etc)
-- The RSS worker calls the Migration 028 version, which still has the digest() bugs
--
-- Fixes needed:
-- 1. Line 47: v_url_hash := encode(digest(p_url, 'sha256'), 'hex');
-- 2. Line 69: 'art-' || gen_random_uuid()::text
-- 3. Line 99: encode(digest(v_payload::text, 'sha256'), 'hex')
-- 4. Line 136: encode(digest(v_payload::text, 'sha256'), 'hex')
-- 5. MUST FIX: ON CONFLICT target must match partial index (payload_hash WHERE processed_at IS NULL)
-- 6. MUST FIX: p_feed_id TEXT → articles.feed_id BIGINT needs explicit cast

BEGIN;

-- Drop existing overload before recreating (required when changing function body with RETURNS clause)
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue_jobs(
  text, text, text, timestamptz, text, text, text, text, boolean, jsonb
);

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

  -- Guard against NULL/blank URLs (fail fast)
  IF coalesce(trim(p_url), '') = '' THEN
    RAISE EXCEPTION 'p_url is required';
  END IF;

  -- Generate URL hash for deduplication (✅ FIXED: added extensions. + convert_to)
  v_url_hash := encode(extensions.digest(convert_to(p_url, 'UTF8'), 'sha256'), 'hex');

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
    feed_id,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    'art-' || extensions.gen_random_uuid()::text,  -- ✅ FIXED: added extensions.
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
    p_feed_id::bigint,  -- ✅ FIXED: Cast TEXT → BIGINT to match schema
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
    feed_id = EXCLUDED.feed_id,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING id, (created_at = updated_at) INTO v_article_id, v_is_new;

  -- TTRC-234: Enqueue article.enrich (only if content exists)
  IF v_has_content THEN
    v_payload := jsonb_build_object('article_id', v_article_id);
    v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');  -- ✅ FIXED

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
      ON CONFLICT (payload_hash) WHERE (processed_at IS NULL) DO NOTHING  -- ✅ FIXED: Match partial index
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
    'feed_id', (p_feed_id::bigint),  -- ✅ FIXED: Cast to BIGINT to match table type, avoid "123" vs 123 dup jobs
    'is_new', v_is_new
  );
  v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');  -- ✅ FIXED

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
    ON CONFLICT (payload_hash) WHERE (processed_at IS NULL) DO NOTHING  -- ✅ FIXED: Match partial index
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

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verification: Confirm function uses extensions.digest()
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.upsert_article_and_enqueue_jobs(text,text,text,timestamptz,text,text,text,text,boolean,jsonb)'::regprocedure
  )
  INTO v_def;

  IF v_def IS NULL OR v_def NOT LIKE '%extensions.digest%' THEN
    RAISE EXCEPTION 'Migration 032 verification FAILED: Function body missing extensions.digest()';
  END IF;

  IF v_def NOT LIKE '%convert_to%' THEN
    RAISE EXCEPTION 'Migration 032 verification FAILED: Function body missing convert_to()';
  END IF;

  RAISE NOTICE 'Migration 032 verification PASSED: Function uses extensions.digest() with convert_to()';
END$$;

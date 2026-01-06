-- Migration 031: Fix digest() schema qualification and argument types
-- Date: 2025-11-15
-- Issue: Migration 030 uses unqualified digest() and passes TEXT instead of BYTEA
-- Related: TTRC-268/272 follow-up
-- Fix: Replace digest(text, ...) with extensions.digest(convert_to(text, 'UTF8'), ...)
--
-- Background:
-- Migration 030 introduced two problems with digest() calls:
-- 1. Unqualified function name (digest instead of extensions.digest)
-- 2. Wrong argument type (TEXT instead of BYTEA)
--
-- The digest() function signature is: digest(data BYTEA, type TEXT) RETURNS BYTEA
-- When RPC called digest(p_url, 'sha256'), PostgreSQL tried digest(TEXT, unknown) which fails.
--
-- This migration fixes both issues:
-- 1. Explicitly qualify: extensions.digest()
-- 2. Convert TEXT to BYTEA: convert_to(p_url, 'UTF8')
--
-- Result: encode(extensions.digest(convert_to(p_url, 'UTF8'), 'sha256'), 'hex')

BEGIN;

-- Drop and recreate the function with properly qualified digest() calls
CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(
  p_url TEXT,
  p_url_hash TEXT DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_author TEXT DEFAULT NULL,
  p_published_at TIMESTAMPTZ DEFAULT NULL,
  p_content TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_media_url TEXT DEFAULT NULL,
  p_feed_id BIGINT DEFAULT NULL,
  p_source_name TEXT DEFAULT NULL,
  p_guid TEXT DEFAULT NULL,
  p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_enable_enrichment BOOLEAN DEFAULT TRUE
)
RETURNS void  -- Changed from TABLE(...) to void in Migration 030
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url_hash TEXT;
  v_article_id TEXT;
  v_existing_article_id TEXT;
  v_pub_date DATE;
  v_payload JSONB;
  v_payload_hash TEXT;
  v_job_exists BOOLEAN;
BEGIN
  -- 1. Compute URL hash if not provided (using EXPLICIT schema qualification + BYTEA conversion)
  v_url_hash := COALESCE(
    p_url_hash,
    encode(extensions.digest(convert_to(p_url, 'UTF8'), 'sha256'), 'hex')  -- ✅ FIXED: Added extensions. prefix + convert_to for BYTEA
  );

  -- 2. Extract publication date (for composite unique key)
  v_pub_date := COALESCE(p_published_at::DATE, CURRENT_DATE);

  -- 3. Check if article already exists (by url_hash + published_date)
  SELECT id INTO v_existing_article_id
  FROM public.articles
  WHERE url_hash = v_url_hash
    AND published_date = v_pub_date
  LIMIT 1;

  -- 4. If article exists, return early (no-op)
  IF v_existing_article_id IS NOT NULL THEN
    RETURN;  -- Article already exists, nothing to do
  END IF;

  -- 5. Generate new article ID (using EXPLICIT schema qualification)
  v_article_id := 'art-' || extensions.gen_random_uuid()::TEXT;  -- ✅ FIXED: Added extensions. prefix

  -- 6. Insert new article (will fail if duplicate due to UNIQUE constraint)
  INSERT INTO public.articles (
    id,
    url,
    url_hash,
    title,
    author,
    published_at,
    published_date,
    content,
    summary,
    media_url,
    feed_id,
    source_name,
    guid,
    categories,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    v_article_id,
    p_url,
    v_url_hash,
    p_title,
    p_author,
    p_published_at,
    v_pub_date,
    p_content,
    p_summary,
    p_media_url,
    p_feed_id,
    p_source_name,
    p_guid,
    p_categories,
    p_metadata,
    NOW(),
    NOW()
  )
  ON CONFLICT (url_hash, published_date) DO NOTHING;

  -- 7. Enqueue story.cluster job (idempotent via payload_hash deduplication)
  v_payload := jsonb_build_object(
    'article_id', v_article_id,
    'created_at', NOW()::TEXT
  );

  -- Compute payload hash (using EXPLICIT schema qualification + BYTEA conversion)
  v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');  -- ✅ FIXED: Added extensions. prefix + convert_to for BYTEA

  -- Check if identical job already exists (active jobs only)
  SELECT EXISTS (
    SELECT 1
    FROM public.job_queue
    WHERE job_type = 'story.cluster'
      AND payload_hash = v_payload_hash
      AND status IN ('pending', 'claimed')
      AND processed_at IS NULL
  ) INTO v_job_exists;

  -- Insert job only if not already queued
  IF NOT v_job_exists THEN
    INSERT INTO public.job_queue (
      job_type,
      payload,
      payload_hash,
      status,
      created_at
    ) VALUES (
      'story.cluster',
      v_payload,
      v_payload_hash,
      'pending',
      NOW()
    )
    ON CONFLICT (payload_hash) WHERE (processed_at IS NULL) DO NOTHING;
  END IF;

  -- 8. Enqueue process_article job (for enrichment, if enabled)
  IF p_enable_enrichment THEN
    v_payload := jsonb_build_object(
      'article_id', v_article_id,
      'created_at', NOW()::TEXT
    );

    -- Compute payload hash (using EXPLICIT schema qualification + BYTEA conversion)
    v_payload_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');  -- ✅ FIXED: Added extensions. prefix + convert_to for BYTEA

    -- Check if identical job already exists (active jobs only)
    SELECT EXISTS (
      SELECT 1
      FROM public.job_queue
      WHERE job_type = 'process_article'
        AND payload_hash = v_payload_hash
        AND status IN ('pending', 'claimed')
        AND processed_at IS NULL
    ) INTO v_job_exists;

    -- Insert job only if not already queued
    IF NOT v_job_exists THEN
      INSERT INTO public.job_queue (
        job_type,
        payload,
        payload_hash,
        status,
        created_at
      ) VALUES (
        'process_article',
        v_payload,
        v_payload_hash,
        'pending',
        NOW()
      )
      ON CONFLICT (payload_hash) WHERE (processed_at IS NULL) DO NOTHING;
    END IF;
  END IF;

  -- Return void (Migration 030 changed return type from TABLE to void)
  RETURN;
END;
$$;

-- Restore grants with full signature (avoids overload ambiguity)
GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT[], JSONB, BOOLEAN
) TO anon;

GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT[], JSONB, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT[], JSONB, BOOLEAN
) TO service_role;

COMMIT;

-- Verification: Confirm function uses extensions.digest()
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.upsert_article_and_enqueue_jobs(text,text,text,text,timestamptz,text,text,text,bigint,text,text,text[],jsonb,boolean)'::regprocedure
  )
  INTO v_def;

  IF v_def IS NULL OR v_def NOT LIKE '%extensions.digest%' THEN
    RAISE EXCEPTION 'Migration 031 verification FAILED: Function body missing extensions.digest()';
  END IF;

  RAISE NOTICE 'Migration 031 verification PASSED: Function uses extensions.digest()';
END$$;

-- Optional: List all overloads for debugging (informational only)
DO $$
DECLARE
  sig TEXT;
BEGIN
  RAISE NOTICE 'All upsert_article_and_enqueue_jobs overloads:';
  FOR sig IN
    SELECT (p.oid::regprocedure)::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'upsert_article_and_enqueue_jobs'
    ORDER BY p.oid
  LOOP
    RAISE NOTICE '  - %', sig;
  END LOOP;
END$$;

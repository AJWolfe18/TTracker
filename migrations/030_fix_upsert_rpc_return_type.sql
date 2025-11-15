-- Migration 030: Fix upsert_article_and_enqueue_jobs return type
-- Date: 2025-11-15
-- JIRA: TTRC-268-272
--
-- Problem:
-- The upsert_article_and_enqueue_jobs RPC returns a JSONB blob which causes
-- "Cannot convert object to primitive value" errors when PostgREST tries to
-- serialize the response for the JavaScript client. This affects Guardian,
-- NYT, and other feeds with complex RSS metadata structures.
--
-- Root Cause:
-- PostgREST serialization of nested JSONB objects containing primitives fails
-- when passed through the RPC response pipeline, even though the metadata
-- sanitization in fetch_feed.js is correct.
--
-- Solution:
-- Change return type from JSONB to VOID. The JavaScript client doesn't use
-- the return value - it only needs to know if the RPC succeeded or failed
-- (which is communicated via error/no-error).
--
-- Impact:
-- - Eliminates serialization errors for all RSS feeds
-- - No JavaScript changes needed (return value was already ignored)
-- - Reduces network payload size (no unnecessary data returned)
--
-- PROD Deployment Notes:
-- This migration is safe to apply during normal operation:
-- - CREATE OR REPLACE preserves function grants
-- - No downtime required
-- - Worker restart NOT needed (change is server-side only)
-- - Backwards compatible (clients ignoring return value won't break)
--
-- Testing:
-- 1. Apply migration to TEST database
-- 2. Restart worker to reload code
-- 3. Trigger RSS fetch for Guardian/NYT feeds (feed_id 3, 182, 183)
-- 4. Verify 0% article failure rate (was 100% before fix)
-- 5. Check job_queue for "Cannot convert object" errors (should be none)

BEGIN;

-- Replace function with VOID return type
-- Preserves all grants via CREATE OR REPLACE
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
RETURNS void  -- Changed from RETURNS jsonb
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

  -- REMOVED: RETURN jsonb_build_object(...);
  -- Function now returns VOID - client doesn't use return value
  -- Success/failure is communicated via error/no-error
END;
$$;

-- Verify function signature changed successfully
DO $$
DECLARE
  v_return_type text;
BEGIN
  SELECT pg_get_function_result(oid)
  INTO v_return_type
  FROM pg_proc
  WHERE proname = 'upsert_article_and_enqueue_jobs'
    AND pronamespace = 'public'::regnamespace;

  IF v_return_type = 'void' THEN
    RAISE NOTICE '✅ Migration 030: Function return type successfully changed to VOID';
  ELSE
    RAISE EXCEPTION 'Migration 030 FAILED: Expected return type ''void'', got ''%''', v_return_type;
  END IF;
END$$;

COMMIT;

-------------------------------------------------------------------------------
-- DEPLOYMENT INSTRUCTIONS
-------------------------------------------------------------------------------
--
-- HOW TO APPLY THIS MIGRATION:
--
-- Option A: Supabase Dashboard SQL Editor (RECOMMENDED)
--   1. Open Supabase Dashboard → SQL Editor
--   2. Copy/paste this entire file
--   3. Click "Run"
--   4. Verify success message in output
--
-- Option B: psql command line
--   psql "$SUPABASE_DB_URL" -f migrations/030_fix_upsert_rpc_return_type.sql
--
-- Option C: Supabase CLI
--   supabase db push
--
-- DEPLOYMENT TIMELINE:
--   1. Apply to TEST database first
--   2. Test Guardian/NYT feeds (verify 0% error rate)
--   3. Monitor for 24 hours
--   4. Apply to PROD database (same SQL)
--
-- NO WORKER RESTART NEEDED - change is database-side only
--
-------------------------------------------------------------------------------
-- POST-MIGRATION VERIFICATION
-------------------------------------------------------------------------------
--
-- 1. Check function signature (should return "void"):
--    SELECT pg_get_function_result(oid)
--    FROM pg_proc
--    WHERE proname = 'upsert_article_and_enqueue_jobs'
--      AND pronamespace = 'public'::regnamespace;
--    Expected: "void"
--
-- 2. Test RSS fetch for Guardian Trump feed (was 100% failing):
--    INSERT INTO job_queue (job_type, payload, run_at, status)
--    VALUES ('fetch_feed',
--            '{"feed_id": 183, "url": "https://www.theguardian.com/us-news/donaldtrump/rss", "source_name": "The Guardian (Trump)"}',
--            NOW(), 'pending');
--
-- 3. Wait 2 minutes for worker to process, then check results:
--    SELECT id, feed_id, status, error
--    FROM job_queue
--    WHERE job_type = 'fetch_feed'
--      AND feed_id = 183
--    ORDER BY created_at DESC
--    LIMIT 1;
--    Expected: status = 'completed', error = null
--
-- 4. Verify NO serialization errors across all feeds:
--    SELECT COUNT(*) FROM job_queue
--    WHERE job_type = 'fetch_feed'
--      AND status = 'failed'
--      AND error LIKE '%Cannot convert object%';
--    Expected: 0
--
-- 5. Check article creation rate for Guardian/NYT (should be normal):
--    SELECT feed_id, COUNT(*) as articles_created
--    FROM articles
--    WHERE feed_id IN ('3', '182', '183')
--      AND created_at > NOW() - INTERVAL '1 hour'
--    GROUP BY feed_id;
--    Expected: 5-20 articles per feed (not 0)
--
-------------------------------------------------------------------------------
-- ROLLBACK PLAN (if needed)
-------------------------------------------------------------------------------
--
-- If issues arise, restore previous function definition:
--
-- CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(...)
-- RETURNS jsonb  -- Restore old return type
-- ...
-- RETURN jsonb_build_object(...);  -- Restore old RETURN statement
--
-- Full rollback SQL available in: migrations/028_add_article_enrich_job.sql

-- Migration: 130_upsert_article_store_feed_id_metadata.sql
-- ADO-600: PROD's upsert_article_and_enqueue_jobs (the migration-121 version: 005a plus content) never
-- writes feed_id or metadata. Checked on PROD October 11, 2026: columns exist (feed_id TEXT, no FK;
-- metadata JSONB default '{}'; opinion_flag BOOLEAN default false), and 0 of 2,276 articles in the last
-- 30 days carry a feed_id or metadata. TEST runs the 032 version, which writes all three.
--
-- What this does: replaces the 121 function with the SAME function plus two writes:
--   feed_id  = NULLIF(p_feed_id, '')            (PROD column is TEXT; kept as text, no table rewrite)
--   metadata = COALESCE(p_metadata, '{}')       (author, feed_url, original_guid, categories)
-- On conflict both keep the stored value when the new one is empty.
-- Deliberately NOT done: opinion_flag. scripts/rss/scoring.js applies an opinion penalty in clustering,
-- so writing it changes clustering on PROD; deferred until a clustering eval + a week of Judge results.
--
-- Guard: only replaces the 121 version (stores content, does not yet write metadata). On TEST (032
-- version) this is a NO-OP with a NOTICE, so it is safe to run on both. Idempotent: after one run the
-- guard no longer matches.
-- Size: metadata is about 300 bytes an article, about 0.7 MB a month. Cost: $0. Existing rows are not
-- backfilled. Rollback: re-run migrations/121_upsert_article_store_content.sql's inner CREATE (the
-- function body between $fn$ markers).

DO $migration$
DECLARE
  v_src text;
BEGIN
  v_src := (
    SELECT p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_article_and_enqueue_jobs'
       AND p.oid::regprocedure::text =
           'upsert_article_and_enqueue_jobs(text,text,text,timestamp with time zone,text,text,text,text,boolean,jsonb)'
  );

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'upsert_article_and_enqueue_jobs(10 args) not found - nothing changed';
  END IF;

  IF v_src !~ 'left\(p_content, 5000\)' OR v_src ~ 'p_metadata, ''\{\}''' THEN
    RAISE NOTICE 'upsert_article_and_enqueue_jobs is not the migration-121 version (TEST 032, or 130 already applied) - skipped, nothing changed';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(p_url text, p_title text, p_content text, p_published_at timestamp with time zone, p_feed_id text, p_source_name text, p_source_domain text, p_content_type text DEFAULT 'news_report'::text, p_is_opinion boolean DEFAULT false, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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

  -- Upsert article (ADO-597: content is stored, capped at 5,000 chars; excerpt stays its first 500)
  -- (ADO-600: feed_id and metadata are stored; opinion_flag deliberately not written yet)
  INSERT INTO public.articles (
    id,
    url,
    url_hash,
    title,
    source_name,
    source_domain,
    published_at,
    published_date,
    excerpt,
    content,
    content_type,
    feed_id,
    metadata,
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
    left(p_content, 500),
    left(p_content, 5000),
    p_content_type,
    NULLIF(p_feed_id, ''),
    COALESCE(p_metadata, '{}'::jsonb),
    now(),
    now()
  )
  ON CONFLICT (url_hash, published_date)
  DO UPDATE SET
    title = EXCLUDED.title,
    source_name = COALESCE(EXCLUDED.source_name, articles.source_name),
    source_domain = COALESCE(EXCLUDED.source_domain, articles.source_domain),
    excerpt = COALESCE(EXCLUDED.excerpt, articles.excerpt),
    content = COALESCE(EXCLUDED.content, articles.content),
    feed_id = COALESCE(EXCLUDED.feed_id, articles.feed_id),
    metadata = COALESCE(NULLIF(EXCLUDED.metadata, '{}'::jsonb), articles.metadata),
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
$function$
$fn$;

  RAISE NOTICE 'ADO-600: upsert_article_and_enqueue_jobs now stores feed_id and metadata';
END
$migration$;

-- CREATE OR REPLACE keeps the existing grants (PROD: service_role only); nothing to re-grant.

-- Verify (read-only): expect stores_content = true, stores_feed_id_metadata = true
SELECT p.oid::regprocedure AS fn,
       position('left(p_content, 5000)' IN p.prosrc) > 0 AS stores_content,
       position('NULLIF(p_feed_id, '''')' IN p.prosrc) > 0 AND position('COALESCE(p_metadata, ''{}''::jsonb)' IN p.prosrc) > 0 AS stores_feed_id_metadata
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'upsert_article_and_enqueue_jobs';

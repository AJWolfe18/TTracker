-- Migration: 121_upsert_article_store_content.sql
-- ADO-597: PROD has never stored articles.content. PROD runs the migration-005a version of
-- upsert_article_and_enqueue_jobs (read off PROD on October 2, 2026), which writes the feed text
-- only into excerpt, cut to 500 chars ("excerpt,  -- Map content to excerpt"). Migrations 028-032
-- added content (plus feed_id, opinion_flag, metadata) but never reached PROD; TEST has them.
-- Result: 0 PROD articles have content, so the Stories agent, embeddings and entity extraction
-- only ever saw 500 chars, even from full-text feeds (Fortune, ProPublica, Democracy Docket).
--
-- What this does: replaces the 005a function with the SAME function (verbatim from PROD) plus the
-- one missing write: content = left(p_content, 5000) on insert, and on conflict
-- content = COALESCE(EXCLUDED.content, articles.content). Nothing else changes: same signature,
-- same return shape, same story.cluster job insert, same search_path.
-- Deliberately NOT done here (separate card): feed_id / opinion_flag / metadata writes from 032.
-- opinion_flag feeds clustering scoring, so turning it on changes clustering and needs its own test.
--
-- Guard: only replaces a function that is still the 005a version (its "Map content to excerpt"
-- comment). On TEST (032 version, already stores content) this is a NO-OP with a NOTICE, so the
-- file is safe to run on both. Idempotent: after it runs once, the guard no longer matches.
--
-- Size: about 2,200 articles a month; blurb feeds add their ~150-char blurb again, full-text feeds
-- (about 750 a month) up to 5,000 chars. About 2.5 MB a month before TOAST compression.
-- Existing rows are not backfilled (the feeds no longer carry those items).
-- Cost: GPT-4o-mini entity extraction and embeddings read content || excerpt, so their input grows
-- for full-text feeds: about $0.10 a month. Egress: about 150 MB a month (3% of the 5 GB tier).
-- Watch: embeddings of full-text articles now use up to 2,000 chars instead of 500 (TEST has always
-- done this); check clustering-judge merges for a week after deploy.

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

  IF v_src !~ 'Map content to excerpt' THEN
    RAISE NOTICE 'upsert_article_and_enqueue_jobs is not the 005a version (already stores content?) - skipped, nothing changed';
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

  RAISE NOTICE 'ADO-597: upsert_article_and_enqueue_jobs now stores content';
END
$migration$;

-- CREATE OR REPLACE keeps the existing grants (PROD: service_role); nothing to re-grant.

-- Verify (read-only): expect stores_content = true
SELECT p.oid::regprocedure AS fn, position('left(p_content, 5000)' IN p.prosrc) > 0 AS stores_content
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'upsert_article_and_enqueue_jobs';

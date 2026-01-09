-- Migration 007: Canonicalize RSS storage to public.articles
-- FINAL CORRECTED VERSION - Targets articles table as single source of truth
-- Date: September 19, 2025
-- Purpose: Fix schema and RPC function to use articles table consistently

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid() and digest()

/* ---------------------------------------------------------------------------
   1) Normalize column naming in articles (prefer 'title')
--------------------------------------------------------------------------- */
DO $$
BEGIN
  -- If 'headline' exists and 'title' does not, rename headline -> title
  IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='articles' AND column_name='headline'
     )
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='articles' AND column_name='title'
     )
  THEN
    ALTER TABLE public.articles RENAME COLUMN headline TO title;
    RAISE NOTICE 'Renamed column: headline -> title';
  ELSIF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='articles' AND column_name='title'
     )
  THEN
    -- Ensure a title column exists if neither existed
    ALTER TABLE public.articles ADD COLUMN title text;
    RAISE NOTICE 'Added missing title column';
  END IF;
END$$;

/* ---------------------------------------------------------------------------
   2) Ensure required columns exist for the RPC function
--------------------------------------------------------------------------- */
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'news_report',
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS url_hash text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now();

/* ---------------------------------------------------------------------------
   3) Add published_date as GENERATED column for day-based uniqueness
--------------------------------------------------------------------------- */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='articles' AND column_name='published_date'
  ) THEN
    ALTER TABLE public.articles
      ADD COLUMN published_date date 
      GENERATED ALWAYS AS ((published_at AT TIME ZONE 'UTC')::date) STORED;
    RAISE NOTICE 'Added published_date GENERATED column';
  END IF;
END$$;

/* ---------------------------------------------------------------------------
   4) Add uniqueness constraint on (url_hash, published_date)
--------------------------------------------------------------------------- */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_articles_urlhash_day'
  ) THEN
    ALTER TABLE public.articles 
      ADD CONSTRAINT uq_articles_urlhash_day 
      UNIQUE (url_hash, published_date);
    RAISE NOTICE 'Added uniqueness constraint: uq_articles_urlhash_day';
  END IF;
END$$;

/* ---------------------------------------------------------------------------
   5) Ensure job_queue has proper schema for enqueuing
--------------------------------------------------------------------------- */
ALTER TABLE public.job_queue 
  ADD COLUMN IF NOT EXISTS payload_hash text GENERATED ALWAYS AS (
    encode(digest(payload::text, 'md5'), 'hex')
  ) STORED;

-- Create unique index for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_queue_jobtype_phash
  ON public.job_queue (job_type, payload_hash);

/* ---------------------------------------------------------------------------
   6) Create/Replace the atomic UPSERT + enqueue function targeting 'articles'
--------------------------------------------------------------------------- */

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue CASCADE;

CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue(
  _url           text,
  _url_hash      text,
  _headline      text,          -- mapped to 'title' column
  _source_name   text,
  _source_domain text,
  _published_at  timestamptz,
  _content       text DEFAULT NULL,
  _content_type  text DEFAULT 'news_report',
  _opinion_flag  boolean DEFAULT FALSE,
  _metadata      jsonb   DEFAULT '{}'::jsonb
)
RETURNS TABLE(article_id text, enqueued boolean, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _row public.articles%ROWTYPE;
  _is_new boolean;
  _job_created integer;
BEGIN
  -- Validate required fields
  IF _url IS NULL OR _url_hash IS NULL OR _headline IS NULL THEN
    RAISE EXCEPTION 'Required fields missing: url, url_hash, and headline are mandatory';
  END IF;
  
  -- Insert or update the article in the articles table (NOT political_entries)
  INSERT INTO public.articles (
    id, url, url_hash, title, source_name, source_domain,
    published_at, created_at, updated_at, content_type
  )
  VALUES (
    'art-' || gen_random_uuid()::text,
    _url, 
    _url_hash, 
    _headline,  -- Note: _headline parameter maps to title column
    _source_name, 
    _source_domain,
    _published_at, 
    now(), 
    now(),
    _content_type
  )
  ON CONFLICT ON CONSTRAINT uq_articles_urlhash_day
  DO UPDATE SET
    url           = EXCLUDED.url,
    title         = EXCLUDED.title,
    source_name   = EXCLUDED.source_name,
    source_domain = EXCLUDED.source_domain,
    published_at  = COALESCE(public.articles.published_at, EXCLUDED.published_at),
    content_type  = EXCLUDED.content_type,
    updated_at    = now()
  RETURNING * INTO _row;

  -- Determine if this is a new article
  _is_new := (_row.created_at = _row.updated_at);

  -- Idempotent enqueue of follow-up processing
  BEGIN
    INSERT INTO public.job_queue (job_type, payload, run_at)
    VALUES (
      'process_article',
      jsonb_build_object(
        'article_id', _row.id,
        'is_new', _is_new,
        'source_domain', _source_domain
      ),
      now()
    )
    ON CONFLICT (job_type, payload_hash) DO NOTHING;
    
    GET DIAGNOSTICS _job_created = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't fail if job creation fails
    RAISE WARNING 'Failed to enqueue job for article %: %', _row.id, SQLERRM;
    _job_created := 0;
  END;

  RETURN QUERY SELECT _row.id::text, (_job_created > 0), _is_new;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'upsert_article_and_enqueue failed for %: %', _url, SQLERRM;
  RAISE;
END
$fn$;

-- Grant execute permission (service_role for automation, authenticated for manual)
GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
) TO service_role, authenticated;

/* ---------------------------------------------------------------------------
   7) Decommission political_entries (block new writes)
--------------------------------------------------------------------------- */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='political_entries'
  ) THEN
    -- Revoke write permissions
    REVOKE INSERT, UPDATE, DELETE ON public.political_entries FROM PUBLIC;
    REVOKE INSERT, UPDATE, DELETE ON public.political_entries FROM anon, authenticated;
    
    -- Add deprecation notice
    COMMENT ON TABLE public.political_entries IS
      'DEPRECATED as of 2025-09-19: All new RSS items stored in public.articles. This table is READ-ONLY.';
    
    -- Create blocking trigger as safety net
    CREATE OR REPLACE FUNCTION block_political_entries_writes()
    RETURNS TRIGGER AS $trigger$
    BEGIN
      RAISE EXCEPTION 'Table political_entries is deprecated. Use public.articles or the upsert_article_and_enqueue RPC instead.';
      RETURN NULL;
    END;
    $trigger$ LANGUAGE plpgsql;
    
    DROP TRIGGER IF EXISTS block_writes_trigger ON public.political_entries;
    CREATE TRIGGER block_writes_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.political_entries
    FOR EACH ROW EXECUTE FUNCTION block_political_entries_writes();
    
    RAISE NOTICE 'Political_entries is now read-only with blocking trigger';
  END IF;
END$$;

/* ---------------------------------------------------------------------------
   8) Create compatibility view for gradual transition
--------------------------------------------------------------------------- */
DROP VIEW IF EXISTS political_entries_compat CASCADE;
CREATE OR REPLACE VIEW political_entries_compat AS
SELECT 
  id,
  title,
  url,
  source_name as source,
  'Politics' as category,
  2 as severity_level,
  created_at,
  updated_at,
  false as processed,
  url_hash,
  source_domain,
  source_name,
  published_at,
  published_date,
  content_type,
  LEFT(title, 200) as excerpt
FROM public.articles;

COMMENT ON VIEW political_entries_compat IS 
  'Read-only compatibility view - maps articles to old political_entries structure for transition period';

-- Final notice
DO $$ 
BEGIN
  RAISE NOTICE 'Migration 007 completed successfully';
  RAISE NOTICE 'Next steps: Update scripts to use articles table or upsert_article_and_enqueue RPC';
END $$;

COMMIT;

-- ============================================================================
-- Post-migration verification queries (run manually)
-- ============================================================================

/*
-- 1) Check constraint exists
SELECT conname FROM pg_constraint WHERE conname = 'uq_articles_urlhash_day';

-- 2) Test the RPC function
SELECT * FROM public.upsert_article_and_enqueue(
  'https://example.com/test-' || extract(epoch from now()),
  md5(random()::text),
  'Test Article ' || now()::text,
  'Test Source',
  'example.com',
  now()
);

-- 3) Verify job queue index
SELECT indexname FROM pg_indexes
WHERE tablename = 'job_queue' AND indexname = 'ux_job_queue_jobtype_phash';

-- 4) Check table counts
SELECT 'articles' as table_name, COUNT(*) as count FROM articles
UNION ALL
SELECT 'political_entries', COUNT(*) FROM political_entries;

-- 5) Verify political_entries is blocked
-- This should fail with an error:
-- INSERT INTO political_entries (id, title, url) VALUES ('test', 'test', 'http://test.com');
*/

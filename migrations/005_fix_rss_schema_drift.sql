-- 005_fix_rss_schema_drift.sql
-- Complete schema alignment for RSS system
-- Run on TEST first, then STAGING, then PROD before RSS deployment

BEGIN;

-- 0) Safety: ensure pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) feed_registry structure --------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='id'
  ) THEN
    -- Add the column
    ALTER TABLE public.feed_registry ADD COLUMN id BIGINT;
    
    -- Create sequence safely
    CREATE SEQUENCE IF NOT EXISTS public.feed_registry_id_seq;
    ALTER SEQUENCE public.feed_registry_id_seq OWNED BY public.feed_registry.id;
    
    -- Set default
    ALTER TABLE public.feed_registry
      ALTER COLUMN id SET DEFAULT nextval('public.feed_registry_id_seq');
    
    -- Backfill existing rows
    UPDATE public.feed_registry
      SET id = nextval('public.feed_registry_id_seq')
    WHERE id IS NULL;
    
    -- Drop existing PK if it exists, then add new one
    ALTER TABLE public.feed_registry DROP CONSTRAINT IF EXISTS feed_registry_pkey;
    ALTER TABLE public.feed_registry ADD CONSTRAINT feed_registry_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Add all columns including source_name (which was missing)
ALTER TABLE public.feed_registry
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS source_tier INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS topics TEXT[] DEFAULT ARRAY['politics']::TEXT[],
  ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feed_name TEXT;

-- Normalize is_active column (rename if needed, else ensure column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='is_active'
  ) THEN
    ALTER TABLE public.feed_registry RENAME COLUMN active TO is_active;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='feed_registry' AND column_name='is_active'
  ) THEN
    ALTER TABLE public.feed_registry ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Backfill topics & feed_name before constraints/indexes
UPDATE public.feed_registry
SET topics = ARRAY['politics']::TEXT[]
WHERE topics IS NULL OR cardinality(topics) = 0;

UPDATE public.feed_registry
SET feed_name = COALESCE(feed_name, source_name, 'Unknown Feed')
WHERE feed_name IS NULL;

UPDATE public.feed_registry
SET source_name = COALESCE(source_name, feed_name, 'Unknown Source')
WHERE source_name IS NULL;

-- Check for duplicates before creating unique index
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT feed_url FROM public.feed_registry
    GROUP BY feed_url HAVING COUNT(*) > 1
  ) dups;
  
  IF dup_count > 0 THEN
    -- Clean up duplicates automatically (keep lowest id)
    WITH ranked AS (
      SELECT id, feed_url,
             ROW_NUMBER() OVER (PARTITION BY feed_url ORDER BY id) AS rn
      FROM public.feed_registry
    )
    DELETE FROM public.feed_registry fr
    USING ranked r
    WHERE fr.id = r.id AND r.rn > 1;
    
    RAISE NOTICE 'Cleaned up % duplicate feed_urls', dup_count;
  END IF;
END $$;

-- Now safe to create unique index
CREATE UNIQUE INDEX IF NOT EXISTS ux_feed_registry_feed_url
  ON public.feed_registry (feed_url);

-- 2) articles structure -------------------------------------------------------
-- Ensure published_at exists before adding generated column
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Add generated published_date if missing
DO $$
DECLARE
  col_exists boolean;
  is_generated char;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='articles' AND column_name='published_date'
  ) INTO col_exists;
  
  IF col_exists THEN
    -- Check if it's already generated
    SELECT attgenerated INTO is_generated
    FROM pg_attribute
    WHERE attrelid = 'public.articles'::regclass
    AND attname = 'published_date';
    
    IF is_generated != 's' THEN
      RAISE NOTICE 'published_date exists but is not GENERATED - skipping to avoid data loss';
    END IF;
  ELSE
    -- Safe to add as generated column
    ALTER TABLE public.articles
      ADD COLUMN published_date DATE GENERATED ALWAYS AS (DATE(published_at)) STORED;
  END IF;
END $$;

-- Add other required columns
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS source_domain TEXT;

-- 3) job_queue structure ------------------------------------------------------
-- First ensure payload is JSONB type
DO $$
DECLARE
  payload_type text;
BEGIN
  SELECT data_type INTO payload_type
  FROM information_schema.columns
  WHERE table_schema='public' 
    AND table_name='job_queue' 
    AND column_name='payload';
  
  IF payload_type NOT IN ('json', 'jsonb') THEN
    RAISE EXCEPTION 'job_queue.payload must be json or jsonb type, found: %', payload_type;
  END IF;
END $$;

-- Add payload_hash as generated column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='payload_hash'
  ) THEN
    ALTER TABLE public.job_queue
      ADD COLUMN payload_hash TEXT
      GENERATED ALWAYS AS (
        encode(digest(convert_to(payload::text, 'UTF8'),'sha256'),'hex')
      ) STORED;
  END IF;
END $$;

-- Create unique index on (job_type, payload_hash)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='ux_job_queue_jobtype_phash'
  ) THEN
    CREATE UNIQUE INDEX ux_job_queue_jobtype_phash
      ON public.job_queue (job_type, payload_hash);
  END IF;
END $$;

-- 4) ingest_rejections table --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingest_rejections (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  feed_id BIGINT,
  reason TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_rejections_created
  ON public.ingest_rejections (created_at DESC);

-- 5) Monitoring view ----------------------------------------------------------
DROP VIEW IF EXISTS public.rss_feed_status;
CREATE VIEW public.rss_feed_status AS
SELECT
  fr.id,
  fr.feed_url,
  fr.feed_name,
  fr.is_active,
  fr.last_fetched_at,
  COUNT(a.id) FILTER (WHERE a.created_at > NOW() - INTERVAL '24 hours') AS articles_24h,
  COUNT(a.id) FILTER (WHERE a.created_at > NOW() - INTERVAL '48 hours') AS articles_48h,
  MAX(a.created_at) AS last_article_at
FROM public.feed_registry fr
LEFT JOIN public.articles a
  ON a.source_name = fr.feed_name
GROUP BY fr.id, fr.feed_url, fr.feed_name, fr.is_active, fr.last_fetched_at;

-- 6) Grants (check if roles exist first) -------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT ON public.rss_feed_status TO anon;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON public.rss_feed_status TO authenticated;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.ingest_rejections TO service_role;
    GRANT USAGE ON SEQUENCE public.ingest_rejections_id_seq TO service_role;
  END IF;
END $$;

COMMIT;

-- Post-migration verification
SELECT 'Migration completed successfully!' as status;

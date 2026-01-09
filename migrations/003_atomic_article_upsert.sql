-- 003_unified_normalization.sql
-- Idempotent migration following SR dev recommendations
-- Fixes schema conflicts and aligns job_queue columns

BEGIN;

-- 0) Prerequisites 
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) POLITICAL_ENTRIES preflight + gentle sync (using actual table name)
DO $$
DECLARE
  has_table boolean;
  has_url_canonical boolean;
  has_url_hash boolean;
  has_published_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'political_entries'
  ) INTO has_table;

  IF NOT has_table THEN
    RAISE EXCEPTION 'Expected table "political_entries" to exist (run base migration first)';
  END IF;

  -- Only add if missing; do not assume shape
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'political_entries' AND column_name = 'url_canonical'
  ) INTO has_url_canonical;

  IF NOT has_url_canonical THEN
    ALTER TABLE public.political_entries ADD COLUMN url_canonical text;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'political_entries' AND column_name = 'url_hash'
  ) INTO has_url_hash;

  IF NOT has_url_hash THEN
    ALTER TABLE public.political_entries ADD COLUMN url_hash text;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'political_entries' AND column_name = 'published_at'
  ) INTO has_published_at;

  IF NOT has_published_at THEN
    ALTER TABLE public.political_entries ADD COLUMN published_at timestamptz;
  END IF;

  -- Add other essential columns for RSS system
  ALTER TABLE public.political_entries 
    ADD COLUMN IF NOT EXISTS source_domain text,
    ADD COLUMN IF NOT EXISTS source_name text,
    ADD COLUMN IF NOT EXISTS content_type text,
    ADD COLUMN IF NOT EXISTS excerpt text;

  -- Add generated published_date for uniqueness by day
  ALTER TABLE public.political_entries
    ADD COLUMN IF NOT EXISTS published_date date
    GENERATED ALWAYS AS ( (published_at AT TIME ZONE 'UTC')::date ) STORED;

END$$;

-- 2) JOB_QUEUE unification (fix type vs job_type inconsistency)
DO $$
DECLARE
  has_type boolean;
  has_job_type boolean;
  has_payload_hash boolean;
  has_payload boolean;
  has_run_at boolean;
  has_run_after boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'type'
  ) INTO has_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'job_type'
  ) INTO has_job_type;

  -- Use the column that exists, prefer 'type' as it matches existing schema
  IF has_job_type AND NOT has_type THEN
    EXECUTE 'ALTER TABLE public.job_queue RENAME COLUMN job_type TO type';
  ELSIF NOT has_type AND NOT has_job_type THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN type text';
  END IF;

  -- Check run_at vs run_after column consistency  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'run_at'
  ) INTO has_run_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'run_after'
  ) INTO has_run_after;

  -- Use run_after consistently (matches existing schema)
  IF has_run_at AND NOT has_run_after THEN
    EXECUTE 'ALTER TABLE public.job_queue RENAME COLUMN run_at TO run_after';
  ELSIF NOT has_run_after AND NOT has_run_at THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN run_after timestamptz DEFAULT now()';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'payload_hash'
  ) INTO has_payload_hash;

  IF NOT has_payload_hash THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN payload_hash text';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_queue' AND column_name = 'payload'
  ) INTO has_payload;

  -- Backfill payload_hash deterministically
  IF has_payload THEN
    EXECUTE $sql$
      UPDATE public.job_queue
      SET payload_hash = COALESCE(payload_hash,
        md5(
          CASE
            WHEN pg_typeof(payload)::text = 'jsonb' THEN payload::text
            ELSE payload::text
          END
        )
      )
      WHERE payload_hash IS NULL
    $sql$;
  END IF;

  -- Replace legacy unique constraints with the canonical one
  -- Drop any old constraints that might conflict
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_queue_job_type_payload_hash_key'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue DROP CONSTRAINT job_queue_job_type_payload_hash_key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ux_job_queue_jobtype_phash'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue DROP CONSTRAINT ux_job_queue_jobtype_phash';
  END IF;

  -- Create canonical unique (type, payload_hash)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_queue_type_payload_hash_key'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD CONSTRAINT job_queue_type_payload_hash_key UNIQUE (type, payload_hash)';
  END IF;
END$$;

-- 3) Create unique constraint for political_entries race-free upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_political_entries_urlhash_day'
  ) THEN
    ALTER TABLE public.political_entries
      ADD CONSTRAINT uq_political_entries_urlhash_day
      UNIQUE (url_hash, published_date);
  END IF;
END$$;

-- 4) Atomic upsert function: ensure search_path + stable signature + use correct table/columns
DROP FUNCTION IF EXISTS upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
);

CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue(
  _url           text,
  _url_hash      text,
  _headline      text,
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
AS $$
DECLARE
  _row political_entries%ROWTYPE;
  _is_new boolean;
  _enq boolean := false;
BEGIN
  -- UPSERT guarded by the unique constraint on (url_hash, published_date)
  INSERT INTO public.political_entries (
    id, title, url, url_hash, source_name, source_domain,
    published_at, content_type, excerpt, url_canonical, created_at, updated_at
  )
  VALUES (
    'art-' || encode(gen_random_bytes(8), 'hex'),
    _headline,
    _url,
    _url_hash,
    _source_name,
    _source_domain,
    _published_at,
    _content_type,
    LEFT(_content, 500), -- Use excerpt field, limit length
    _url,
    now(),
    now()
  )
  ON CONFLICT ON CONSTRAINT uq_political_entries_urlhash_day
  DO UPDATE SET
    title         = EXCLUDED.title,
    url           = EXCLUDED.url,
    source_name   = EXCLUDED.source_name,
    source_domain = EXCLUDED.source_domain,
    -- keep original published_at if present
    published_at  = COALESCE(political_entries.published_at, EXCLUDED.published_at),
    content_type  = EXCLUDED.content_type,
    excerpt       = EXCLUDED.excerpt,
    url_canonical = EXCLUDED.url_canonical,
    updated_at    = now()
  RETURNING * INTO _row;

  _is_new := (_row.created_at = _row.updated_at); -- heuristic: created == updated means inserted

  -- enqueue only if new, or title changed on update
  IF _is_new OR (_row.title IS DISTINCT FROM _headline) THEN
    INSERT INTO public.job_queue (type, payload, run_after)
    VALUES (
      'process_article',
      jsonb_build_object(
        'article_id',   _row.id,
        'article_url',  _url,
        'source_domain',_source_domain,
        'published_at', _published_at,
        'is_update',    NOT _is_new
      ),
      now()
    )
    ON CONFLICT (type, payload_hash) DO NOTHING;

    _enq := TRUE;
  END IF;

  RETURN QUERY SELECT _row.id::text, _enq, _is_new;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'upsert_article_and_enqueue failed for URL %: %', _url, SQLERRM;
  RAISE;
END $$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
) TO service_role;

COMMENT ON FUNCTION upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
) IS 'Atomically upserts into political_entries (unique by url_hash+published_date UTC) and enqueues process_article idempotently via (type,payload_hash). Uses actual schema with political_entries table.';

COMMIT;

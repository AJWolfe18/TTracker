-- 004_fix_generated_columns_and_constraints.sql
-- Fixes from SR dev review - GENERATED columns and proper constraints
-- Run AFTER 003_atomic_article_upsert_production_ready.sql

BEGIN;

-- ============================================================================
-- PART 1: Fix job_queue with GENERATED payload_hash for reliable idempotency
-- ============================================================================
DO $$
DECLARE
  has_payload_hash boolean;
  is_generated_col boolean;     -- <-- renamed to avoid ambiguity
  has_job_type boolean;
  has_type boolean;
  has_run_at boolean;
  has_run_after boolean;
BEGIN
  -- Does payload_hash exist?
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'job_queue'
      AND column_name  = 'payload_hash'
  ) INTO has_payload_hash;

  -- Is payload_hash already a GENERATED column?
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'job_queue'
      AND column_name  = 'payload_hash'
      AND is_generated = 'ALWAYS'
  ) INTO is_generated_col;

  -- Fix payload_hash to be GENERATED ALWAYS
  IF has_payload_hash AND NOT is_generated_col THEN
    -- Drop existing constraints that depend on the column
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_queue_type_payload_hash_key') THEN
      EXECUTE 'ALTER TABLE public.job_queue DROP CONSTRAINT job_queue_type_payload_hash_key';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_queue_job_type_payload_hash_key') THEN
      EXECUTE 'ALTER TABLE public.job_queue DROP CONSTRAINT job_queue_job_type_payload_hash_key';
    END IF;

    EXECUTE 'ALTER TABLE public.job_queue DROP COLUMN payload_hash';
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN payload_hash text GENERATED ALWAYS AS (md5(payload::text)) STORED';

  ELSIF NOT has_payload_hash THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN payload_hash text GENERATED ALWAYS AS (md5(payload::text)) STORED';
  END IF;

  -- Column naming consistency
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='job_type'
  ) INTO has_job_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='type'
  ) INTO has_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='run_at'
  ) INTO has_run_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='run_after'
  ) INTO has_run_after;

  -- Standardize on job_type + run_at
  IF has_type AND NOT has_job_type THEN
    EXECUTE 'ALTER TABLE public.job_queue RENAME COLUMN type TO job_type';
  END IF;
  IF has_run_after AND NOT has_run_at THEN
    EXECUTE 'ALTER TABLE public.job_queue RENAME COLUMN run_after TO run_at';
  END IF;

  -- Re-check flags after renames (important!)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='job_type'
  ) INTO has_job_type;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='type'
  ) INTO has_type;

  -- Create canonical unique on (job_type, payload_hash)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='job_queue_type_payload_hash_key'
  ) THEN
    IF has_job_type THEN
      EXECUTE 'ALTER TABLE public.job_queue ADD CONSTRAINT job_queue_type_payload_hash_key UNIQUE (job_type, payload_hash)';
    ELSE
      -- fallback if a legacy DB somehow still has "type"
      EXECUTE 'ALTER TABLE public.job_queue ADD CONSTRAINT job_queue_type_payload_hash_key UNIQUE (type, payload_hash)';
    END IF;
  END IF;
  
  -- Ensure necessary columns exist for the worker
  -- Add processed_at if missing (needed for worker queries)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'processed_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN processed_at timestamptz';
  END IF;
  
  -- Add status column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'status'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN status text DEFAULT ''pending''';
  END IF;
  
  -- Add created_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'created_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN created_at timestamptz DEFAULT now()';
  END IF;
  
  -- Add attempts if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'attempts'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN attempts integer DEFAULT 0';
  END IF;
  
  -- Add error column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'error'
  ) THEN
    EXECUTE 'ALTER TABLE public.job_queue ADD COLUMN error text';
  END IF;
END$$;

-- Worker-friendly index, adapting to actual columns
DO $$
DECLARE
  has_job_type     boolean;
  has_type         boolean;
  has_run_at       boolean;
  has_processed_at boolean;
  has_completed_at boolean;
  predicate_col    text;
  key_col          text;
BEGIN
  -- columns present?
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_queue' AND column_name='job_type')
    INTO has_job_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_queue' AND column_name='type')
    INTO has_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_queue' AND column_name='run_at')
    INTO has_run_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_queue' AND column_name='processed_at')
    INTO has_processed_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='job_queue' AND column_name='completed_at')
    INTO has_completed_at;
    
  -- choose the job type column
  key_col := CASE WHEN has_job_type THEN 'job_type'
                  WHEN has_type     THEN 'type'
                  ELSE NULL END;
                  
  IF key_col IS NULL OR NOT has_run_at THEN
    RAISE NOTICE 'Skipping ready index: job type or run_at column missing';
    RETURN;
  END IF;
  
  -- choose a predicate column if available
  IF has_processed_at THEN
    predicate_col := 'processed_at';
  ELSIF has_completed_at THEN
    predicate_col := 'completed_at';
  ELSE
    predicate_col := NULL; -- no predicate; create a plain index
  END IF;
  
  -- build the index
  IF predicate_col IS NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS job_queue_ready_idx ON public.job_queue (%I, run_at)', key_col);
  ELSE
    EXECUTE format('CREATE INDEX IF NOT EXISTS job_queue_ready_idx ON public.job_queue (%I, run_at) WHERE %I IS NULL', key_col, predicate_col);
  END IF;
END$$;

-- ============================================================================
-- PART 2: Fix political_entries NULL handling for uniqueness constraint
-- ============================================================================
DO $$
DECLARE
  has_url_hash boolean;
  has_published_at boolean;
  has_created_at boolean;
  has_updated_at boolean;
BEGIN
  -- Check what columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'political_entries' 
      AND column_name = 'url_hash'
  ) INTO has_url_hash;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'political_entries' 
      AND column_name = 'published_at'
  ) INTO has_published_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'political_entries' 
      AND column_name = 'created_at'
  ) INTO has_created_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'political_entries' 
      AND column_name = 'updated_at'
  ) INTO has_updated_at;

  -- Backfill url_hash where NULL (required for uniqueness)
  IF has_url_hash THEN
    UPDATE public.political_entries
    SET url_hash = COALESCE(
      url_hash,
      CASE
        WHEN url_canonical IS NOT NULL THEN md5(url_canonical)
        WHEN url IS NOT NULL THEN md5(url)
        ELSE md5(id::text) -- Fallback to ID hash if no URL
      END
    )
    WHERE url_hash IS NULL;
    
    -- Make NOT NULL after backfill
    EXECUTE 'ALTER TABLE public.political_entries ALTER COLUMN url_hash SET NOT NULL';
  END IF;

  -- Backfill published_at where NULL (required for uniqueness)
  IF has_published_at THEN
    UPDATE public.political_entries
    SET published_at = COALESCE(
      published_at, 
      created_at,  -- Use created_at if available
      now() AT TIME ZONE 'UTC' -- Otherwise use current time
    )
    WHERE published_at IS NULL;
    
    -- Make NOT NULL after backfill
    EXECUTE 'ALTER TABLE public.political_entries ALTER COLUMN published_at SET NOT NULL';
  END IF;

  -- Ensure created_at and updated_at exist for the atomic function
  IF NOT has_created_at THEN
    EXECUTE 'ALTER TABLE public.political_entries ADD COLUMN created_at timestamptz DEFAULT now()';
    EXECUTE 'UPDATE public.political_entries SET created_at = COALESCE(published_at, now()) WHERE created_at IS NULL';
    EXECUTE 'ALTER TABLE public.political_entries ALTER COLUMN created_at SET NOT NULL';
  END IF;

  IF NOT has_updated_at THEN
    EXECUTE 'ALTER TABLE public.political_entries ADD COLUMN updated_at timestamptz DEFAULT now()';
    EXECUTE 'UPDATE public.political_entries SET updated_at = COALESCE(created_at, published_at, now()) WHERE updated_at IS NULL';
    EXECUTE 'ALTER TABLE public.political_entries ALTER COLUMN updated_at SET NOT NULL';
  END IF;
END$$;

-- Drop the old unique constraint if it exists and recreate properly
DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_political_entries_urlhash_day'
  ) THEN
    ALTER TABLE public.political_entries 
    DROP CONSTRAINT uq_political_entries_urlhash_day;
  END IF;

  -- Since we've made url_hash and published_at NOT NULL, we can use a regular constraint
  -- The published_date is GENERATED from published_at, so it will also never be NULL
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_political_entries_urlhash_day'
  ) THEN
    ALTER TABLE public.political_entries
      ADD CONSTRAINT uq_political_entries_urlhash_day
      UNIQUE (url_hash, published_date);
  END IF;
END$$;

-- ============================================================================
-- PART 3: Update atomic function to use correct column names
-- ============================================================================
-- Drop old function if exists
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
);

DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue_jobs(
  text, text, text, text, text, timestamptz, text, text, boolean, jsonb
);

-- Create updated function with correct column references
CREATE OR REPLACE FUNCTION public.upsert_article_and_enqueue_jobs(
  p_url           text,
  p_title         text,
  p_content       text,
  p_published_at  timestamptz,
  p_feed_id       text,
  p_source_name   text,
  p_source_domain text DEFAULT NULL,
  p_content_type  text DEFAULT 'news_report',
  p_is_opinion    boolean DEFAULT FALSE,
  p_metadata      jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url_hash text;
  v_article_id text;
  v_is_new boolean;
  v_job_id bigint;
BEGIN
  -- Compute URL hash
  v_url_hash := md5(p_url);
  
  -- Generate article ID
  v_article_id := 'art-' || encode(gen_random_bytes(8), 'hex');
  
  -- Upsert the article into political_entries
  INSERT INTO political_entries (
    id,
    url,
    url_canonical,
    url_hash,
    headline,
    content,
    excerpt,
    published_at,
    source_domain,
    source_name,
    content_type,
    opinion_flag,
    created_at,
    updated_at
  ) VALUES (
    v_article_id,
    p_url,
    p_url, -- Use URL as canonical for now
    v_url_hash,
    p_title,
    p_content,
    LEFT(p_content, 500), -- Excerpt is first 500 chars
    p_published_at,
    COALESCE(p_source_domain, split_part(p_url, '/', 3)), -- Extract domain if not provided
    p_source_name,
    p_content_type,
    p_is_opinion,
    now(),
    now()
  )
  ON CONFLICT (url_hash, published_date) DO UPDATE SET
    headline = EXCLUDED.headline,
    content = EXCLUDED.content,
    excerpt = EXCLUDED.excerpt,
    content_type = EXCLUDED.content_type,
    opinion_flag = EXCLUDED.opinion_flag,
    updated_at = now()
  RETURNING 
    id,
    (created_at = updated_at) AS is_new
  INTO v_article_id, v_is_new;
  
  -- Only enqueue job if this is a new article
  IF v_is_new THEN
    -- Note: Using job_type and run_at (standardized column names)
    INSERT INTO job_queue (
      job_type,
      payload,
      run_at
    ) VALUES (
      'enrich_article',
      jsonb_build_object(
        'article_id', v_article_id,
        'url', p_url,
        'feed_id', p_feed_id,
        'source_name', p_source_name
      ),
      now()
    )
    -- The GENERATED payload_hash column will automatically be computed
    ON CONFLICT (job_type, payload_hash) DO NOTHING
    RETURNING id INTO v_job_id;
  END IF;
  
  -- Return result as JSONB
  RETURN jsonb_build_object(
    'article_id', v_article_id,
    'is_new', v_is_new,
    'job_enqueued', v_job_id IS NOT NULL,
    'job_id', v_job_id
  );
END;
$$;

-- Set proper ownership and permissions (only if we have the necessary privileges)
DO $$
BEGIN
  -- Only attempt ownership change if:
  -- 1. The service_role exists
  -- 2. We have permission to change ownership (SUPERUSER or current owner)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    BEGIN
      ALTER FUNCTION public.upsert_article_and_enqueue_jobs(
        text, text, text, timestamptz, text, text, text, text, boolean, jsonb
      ) OWNER TO service_role;
      
      REVOKE ALL ON FUNCTION public.upsert_article_and_enqueue_jobs(
        text, text, text, timestamptz, text, text, text, text, boolean, jsonb
      ) FROM PUBLIC;
      
      GRANT EXECUTE ON FUNCTION public.upsert_article_and_enqueue_jobs(
        text, text, text, timestamptz, text, text, text, text, boolean, jsonb
      ) TO service_role, authenticated;
      
      RAISE NOTICE 'Function ownership and permissions updated successfully';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping ownership change - insufficient privileges. Function will use current user permissions.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping ownership change - error: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'service_role does not exist - skipping ownership change';
  END IF;
END$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.upsert_article_and_enqueue_jobs IS 
'Atomically upserts an article and enqueues enrichment job if new. Uses GENERATED payload_hash for idempotency.';

-- ============================================================================
-- PART 4: Add helpful indexes for performance
-- ============================================================================

-- Index for finding articles by URL hash (used in upserts)
CREATE INDEX IF NOT EXISTS idx_political_entries_url_hash 
  ON public.political_entries(url_hash);

-- Index for finding recent articles
CREATE INDEX IF NOT EXISTS idx_political_entries_published_at 
  ON public.political_entries(published_at DESC);

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_political_entries_source 
  ON public.political_entries(source_name, published_at DESC);

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- Run these to confirm everything is set up correctly:
-- ============================================================================
/*
-- Check that payload_hash is GENERATED:
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_name = 'job_queue' AND column_name = 'payload_hash';

-- Check that political_entries constraints are proper:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'political_entries'::regclass
AND contype = 'u';

-- Check that the function exists:
SELECT proname, pronargs
FROM pg_proc
WHERE proname = 'upsert_article_and_enqueue_jobs';

-- Check indexes exist:
SELECT indexname FROM pg_indexes
WHERE tablename IN ('job_queue', 'political_entries');
*/

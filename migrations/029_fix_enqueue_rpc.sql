-- Migration 029: enqueue_fetch_job (atomic + active-only dedupe)
-- Date: 2025-11-02
-- JIRA: TTRC-248
--
-- Fixes:
-- 1. Race-free atomic INSERT with ON CONFLICT (partial unique index)
-- 2. Legacy data cleanup (ensure processed_at set for completed jobs)
-- 3. Preserve grants via CREATE OR REPLACE
-- 4. Server-side hash computation (full 64-char SHA-256)
-- 5. Comprehensive verification (duplicate + re-queue paths)
-- 6. PostgreSQL 15+ version guard
-- 7. Safer SECURITY DEFINER search_path

-- Version guard: ON CONFLICT (...) WHERE (...) requires PostgreSQL 15+
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'Migration 029 requires PostgreSQL 15+ for ON CONFLICT ... WHERE syntax';
  END IF;
END$$;

-- Ensure pgcrypto extension exists in extensions schema (Supabase standard)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

BEGIN;

-- 1) One-time cleanup: ensure processed_at set for completed jobs
-- CRITICAL: Do NOT mark 'failed' jobs as processed - they must remain retryable
-- This makes the "active = processed_at IS NULL" invariant reliable
UPDATE public.job_queue
SET processed_at = COALESCE(processed_at, completed_at, NOW())
WHERE processed_at IS NULL
  AND status IN ('done', 'completed');

-- 2) Pre-flight dedupe: Close duplicate active jobs BEFORE creating unique index
-- Keeps oldest job by (processed_at, created_at, id); marks newer duplicates as failed
-- CRITICAL: Must run BEFORE index creation or CREATE UNIQUE INDEX will fail in TEST
DO $$
DECLARE
  has_last_error  boolean;
  has_updated_at  boolean;
  has_created_at  boolean;
  update_sql      text;
  v_closed        bigint;
BEGIN
  -- Optional columns present?
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='last_error'
  ) INTO has_last_error;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='updated_at'
  ) INTO has_updated_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='job_queue' AND column_name='created_at'
  ) INTO has_created_at;

  -- Build UPDATE dynamically (created_at may not exist)
  update_sql := 'WITH ranked AS (
    SELECT id, job_type, payload_hash, status, processed_at,
           ROW_NUMBER() OVER (
             PARTITION BY job_type, payload_hash
             ORDER BY ' ||
             CASE WHEN has_created_at
                  THEN 'COALESCE(processed_at, created_at, NOW()), id'
                  ELSE 'COALESCE(processed_at, NOW()), id'
             END ||
           '
           ) AS rn
    FROM public.job_queue
    WHERE processed_at IS NULL
  )
  UPDATE public.job_queue j
     SET status = ''failed'',
         processed_at = NOW()';

  IF has_last_error THEN
    update_sql := update_sql || ',
         last_error = ''m029 dedupe cleanup: superseded active duplicate''';
  END IF;

  IF has_updated_at THEN
    update_sql := update_sql || ',
         updated_at = NOW()';
  END IF;

  update_sql := update_sql || '
  FROM ranked r
  WHERE j.id = r.id
    AND r.rn > 1
    AND j.status IN (''pending'',''processing'')';

  EXECUTE update_sql;
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RAISE NOTICE 'Pre-flight dedupe: Closed % duplicate active jobs', v_closed;
END$$;

-- 3) Ensure partial unique index for active jobs (idempotent)
-- NOTE: For production with large tables, run this BEFORE the main migration:
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
--     ON public.job_queue (job_type, payload_hash)
--     WHERE (processed_at IS NULL);
-- Then skip the index creation block below in the main migration.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop ANY UNIQUE CONSTRAINT on (job_type, payload_hash) regardless of column order
  FOR r IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t   ON t.oid = c.conrelid AND t.relname = 'job_queue'
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
    WHERE c.contype = 'u'
      AND c.conkey IS NOT NULL
      AND (
        -- Order-insensitive: matches (job_type, payload_hash) OR (payload_hash, job_type)
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) WITH ORDINALITY AS arr(attnum, i)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = arr.attnum
      ) = ARRAY['job_type','payload_hash']::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.job_queue DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped legacy unique constraint: %', r.conname;
  END LOOP;

  -- Drop any stray non-partial unique indexes on (job_type, payload_hash)
  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='job_queue'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX % ON public.job_queue (job_type, payload_hash)%'
      AND indexdef NOT ILIKE '% WHERE %'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
    RAISE NOTICE 'Dropped legacy non-partial unique index: %', r.indexname;
  END LOOP;

  -- Ensure partial unique index exists (TEST-safe; for PROD build CONCURRENTLY outside tx)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='job_queue'
      AND indexname='ux_job_queue_payload_hash_active'
  ) THEN
    -- Only create inside transaction if in TEST (otherwise must be built CONCURRENTLY beforehand)
    IF coalesce(current_setting('app.env', true), 'prod') = 'test' THEN
      CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
        ON public.job_queue (job_type, payload_hash)
        WHERE processed_at IS NULL;
      RAISE NOTICE 'Created partial unique index ux_job_queue_payload_hash_active';
    ELSE
      RAISE NOTICE 'Skipping index create inside tx (PROD). Build CONCURRENTLY beforehand.';
    END IF;
  END IF;
END$$;

-- 4) Atomic, idempotent RPC (preserve grants using OR REPLACE)
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type    text,
  p_payload jsonb,
  p_hash    text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY: Tighten search_path to public only; explicitly qualify extensions.digest()
-- This prevents search_path hijacking attacks in SECURITY DEFINER functions
SET search_path = public
AS $$
DECLARE
  v_id   bigint;
  v_hash text;
  v_type text;  -- Use variable to avoid mutating IN parameter
BEGIN
  -- Validate and normalize required parameters
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'p_type is required';
  END IF;
  v_type := lower(trim(p_type));  -- Normalize to prevent case/whitespace dupes

  -- Compute full SHA-256 hash (64 hex chars) server-side if not provided
  -- STABILITY: jsonb_strip_nulls() prevents hash drift from meaningless nulls
  -- SECURITY: extensions.digest() explicitly qualified to prevent hijacking
  v_hash := COALESCE(
    p_hash,
    encode(
      extensions.digest(
        convert_to(
          COALESCE(jsonb_strip_nulls(p_payload), '{}'::jsonb)::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  );

  -- Atomic insert with conflict detection on partial unique index
  -- Syntax: ON CONFLICT (columns) WHERE (condition) for partial unique indexes (PG 15+)
  INSERT INTO public.job_queue (
    job_type,
    payload,
    payload_hash,
    run_at,
    status,
    attempts,
    max_attempts
  )
  VALUES (
    v_type,  -- Use normalized variable, not mutated parameter
    COALESCE(p_payload, '{}'::jsonb),  -- Guard against NULL payload (avoids NOT NULL violations)
    v_hash,
    NOW(),       -- TODO: Use table defaults to avoid config drift
    'pending',
    0,
    5
  )
  ON CONFLICT (job_type, payload_hash) WHERE (processed_at IS NULL) DO NOTHING
  RETURNING id INTO v_id;

  -- Returns job ID on successful insert, NULL if duplicate active job exists
  RETURN v_id;
END$$;

-- 5) Tighten permissions: service_role only
-- Set explicit owner for SECURITY DEFINER + RLS stability (conditional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER FUNCTION public.enqueue_fetch_job(text, jsonb, text) OWNER TO postgres';
    RAISE NOTICE 'Function owner set to postgres';
  ELSE
    RAISE NOTICE 'Owner change skipped: role "postgres" not present';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Owner change skipped: insufficient privileges';
END$$;

REVOKE ALL ON FUNCTION public.enqueue_fetch_job(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb, text) TO service_role;

-- 6) Fix article creation RPC search_path for PROD deployment
-- In TEST this was applied via temp_fix_search_path.sql
-- Adding here to ensure PROD gets the fix
-- Note: PostgreSQL doesn't support ALTER FUNCTION IF EXISTS, so use conditional DO block
DO $$
DECLARE
  fn_oid oid;
BEGIN
  SELECT p.oid
    INTO fn_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'upsert_article_and_enqueue_jobs'
    AND pg_get_function_identity_arguments(p.oid) =
        'text, text, text, timestamptz, text, text, text, text, boolean, jsonb';

  IF fn_oid IS NOT NULL THEN
    EXECUTE
      'ALTER FUNCTION public.upsert_article_and_enqueue_jobs(' ||
      'text, text, text, timestamptz, text, text, text, text, boolean, jsonb' ||
      ') SET search_path = ''public, extensions, pg_temp''';
    RAISE NOTICE 'Updated search_path for upsert_article_and_enqueue_jobs';
  ELSE
    RAISE NOTICE 'Skipped: upsert_article_and_enqueue_jobs(...) not present';
  END IF;
END$$;

-- Note: The function body uses digest() which requires pgcrypto extension
-- Supabase places pgcrypto in the 'extensions' schema, so we must include it in search_path

-- 7) Performance: Add worker-claim index to keep queue scans fast under load
-- Partial index on pending jobs for efficient worker claiming
CREATE INDEX IF NOT EXISTS idx_job_queue_pending_job_type_run_at
  ON public.job_queue (job_type, run_at)
  WHERE status = 'pending';

-- 8) Data integrity: Enforce payload_hash format (64 hex chars)
-- NOT VALID means no full table scan now; validate later in low-traffic window
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_queue_payload_hash_hex_64_chk'
      AND conrelid = 'public.job_queue'::regclass
  ) THEN
    ALTER TABLE public.job_queue
      ADD CONSTRAINT job_queue_payload_hash_hex_64_chk
      CHECK (payload_hash ~ '^[0-9a-f]{64}$') NOT VALID;
    RAISE NOTICE 'Added hash format constraint (NOT VALID)';
  ELSE
    RAISE NOTICE 'Hash format constraint already exists';
  END IF;
END$$;
-- To validate later: ALTER TABLE public.job_queue VALIDATE CONSTRAINT job_queue_payload_hash_hex_64_chk;

-- CRITICAL: PROD safety guard - Fail fast if required index missing in PROD
-- The RPC function requires ux_job_queue_payload_hash_active for ON CONFLICT to work
-- In TEST this index is created above; in PROD it must be built CONCURRENTLY beforehand
DO $$
BEGIN
  IF COALESCE(current_setting('app.env', true), 'prod') <> 'test' THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND tablename='job_queue'
        AND indexname='ux_job_queue_payload_hash_active'
    ) THEN
      RAISE EXCEPTION 'MIGRATION BLOCKED: Required index ux_job_queue_payload_hash_active is missing in PROD. Run this FIRST: CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active ON public.job_queue (job_type, payload_hash) WHERE (processed_at IS NULL); Then rerun this migration.';
    ELSE
      RAISE NOTICE 'PROD safety check PASSED: Required index ux_job_queue_payload_hash_active exists';
    END IF;
  ELSE
    RAISE NOTICE 'TEST environment: Skipping PROD index guard';
  END IF;
END$$;

COMMIT;

-- 9) TEST-only sanity check: Verify digest() works with correct bytea conversion
-- Gated to TEST environment to prevent polluting PROD logs
DO $$
DECLARE
  v_test_hash text;
  v_expected_hash text := '666c1aa02e8068c6d5cc1d3295009432c16790bec28ec8ce119d0d1a18d61319';
BEGIN
  IF COALESCE(current_setting('app.env', true), 'prod') = 'test' THEN
    -- Test that digest() with convert_to() produces expected hash
    -- This hash matches what JavaScript crypto.createHash('sha256') produces for {"k":"v"}
    -- Qualify digest() as extensions.digest() since this is session-level code
    SELECT encode(extensions.digest(convert_to('{"k":"v"}', 'UTF8'), 'sha256'::text), 'hex') INTO v_test_hash;

    IF v_test_hash = v_expected_hash THEN
      RAISE NOTICE 'Sanity check PASSED: digest() hash matches JavaScript crypto (64 chars)';
    ELSE
      RAISE EXCEPTION 'Sanity check FAILED: Expected %, got %', v_expected_hash, v_test_hash;
    END IF;
  ELSE
    RAISE NOTICE 'Skipping sanity check (not in TEST environment)';
  END IF;
END$$;

-- 10) TEST-only comprehensive verification: duplicate suppression + re-queue behavior
-- Gated to TEST environment to prevent creating test jobs in PROD
DO $$
DECLARE
  v1 bigint;
  v2 bigint;
  v3 bigint;
  h  text := 'test_m029_' || extract(epoch from now())::text;
BEGIN
  IF COALESCE(current_setting('app.env', true), 'prod') = 'test' THEN
    RAISE NOTICE 'Migration 029: Starting verification tests...';

    -- Test 5a: Create first job (should succeed)
    SELECT public.enqueue_fetch_job('fetch_feed', '{"test":"migration_029"}', h) INTO v1;
    IF v1 IS NULL THEN
      RAISE EXCEPTION 'M029 FAIL: First insert returned NULL (expected job ID)';
    END IF;
    RAISE NOTICE 'M029 Test 1/3 PASS: Created job % with hash %', v1, h;

    -- Test 5b: Try duplicate while active (should return NULL = dedupe)
    SELECT public.enqueue_fetch_job('fetch_feed', '{"test":"migration_029"}', h) INTO v2;
    IF v2 IS NOT NULL THEN
      RAISE EXCEPTION 'M029 FAIL: Duplicate active insert returned % (expected NULL for dedupe)', v2;
    END IF;
    RAISE NOTICE 'M029 Test 2/3 PASS: Duplicate blocked (returned NULL as expected)';

    -- Test 5c: Mark first job completed (not deleted) so it is no longer "active"
    UPDATE public.job_queue
    SET status = 'completed',
        completed_at = NOW(),
        processed_at = NOW()
    WHERE id = v1;

    -- Test 5d: Re-queue with same hash after completion (should succeed with new ID)
    SELECT public.enqueue_fetch_job('fetch_feed', '{"test":"migration_029"}', h) INTO v3;
    IF v3 IS NULL THEN
      RAISE EXCEPTION 'M029 FAIL: Re-queue after completion returned NULL (expected new job ID)';
    END IF;
    IF v3 = v1 THEN
      RAISE EXCEPTION 'M029 FAIL: Re-queue returned same ID % (expected different ID)', v3;
    END IF;
    RAISE NOTICE 'M029 Test 3/3 PASS: Re-queued after completion (job % != %)', v3, v1;

    -- Cleanup test artifacts
    DELETE FROM public.job_queue WHERE id IN (v1, v3);
    RAISE NOTICE 'M029: Cleaned up test jobs';

    RAISE NOTICE '✅ Migration 029 verification PASSED (created: %, re-queued: %)', v1, v3;
  ELSE
    RAISE NOTICE 'Skipping verification tests (not in TEST environment)';
  END IF;
END$$;

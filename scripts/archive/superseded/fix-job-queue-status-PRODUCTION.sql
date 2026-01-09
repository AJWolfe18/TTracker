-- Fix Job Queue Status Values and Make Jobs Runnable (P1-SAFE VERSION)
-- Handles enum types, doesn't stomp in-flight jobs, prevents negative attempts

BEGIN;

-- Step 1: Check if status is enum and ensure 'done' exists if needed
DO $$
DECLARE
  is_enum boolean;
  has_done boolean;
  enum_type_name text;
BEGIN
  -- Check if status column is an enum type
  SELECT t.typtype = 'e', t.typname
  INTO is_enum, enum_type_name
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid AND c.relname='job_queue'
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname='public'
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attname='status';

  IF is_enum THEN
    RAISE NOTICE 'status column is enum type: %', enum_type_name;
    
    -- Check if 'done' value exists in enum
    SELECT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = enum_type_name
        AND e.enumlabel = 'done'
    ) INTO has_done;

    IF NOT has_done THEN
      RAISE NOTICE 'Adding ''done'' to enum type %', enum_type_name;
      -- Add 'done' to the enum (can't be in transaction, so we flag it)
      RAISE WARNING 'MANUAL ACTION REQUIRED: Run this outside transaction:';
      RAISE WARNING 'ALTER TYPE % ADD VALUE ''done'' AFTER ''failed'';', enum_type_name;
      -- For now, skip the status update
      RAISE NOTICE 'Skipping status normalization until ''done'' is added to enum';
    ELSE
      -- Safe to update
      UPDATE public.job_queue
      SET status = 'done'
      WHERE status = 'completed';
      RAISE NOTICE 'Updated % rows from completed to done', ROW_COUNT;
    END IF;
  ELSE
    -- TEXT column, safe to update
    UPDATE public.job_queue
    SET status = 'done'
    WHERE status = 'completed';
    
    GET DIAGNOSTICS is_enum := ROW_COUNT;
    RAISE NOTICE 'Updated % rows from completed to done (TEXT column)', is_enum;
  END IF;
END $$;

-- Step 2: Show current job distribution
DO $$
DECLARE
  v_stats RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Current job queue distribution:';
  FOR v_stats IN 
    SELECT job_type, status, COUNT(*) as cnt
    FROM public.job_queue
    GROUP BY job_type, status
    ORDER BY job_type, status
  LOOP
    RAISE NOTICE '  %-20s %-12s: %s', v_stats.job_type, v_stats.status, v_stats.cnt;
  END LOOP;
END $$;

-- Step 3: ONLY reset STALE processing jobs (>30 minutes old)
-- This prevents stomping on jobs the worker just claimed
DO $$
DECLARE
  v_reset_count integer;
BEGIN
  UPDATE public.job_queue
  SET 
    status = 'pending',
    run_at = NOW(),
    started_at = NULL,
    completed_at = NULL,
    last_error = COALESCE(last_error,'') || ' | auto-reset (stale >30m)'
  WHERE job_type = 'fetch_feed'
    AND status = 'processing'
    AND (
      (started_at IS NOT NULL AND started_at < NOW() - INTERVAL '30 minutes')
      OR (started_at IS NULL AND updated_at < NOW() - INTERVAL '30 minutes')
      OR (started_at IS NULL AND updated_at IS NULL AND created_at < NOW() - INTERVAL '30 minutes')
    );
    
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset % stale processing jobs to pending', v_reset_count;
END $$;

-- Step 4: Reset failed jobs (safe to retry)
DO $$
DECLARE
  v_reset_count integer;
BEGIN
  UPDATE public.job_queue
  SET 
    status = 'pending',
    run_at = NOW(),
    started_at = NULL,
    completed_at = NULL
  WHERE status = 'failed'
    AND job_type = 'fetch_feed';
    
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset % failed jobs to pending', v_reset_count;
END $$;

-- Step 5: Check if unique index exists before upsert
DO $$
DECLARE
  has_unique_index boolean;
BEGIN
  -- Check for unique index on (job_type, payload_hash)
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'job_queue'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%job_type%'
      AND indexdef LIKE '%payload_hash%'
  ) INTO has_unique_index;
  
  IF has_unique_index THEN
    RAISE NOTICE 'Unique index exists on (job_type, payload_hash) - safe for upsert';
    
    -- Ensure fresh fetch_feed jobs exist for all active feeds
    INSERT INTO public.job_queue (job_type, payload, status, run_at, attempts)
    SELECT
      'fetch_feed',
      jsonb_build_object(
        'feed_id', id,
        'url', feed_url,
        'source_name', feed_name
      ),
      'pending',
      NOW(),
      0
    FROM public.feed_registry
    WHERE is_active = true
    ON CONFLICT (job_type, payload_hash)
    DO UPDATE
    SET
      status = CASE 
        WHEN job_queue.status IN ('failed','done') THEN 'pending'
        ELSE job_queue.status
      END,
      run_at = CASE
        WHEN job_queue.status IN ('failed','done') THEN NOW()
        ELSE job_queue.run_at
      END;
      
    RAISE NOTICE 'Upserted fetch jobs for all active feeds';
  ELSE
    RAISE WARNING 'No unique index on (job_type, payload_hash) - skipping upsert';
    RAISE NOTICE 'Creating jobs without conflict handling...';
    
    -- Try to insert, ignoring duplicates
    INSERT INTO public.job_queue (job_type, payload, status, run_at, attempts)
    SELECT
      'fetch_feed',
      jsonb_build_object(
        'feed_id', f.id,
        'url', f.feed_url,
        'source_name', f.feed_name
      ),
      'pending',
      NOW(),
      0
    FROM public.feed_registry f
    WHERE f.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue j
        WHERE j.job_type = 'fetch_feed'
          AND j.payload->>'feed_id' = f.id::text
          AND j.status IN ('pending', 'processing')
      );
  END IF;
END $$;

-- Step 6: Verify we have runnable jobs
DO $$
DECLARE
  v_count integer;
  v_sample RECORD;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.job_queue
  WHERE job_type = 'fetch_feed' 
    AND status = 'pending'
    AND (run_at IS NULL OR run_at <= NOW());
    
  RAISE NOTICE '';
  RAISE NOTICE 'Ready to process: % fetch_feed jobs', v_count;
  
  IF v_count = 0 THEN
    RAISE WARNING 'No runnable jobs! Checking why...';
    
    -- Debug: show distribution
    FOR v_sample IN
      SELECT status, COUNT(*) as cnt
      FROM public.job_queue
      WHERE job_type = 'fetch_feed'
      GROUP BY status
    LOOP
      RAISE NOTICE '  fetch_feed %: %', v_sample.status, v_sample.cnt;
    END LOOP;
  ELSE
    -- Show a few ready jobs
    RAISE NOTICE 'Sample ready jobs:';
    FOR v_sample IN
      SELECT id, payload->>'source_name' as source, run_at, attempts
      FROM public.job_queue
      WHERE job_type = 'fetch_feed'
        AND status = 'pending'
        AND (run_at IS NULL OR run_at <= NOW())
      ORDER BY run_at NULLS FIRST
      LIMIT 3
    LOOP
      RAISE NOTICE '  Job #% [%] attempts:% run_at:%', 
        v_sample.id, v_sample.source, v_sample.attempts, v_sample.run_at;
    END LOOP;
  END IF;
END $$;

-- Step 7: Test atomic claiming (with SAFE release)
DO $$
DECLARE
  v_job RECORD;
BEGIN
  -- Only test if function exists
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'claim_next_job'
  ) THEN
    -- Try to claim a job
    SELECT * INTO v_job FROM public.claim_next_job('fetch_feed');
    
    IF v_job.id IS NOT NULL THEN
      RAISE NOTICE '';
      RAISE NOTICE '✅ SUCCESS: Claimed job #% (atomic claiming works!)', v_job.id;
      
      -- Release it back SAFELY (prevent negative attempts)
      UPDATE public.job_queue 
      SET 
        status = 'pending',
        started_at = NULL,
        attempts = GREATEST(attempts - 1, 0)  -- Prevent negative
      WHERE id = v_job.id;
      
      RAISE NOTICE '   Released job back to queue (attempts: %)', 
        (SELECT attempts FROM public.job_queue WHERE id = v_job.id);
    ELSE
      RAISE NOTICE '⚠️ No jobs available to claim (all may be processing/done)';
    END IF;
  ELSE
    RAISE WARNING 'claim_next_job function not found - run migration 009';
  END IF;
END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Post-commit summary (run separately)
DO $$
DECLARE
  v_stats RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'FINAL JOB QUEUE STATUS';
  RAISE NOTICE '════════════════════════════════════════';
  
  FOR v_stats IN
    SELECT 
      job_type,
      status,
      COUNT(*) as count,
      MIN(run_at) as earliest,
      MAX(attempts) as max_attempts
    FROM public.job_queue
    GROUP BY job_type, status
    ORDER BY job_type, status
  LOOP
    RAISE NOTICE '%-15s %-10s Count:%-4s MaxAttempts:%-2s', 
      v_stats.job_type, v_stats.status, v_stats.count, v_stats.max_attempts;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. If enum type needs ''done'', run ALTER TYPE outside transaction';
  RAISE NOTICE '  2. Run: node scripts/job-queue-worker-atomic.js';
  RAISE NOTICE '════════════════════════════════════════';
END $$;

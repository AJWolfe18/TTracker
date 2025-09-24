-- RSS Job Queue Reset and Seed Script
-- Run this BEFORE starting the worker to ensure there are jobs to process

BEGIN;

-- Step 1: Re-enable any failed/processing fetch jobs to run now
UPDATE public.job_queue
SET status='pending', run_at=NOW(), started_at=NULL, completed_at=NULL
WHERE job_type='fetch_feed' AND status IN ('failed','processing');

-- Step 2: Ensure a job per active feed (idempotent with (job_type,payload_hash))
INSERT INTO public.job_queue (job_type, payload, status, run_at, attempts)
SELECT
  'fetch_feed',
  jsonb_build_object('feed_id', id, 'url', feed_url, 'source_name', feed_name),
  'pending',
  NOW(),
  0
FROM public.feed_registry
WHERE is_active = true
ON CONFLICT (job_type, payload_hash) DO NOTHING;

-- Step 3: Show what we have ready to process
SELECT id, job_type, status, run_at, payload->>'source_name' as source
FROM public.job_queue
WHERE job_type='fetch_feed' AND status='pending' AND (run_at IS NULL OR run_at <= NOW())
ORDER BY run_at NULLS FIRST, created_at
LIMIT 10;

-- Step 4: Summary
DO $$
DECLARE
  v_ready integer;
  v_total integer;
BEGIN
  SELECT COUNT(*) INTO v_ready
  FROM public.job_queue
  WHERE job_type='fetch_feed' AND status='pending' AND (run_at IS NULL OR run_at <= NOW());
  
  SELECT COUNT(*) INTO v_total
  FROM public.job_queue
  WHERE job_type='fetch_feed';
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Job Queue Ready:';
  RAISE NOTICE '   % fetch_feed jobs ready to process', v_ready;
  RAISE NOTICE '   % total fetch_feed jobs in queue', v_total;
  
  IF v_ready = 0 THEN
    RAISE WARNING 'No runnable jobs! Check feed_registry.is_active or job_queue status.';
  END IF;
END $$;

COMMIT;

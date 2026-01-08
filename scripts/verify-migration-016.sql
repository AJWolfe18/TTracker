-- Quick verification after applying migration 016
-- Run these queries to verify the fix is working

-- 1. Test claim returns NULL when empty (not row-of-nulls)
SELECT public.claim_and_start_job('fetch_feed');  
-- Expected: NULL when no jobs available

-- 2. Check runnable count matches claim predicate
SELECT COUNT(*) AS runnable
FROM public.job_queue
WHERE job_type='fetch_feed'
  AND processed_at IS NULL
  AND (
        status = 'pending'
        OR (status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')
      )
  AND (run_at IS NULL OR run_at <= NOW())
  AND (max_attempts IS NULL OR attempts < max_attempts);
-- Expected: Should match what worker reports

-- 3. Force reset any stuck jobs
SELECT public.reset_stuck_jobs();
-- Expected: Returns count of reset jobs

-- 4. Check for any orphaned "active" jobs
SELECT id, job_type, status, 
       processed_at, started_at, 
       run_at, attempts, max_attempts,
       NOW() - started_at as stuck_duration
FROM public.job_queue
WHERE processed_at IS NULL
  AND status = 'processing'
ORDER BY started_at;
-- Expected: No rows older than 5-30 minutes

-- 5. Verify partial unique index is working
SELECT COUNT(*) as active_count, job_type, payload_hash
FROM public.job_queue
WHERE processed_at IS NULL
GROUP BY job_type, payload_hash
HAVING COUNT(*) > 1;
-- Expected: No rows (no duplicates in active set)

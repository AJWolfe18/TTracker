-- RSS Queue Reset Script
-- Run this when jobs are stuck to reset the pipeline

-- 1. Show what's stuck
SELECT 
  '=== BEFORE RESET ===' as status,
  job_type,
  status,
  COUNT(*) as count
FROM job_queue
WHERE job_type IN ('fetch_feed', 'story.cluster', 'article.process')
GROUP BY job_type, status
ORDER BY job_type, status;

-- 2. Fix broken status (complete but still pending)
UPDATE job_queue
SET status = 'done'
WHERE status = 'pending'
  AND completed_at IS NOT NULL
  AND job_type = 'fetch_feed';

-- 3. Reset stuck processing jobs (over 30 minutes old)
UPDATE job_queue
SET 
  status = 'pending',
  started_at = NULL,
  attempts = attempts + 1,
  last_error = 'Reset due to stuck processing'
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes';

-- 4. Reset recent failed RSS jobs (give them another try)
UPDATE job_queue
SET 
  status = 'pending',
  attempts = 0,
  last_error = NULL
WHERE job_type = 'fetch_feed'
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND payload->>'source_name' NOT IN ('Reuters Politics', 'AP News US'); -- Skip known failing feeds

-- 5. Clean up old done jobs (optional - for space)
DELETE FROM job_queue
WHERE status = 'done'
  AND created_at < NOW() - INTERVAL '7 days';

-- 6. Show results
SELECT 
  '=== AFTER RESET ===' as status,
  job_type,
  status,
  COUNT(*) as count
FROM job_queue
WHERE job_type IN ('fetch_feed', 'story.cluster', 'article.process')
GROUP BY job_type, status
ORDER BY job_type, status;

-- 7. Ready to run check
SELECT 
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' jobs ready to process!'
    ELSE '❌ No pending jobs - need to create fetch jobs'
  END as ready_status
FROM job_queue
WHERE status = 'pending'
  AND job_type = 'fetch_feed';

-- 8. If no pending jobs, create them
INSERT INTO job_queue (job_type, payload, status, run_at)
SELECT 
  'fetch_feed',
  jsonb_build_object(
    'feed_id', id::text,
    'url', feed_url,
    'source_name', feed_name
  ),
  'pending',
  NOW()
FROM feed_registry 
WHERE is_active = true
  AND feed_name NOT IN ('Reuters Politics', 'AP News US') -- Skip known failing feeds
ON CONFLICT (job_type, payload_hash) DO NOTHING;
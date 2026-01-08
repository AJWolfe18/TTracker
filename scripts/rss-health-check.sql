-- RSS Pipeline Health Check
-- Run this daily to detect issues

-- 1. STUCK JOBS (Critical - needs immediate action)
SELECT 
  '🔴 STUCK JOBS' as issue_type,
  id,
  job_type,
  payload->>'source_name' as feed_name,
  started_at,
  EXTRACT(EPOCH FROM (NOW() - started_at))/60 as minutes_stuck,
  attempts
FROM job_queue
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes'
ORDER BY started_at;

-- 2. BROKEN STATUS (Jobs complete but still pending)
SELECT 
  '🔴 BROKEN STATUS' as issue_type,
  id,
  job_type,
  status,
  payload->>'source_name' as feed,
  started_at,
  completed_at
FROM job_queue
WHERE job_type = 'fetch_feed'
  AND (
    (status = 'pending' AND completed_at IS NOT NULL) OR
    (status = 'pending' AND started_at IS NOT NULL AND started_at < NOW() - INTERVAL '30 min')
  );

-- 3. FAILED JOBS (Need investigation)
SELECT 
  '🟡 FAILED JOBS' as issue_type,
  payload->>'source_name' as feed_name,
  COUNT(*) as failure_count,
  MAX(last_error) as last_error,
  MAX(created_at) as last_attempt
FROM job_queue
WHERE status = 'failed'
  AND job_type = 'fetch_feed'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY payload->>'source_name';

-- 4. FEED FRESHNESS (Are we getting new content?)
SELECT 
  '📊 FEED STATUS' as check_type,
  fr.feed_name,
  fr.failure_count,
  CASE 
    WHEN COUNT(a.id) = 0 THEN '❌ No articles in 24h'
    WHEN COUNT(a.id) < 5 THEN '🟡 Low article count'
    ELSE '✅ Active'
  END as health,
  COUNT(a.id) as articles_24h
FROM feed_registry fr
LEFT JOIN articles a ON a.source_name = fr.feed_name 
  AND a.created_at > NOW() - INTERVAL '24 hours'
WHERE fr.is_active = true
GROUP BY fr.feed_name, fr.failure_count
ORDER BY articles_24h DESC;

-- 5. PIPELINE SUMMARY
SELECT 
  'PIPELINE HEALTH' as metric,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
  SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done_today,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM job_queue
WHERE job_type = 'fetch_feed'
  AND created_at > CURRENT_DATE;
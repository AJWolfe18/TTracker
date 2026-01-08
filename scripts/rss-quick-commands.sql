-- RSS Quick Commands Reference
-- Common SQL commands for RSS pipeline operations

-- ============================================
-- 1. QUICK STATUS CHECK
-- ============================================
SELECT 
  'Pending Jobs' as metric, COUNT(*) as count FROM job_queue WHERE status = 'pending' AND job_type = 'fetch_feed'
UNION ALL
SELECT 'Processing Jobs', COUNT(*) FROM job_queue WHERE status = 'processing'
UNION ALL
SELECT 'Articles Today', COUNT(*) FROM articles WHERE created_at > CURRENT_DATE
UNION ALL
SELECT 'Active Stories', COUNT(*) FROM stories WHERE status = 'active';

-- ============================================
-- 2. FIX STUCK JOBS (Run before triggering RSS)
-- ============================================
-- Fix jobs that completed but still show pending
UPDATE job_queue SET status = 'done' 
WHERE status = 'pending' AND completed_at IS NOT NULL;

-- Fix jobs stuck in processing
UPDATE job_queue SET status = 'failed', last_error = 'Job timeout'
WHERE status = 'processing' AND started_at < NOW() - INTERVAL '30 minutes';

-- ============================================
-- 3. CREATE NEW FETCH JOBS
-- ============================================
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
  AND feed_name NOT IN ('Reuters Politics', 'AP News US') -- Skip known failing
ON CONFLICT (job_type, payload_hash) DO NOTHING;

-- ============================================
-- 4. CHECK FEED STATUS
-- ============================================
SELECT 
  fr.feed_name,
  fr.is_active,
  fr.failure_count,
  COUNT(a.id) as articles_24h,
  MAX(a.created_at) as last_article
FROM feed_registry fr
LEFT JOIN articles a ON a.source_name = fr.feed_name 
  AND a.created_at > NOW() - INTERVAL '24 hours'
GROUP BY fr.feed_name, fr.is_active, fr.failure_count
ORDER BY fr.is_active DESC, articles_24h DESC;

-- ============================================
-- 5. CLEAN UP OLD JOBS
-- ============================================
DELETE FROM job_queue
WHERE status = 'done'
  AND created_at < NOW() - INTERVAL '7 days';

-- ============================================
-- 6. RETRY FAILED JOBS
-- ============================================
UPDATE job_queue
SET status = 'pending', attempts = 0, last_error = NULL
WHERE status = 'failed'
  AND job_type = 'fetch_feed'
  AND created_at > NOW() - INTERVAL '24 hours'
  AND payload->>'source_name' NOT IN ('Reuters Politics', 'AP News US');

-- ============================================
-- 7. CHECK FOR DUPLICATE STORIES
-- ============================================
SELECT 
  primary_headline,
  COUNT(*) as duplicate_count
FROM stories
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY primary_headline
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- ============================================
-- 8. STORY HEADLINES CHECK
-- ============================================
SELECT 
  id,
  headline,
  primary_headline,
  CASE 
    WHEN headline IS NULL THEN '❌ NULL headline'
    WHEN headline = 'Untitled Story' THEN '⚠️ Default title'
    ELSE '✅ Has headline'
  END as status
FROM stories
WHERE id > 90
ORDER BY id DESC
LIMIT 10;
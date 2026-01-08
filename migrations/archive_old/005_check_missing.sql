-- Check what's missing for RSS system to work

-- 1. Check existing tables
SELECT 'Existing tables:' as check_type;
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('articles', 'stories', 'article_story', 'feed_registry', 'job_queue', 'budgets')
ORDER BY table_name;

-- 2. Check if stories table has all needed columns
SELECT 'Stories table columns:' as check_type;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'stories'
AND column_name IN ('story_hash', 'primary_actor', 'search_vector', 'confidence_score')
ORDER BY column_name;

-- 3. Check if feed_registry has all needed columns
SELECT 'Feed registry columns:' as check_type;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'feed_registry'
AND column_name IN ('etag', 'last_modified', 'failure_count', 'topics', 'is_opinion_source')
ORDER BY column_name;

-- 4. Check if job_queue has all needed columns
SELECT 'Job queue columns:' as check_type;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'job_queue'
AND column_name IN ('priority', 'next_retry_at', 'result', 'updated_at')
ORDER BY column_name;

-- 5. Check for required functions
SELECT 'Database functions:' as check_type;
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('claim_next_job', 'enqueue_job')
ORDER BY routine_name;
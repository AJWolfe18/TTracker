-- TrumpyTracker Migration Verification Script
-- Run this after migrations to verify all schema changes are correct

\echo '================================================'
\echo 'TRUMPYTRACKER SCHEMA VERIFICATION v3.1'
\echo '================================================'
\echo ''

-- Check if all required tables exist
\echo '1. CHECKING TABLES...'
SELECT 
  CASE 
    WHEN COUNT(*) = 6 THEN '✅ All required tables exist'
    ELSE '❌ Missing tables! Expected 6, found ' || COUNT(*)
  END as table_check
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'political_entries',
    'stories', 
    'article_story',
    'job_queue',
    'feed_registry',
    'budgets'
  );

\echo ''
\echo '2. CHECKING STORIES TABLE...'

-- Check stories status constraint includes 'archived'
SELECT 
  CASE 
    WHEN conname IS NOT NULL THEN '✅ Status constraint includes archived'
    ELSE '❌ CRITICAL: Status constraint missing archived!'
  END as status_check
FROM pg_constraint
WHERE conname = 'stories_status_check'
  AND conrelid = 'stories'::regclass
  AND pg_get_constraintdef(oid) LIKE '%archived%';

-- Check primary_actor column exists
SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ primary_actor column exists'
    ELSE '❌ CRITICAL: primary_actor column missing!'
  END as actor_check
FROM information_schema.columns
WHERE table_name = 'stories'
  AND column_name = 'primary_actor';

-- Check search_vector column exists
SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ search_vector column exists'
    ELSE '❌ search_vector column missing!'
  END as search_check
FROM information_schema.columns
WHERE table_name = 'stories'
  AND column_name = 'search_vector';

\echo ''
\echo '3. CHECKING FEED REGISTRY...'

-- Check all required columns exist
WITH required_columns AS (
  SELECT unnest(ARRAY[
    'feed_url', 'feed_name', 'topics', 'tier',
    'etag', 'last_modified', 'last_fetched', 
    'failure_count', 'is_active', 'last_304_at'
  ]) as col_name
),
existing_columns AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'feed_registry'
)
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ All feed_registry columns exist'
    ELSE '❌ CRITICAL: Missing columns: ' || string_agg(col_name, ', ')
  END as feed_check
FROM required_columns
WHERE col_name NOT IN (SELECT column_name FROM existing_columns);

\echo ''
\echo '4. CHECKING JOB QUEUE...'

-- Verify job queue has idempotency constraint
SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ Job queue idempotency constraint exists'
    ELSE '❌ Job queue missing unique constraint'
  END as job_check
FROM pg_indexes
WHERE tablename = 'job_queue'
  AND indexdef LIKE '%UNIQUE%type%payload_hash%';

\echo ''
\echo '5. CHECKING POLITICAL_ENTRIES ADDITIONS...'

-- Check new columns in political_entries
WITH required_cols AS (
  SELECT unnest(ARRAY[
    'url_canonical', 'url_hash', 'source_domain', 
    'source_name', 'published_at', 'content_type', 'excerpt'
  ]) as col_name
),
existing AS (
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'political_entries'
)
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ All political_entries columns exist'
    ELSE '❌ Missing columns: ' || string_agg(col_name, ', ')
  END as pe_check
FROM required_cols
WHERE col_name NOT IN (SELECT column_name FROM existing);

\echo ''
\echo '6. CHECKING INDEXES...'

-- Check critical indexes exist
SELECT 
  CASE 
    WHEN COUNT(*) >= 5 THEN '✅ ' || COUNT(*) || ' critical indexes found'
    ELSE '⚠️  Only ' || COUNT(*) || ' indexes found (expected at least 5)'
  END as index_check
FROM pg_indexes
WHERE tablename IN ('stories', 'political_entries', 'job_queue', 'feed_registry')
  AND (
    indexname LIKE '%search%' OR
    indexname LIKE '%topics%' OR
    indexname LIKE '%updated%' OR
    indexname LIKE '%pending%' OR
    indexname LIKE '%url_date%'
  );

\echo ''
\echo '7. CHECKING URL UNIQUENESS STRATEGY...'

-- Verify composite URL uniqueness index
SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ Composite URL uniqueness index exists'
    ELSE '❌ Missing composite URL index on political_entries'
  END as composite_check
FROM pg_indexes
WHERE tablename = 'political_entries'
  AND indexdef LIKE '%url_hash%published_at%';

\echo ''
\echo '8. CHECKING DATA TYPES...'

-- Verify critical data types
SELECT 
  column_name,
  data_type,
  CASE 
    WHEN column_name = 'search_vector' AND data_type = 'tsvector' THEN '✅'
    WHEN column_name = 'topic_tags' AND data_type = 'ARRAY' THEN '✅'
    WHEN column_name LIKE '%_at' AND data_type LIKE 'timestamp%' THEN '✅'
    WHEN data_type = 'jsonb' THEN '✅'
    ELSE '📍'
  END as type_check
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('stories', 'job_queue', 'feed_registry')
  AND column_name IN (
    'search_vector', 'topic_tags', 'payload',
    'last_updated_at', 'first_seen_at', 'last_enriched_at'
  )
ORDER BY table_name, column_name;

\echo ''
\echo '================================================'
\echo 'VERIFICATION SUMMARY'
\echo '================================================'

-- Final summary
WITH checks AS (
  SELECT 'Tables' as check_name, 
    CASE WHEN COUNT(*) = 6 THEN 'PASS' ELSE 'FAIL' END as status
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('political_entries', 'stories', 'article_story', 
                      'job_queue', 'feed_registry', 'budgets')
  
  UNION ALL
  
  SELECT 'Stories Status', 
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_constraint
  WHERE conname = 'stories_status_check'
    AND pg_get_constraintdef(oid) LIKE '%archived%'
  
  UNION ALL
  
  SELECT 'Primary Actor', 
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.columns
  WHERE table_name = 'stories' AND column_name = 'primary_actor'
  
  UNION ALL
  
  SELECT 'Feed Columns',
    CASE WHEN COUNT(*) = 10 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.columns
  WHERE table_name = 'feed_registry'
    AND column_name IN ('feed_url', 'feed_name', 'topics', 'tier',
                        'etag', 'last_modified', 'last_fetched',
                        'failure_count', 'is_active', 'last_304_at')
  
  UNION ALL
  
  SELECT 'Search Index',
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_indexes
  WHERE indexname LIKE '%search%' AND tablename = 'stories'
)
SELECT 
  check_name,
  CASE 
    WHEN status = 'PASS' THEN '✅ ' || status
    ELSE '❌ ' || status
  END as result
FROM checks
ORDER BY 
  CASE status WHEN 'FAIL' THEN 0 ELSE 1 END,
  check_name;

\echo ''
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN E'\n🎉 ALL CHECKS PASSED! System ready for development.\n'
    ELSE E'\n⚠️  FAILURES DETECTED! Run migration script before proceeding.\n'
  END as final_status
FROM (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'stories_status_check'
    AND pg_get_constraintdef(oid) NOT LIKE '%archived%'
  UNION ALL
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'stories' AND column_name = 'primary_actor'
  HAVING COUNT(*) = 0
) failures;

\echo '================================================'
\echo 'Run test data script next: test_data_fixtures.sql'
\echo '================================================'
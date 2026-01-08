-- TrumpyTracker Migration Verification Script (Web Version)
-- Run this in Supabase SQL Editor after migration

-- Check all required tables
WITH table_check AS (
  SELECT 
    COUNT(*) as table_count,
    string_agg(table_name, ', ') as tables_found
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'political_entries',
      'stories', 
      'article_story',
      'job_queue',
      'feed_registry',
      'budgets'
    )
)
SELECT 
  CASE 
    WHEN table_count = 6 THEN '✅ PASS: All 6 tables exist'
    ELSE '❌ FAIL: Only ' || table_count || ' tables found. Missing some tables.'
  END as "1. TABLES CHECK",
  tables_found as "Tables Found"
FROM table_check;

-- Check stories table columns and constraints
WITH stories_checks AS (
  SELECT 
    EXISTS(
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stories_status_check'
        AND conrelid = 'stories'::regclass
        AND pg_get_constraintdef(oid) LIKE '%archived%'
    ) as has_archived_status,
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'stories' AND column_name = 'primary_actor'
    ) as has_primary_actor,
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'stories' AND column_name = 'search_vector'
    ) as has_search_vector
)
SELECT 
  CASE 
    WHEN has_archived_status THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "2. ARCHIVED STATUS",
  CASE 
    WHEN has_primary_actor THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "3. PRIMARY_ACTOR COLUMN",
  CASE 
    WHEN has_search_vector THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as "4. SEARCH_VECTOR COLUMN"
FROM stories_checks;

-- Check feed_registry columns
WITH feed_columns AS (
  SELECT 
    COUNT(*) as col_count
  FROM information_schema.columns
  WHERE table_name = 'feed_registry'
    AND column_name IN (
      'feed_url', 'feed_name', 'topics', 'tier',
      'etag', 'last_modified', 'last_fetched',
      'failure_count', 'is_active', 'last_304_at'
    )
)
SELECT 
  CASE 
    WHEN col_count = 10 THEN '✅ PASS: All 10 feed_registry columns exist'
    ELSE '❌ FAIL: Only ' || col_count || ' of 10 columns found'
  END as "5. FEED_REGISTRY COLUMNS"
FROM feed_columns;

-- Check political_entries new columns
WITH pe_columns AS (
  SELECT 
    COUNT(*) as col_count
  FROM information_schema.columns
  WHERE table_name = 'political_entries'
    AND column_name IN (
      'url_canonical', 'url_hash', 'source_domain',
      'source_name', 'published_at', 'content_type', 'excerpt'
    )
)
SELECT 
  CASE 
    WHEN col_count = 7 THEN '✅ PASS: All 7 new political_entries columns exist'
    ELSE '❌ FAIL: Only ' || col_count || ' of 7 new columns found'
  END as "6. POLITICAL_ENTRIES NEW COLUMNS"
FROM pe_columns;

-- Check indexes
WITH index_check AS (
  SELECT 
    COUNT(*) as index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND (
      indexname LIKE '%search%' OR
      indexname LIKE '%topics%' OR
      indexname LIKE '%updated%' OR
      indexname LIKE '%article_url_date%'
    )
)
SELECT 
  CASE 
    WHEN index_count >= 4 THEN '✅ PASS: ' || index_count || ' key indexes found'
    ELSE '⚠️  WARNING: Only ' || index_count || ' indexes found'
  END as "7. INDEXES"
FROM index_check;

-- Check ID type fix
SELECT 
  CASE 
    WHEN data_type IN ('text', 'character varying') THEN '✅ PASS: political_entries.id is TEXT'
    ELSE '❌ FAIL: political_entries.id is ' || data_type || ' (should be TEXT)'
  END as "8. ID TYPE CHECK"
FROM information_schema.columns
WHERE table_name = 'political_entries' AND column_name = 'id';

-- Summary
WITH all_checks AS (
  SELECT 
    (SELECT COUNT(*) = 6 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('political_entries', 'stories', 'article_story', 'job_queue', 'feed_registry', 'budgets')) as tables_ok,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'stories_status_check' AND pg_get_constraintdef(oid) LIKE '%archived%') as status_ok,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'stories' AND column_name = 'primary_actor') as actor_ok,
    (SELECT COUNT(*) = 10 FROM information_schema.columns WHERE table_name = 'feed_registry' AND column_name IN ('feed_url', 'feed_name', 'topics', 'tier', 'etag', 'last_modified', 'last_fetched', 'failure_count', 'is_active', 'last_304_at')) as feed_ok,
    (SELECT data_type IN ('text', 'character varying') FROM information_schema.columns WHERE table_name = 'political_entries' AND column_name = 'id') as id_ok
)
SELECT 
  CASE 
    WHEN tables_ok AND status_ok AND actor_ok AND feed_ok AND id_ok THEN 
      '🎉 ALL CHECKS PASSED! Migration successful. Ready for Edge Functions.'
    ELSE 
      '⚠️ SOME CHECKS FAILED. Review the results above.'
  END as "FINAL RESULT"
FROM all_checks;
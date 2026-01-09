-- ============================================================================
-- BACKFILL: Map existing articles to feeds
-- ============================================================================
-- Purpose: Populate articles.feed_id for existing 377 articles
-- Method: Match article URL base domain to feed URL base domain
-- Expected Coverage: ~95% (359/377 articles)
-- Expected Duration: 3 minutes (mostly review time)
-- Prerequisites: Migration 027 completed successfully

-- ⚠️ CRITICAL: This script has a REVIEW step. Do NOT blindly execute all at once.
-- Run STEP 1, then STEP 2 (review), then STEP 3 (apply) only after confirming results.

-- ============================================================================
-- STEP 1: Create staging table and generate mappings
-- ============================================================================

-- Create staging table for review
CREATE TABLE IF NOT EXISTS admin.article_feed_map (
  url TEXT PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES public.feed_registry(id),
  decided_by TEXT DEFAULT 'auto',
  decided_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE admin.article_feed_map IS 
  'Staging table for backfill review. DROP after backfill complete.';

-- Clear any previous attempts
TRUNCATE TABLE admin.article_feed_map;

-- Generate mappings using base domain matching
-- Strips common prefixes: www., rss., feeds., m., amp.
WITH art AS (
  SELECT 
    id, 
    url,
    regexp_replace(
      lower(regexp_replace(url, '^https?://([^/]+).*$', '\1')),
      '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
      ''
    ) AS base_domain
  FROM public.articles
  WHERE feed_id IS NULL AND url IS NOT NULL
),
feeds AS (
  SELECT 
    id AS feed_id,
    feed_name,
    regexp_replace(
      lower(regexp_replace(feed_url, '^https?://([^/]+).*$', '\1')),
      '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
      ''
    ) AS base_domain
  FROM public.feed_registry
)
INSERT INTO admin.article_feed_map(url, feed_id, decided_by)
SELECT a.url, f.feed_id, 'auto-domain'
FROM art a
JOIN feeds f ON a.base_domain = f.base_domain
ON CONFLICT (url) DO NOTHING;

-- ============================================================================
-- STEP 2: REVIEW RESULTS (DO NOT SKIP THIS STEP)
-- ============================================================================

-- 2A) Summary by feed (expected results)
-- Expected:
-- - Feed ID 1 (Reuters): ~1 article
-- - Feed ID 3 (NYT): ~150 articles
-- - Feed ID 4 (WaPo): ~112 articles
-- - Feed ID 5 (Politico): ~93 articles
-- - Feed ID 6 (Test): ~3 articles
SELECT 
  f.id,
  f.feed_name,
  COUNT(m.url) as articles_to_map,
  CASE 
    WHEN COUNT(m.url) = 0 THEN '⚠️ No articles mapped'
    WHEN COUNT(m.url) < 10 THEN '✓ Low volume'
    WHEN COUNT(m.url) < 100 THEN '✓ Normal'
    ELSE '✓ High volume'
  END as status
FROM public.feed_registry f
LEFT JOIN admin.article_feed_map m ON m.feed_id = f.id
GROUP BY f.id, f.feed_name
ORDER BY f.id;

-- 2B) Unmapped articles (expected: ~18 test/example articles)
SELECT 
  COUNT(*) as unmapped_count,
  CASE 
    WHEN COUNT(*) < 20 THEN '✓ Acceptable (test data)'
    WHEN COUNT(*) < 50 THEN '⚠️ Investigate domains'
    ELSE '🛑 High unmapped count - review domains'
  END as assessment
FROM public.articles a
WHERE a.feed_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM admin.article_feed_map m WHERE m.url = a.url
  );

-- 2C) Sample of unmapped articles (manual review)
SELECT 
  a.url,
  a.source_domain,
  regexp_replace(
    lower(regexp_replace(a.url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
    ''
  ) AS extracted_base_domain,
  'No matching feed' as reason
FROM public.articles a
WHERE a.feed_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM admin.article_feed_map m WHERE m.url = a.url
  )
ORDER BY a.source_domain, a.url
LIMIT 10;

-- 2D) CRITICAL: Sanity check for multi-mapping (MUST BE ZERO)
-- If this returns rows, DO NOT PROCEED - investigate conflict
SELECT 
  url, 
  COUNT(*) as feed_count,
  array_agg(feed_id) as conflicting_feeds,
  '🛑 STOP - Multiple feeds claimed this URL' as action
FROM admin.article_feed_map 
GROUP BY url 
HAVING COUNT(*) > 1;

-- 2E) Sample of mappings for manual verification
SELECT 
  a.url,
  a.source_domain,
  regexp_replace(
    lower(regexp_replace(a.url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
    ''
  ) AS article_base_domain,
  f.id as feed_id,
  f.feed_name,
  regexp_replace(
    lower(regexp_replace(f.feed_url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
    ''
  ) AS feed_base_domain,
  CASE 
    WHEN regexp_replace(
      lower(regexp_replace(a.url, '^https?://([^/]+).*$', '\1')),
      '^(www\.|rss\.|feeds\.|m\.|amp\.)', ''
    ) = regexp_replace(
      lower(regexp_replace(f.feed_url, '^https?://([^/]+).*$', '\1')),
      '^(www\.|rss\.|feeds\.|m\.|amp\.)', ''
    ) THEN '✓ Match'
    ELSE '🛑 Mismatch'
  END as validation
FROM admin.article_feed_map m
JOIN public.articles a ON a.url = m.url
JOIN public.feed_registry f ON f.id = m.feed_id
ORDER BY f.feed_name, a.url
LIMIT 20;

-- ============================================================================
-- DECISION POINT: Review all results above before proceeding
-- ============================================================================
--
-- ✅ PROCEED to STEP 3 if:
-- - Summary counts look reasonable (NYT ~150, WaPo ~112, Politico ~93)
-- - Unmapped count < 20 (acceptable test data)
-- - Multi-mapping query returns ZERO rows
-- - Sample mappings show correct base domain matches
--
-- ⚠️ INVESTIGATE if:
-- - Any feed has 0 mapped articles (except AP/Test Feed)
-- - Unmapped count > 50
-- - Sample mappings show mismatches
--
-- 🛑 DO NOT PROCEED if:
-- - Multi-mapping query returns ANY rows
-- - Sample validation shows '🛑 Mismatch' entries
-- - You're unsure about any results
--
-- ============================================================================

-- ============================================================================
-- STEP 3: Apply backfill (ONLY AFTER REVIEWING STEP 2)
-- ============================================================================

-- Apply mappings to articles table
UPDATE public.articles a
SET feed_id = m.feed_id,
    updated_at = NOW()
FROM admin.article_feed_map m
WHERE a.url = m.url 
  AND a.feed_id IS NULL;

-- Get row count of update
-- Expected: ~359 rows updated
SELECT 
  'Backfill applied' as status,
  COUNT(*) as rows_updated
FROM admin.article_feed_map;

-- ============================================================================
-- STEP 4: Post-backfill verification
-- ============================================================================

-- 4A) Overall coverage
SELECT 
  CASE 
    WHEN feed_id IS NOT NULL THEN '✓ Mapped to feed'
    ELSE '○ No feed (legacy/manual)'
  END as status,
  COUNT(*) as article_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM public.articles
GROUP BY CASE WHEN feed_id IS NOT NULL THEN '✓ Mapped to feed' ELSE '○ No feed (legacy/manual)' END
ORDER BY article_count DESC;

-- Expected result:
-- ✓ Mapped to feed:      359  (95.2%)
-- ○ No feed (legacy):     18  ( 4.8%)

-- 4B) Detailed breakdown by feed
SELECT 
  COALESCE(f.feed_name, '(No feed)') as feed_name,
  COALESCE(f.id::text, 'NULL') as feed_id,
  COUNT(a.id) as article_count,
  MIN(a.created_at) as oldest_article,
  MAX(a.created_at) as newest_article
FROM public.articles a
LEFT JOIN public.feed_registry f ON f.id = a.feed_id
GROUP BY f.feed_name, f.id
ORDER BY article_count DESC;

-- 4C) Verify no orphaned mappings (should be 0)
SELECT 
  COUNT(*) as orphaned_mappings,
  CASE 
    WHEN COUNT(*) = 0 THEN '✓ Clean'
    ELSE '⚠️ Orphaned mappings exist'
  END as status
FROM admin.article_feed_map m
WHERE NOT EXISTS (
  SELECT 1 FROM public.articles a WHERE a.url = m.url
);

-- ============================================================================
-- STEP 5: Cleanup (OPTIONAL - can keep for reference)
-- ============================================================================

-- Option A: Keep staging table for reference
-- COMMENT: Useful for debugging during transition period

-- Option B: Drop staging table (saves space)
-- DROP TABLE IF EXISTS admin.article_feed_map;

-- Recommendation: Keep for 7 days, then drop

-- ============================================================================
-- BACKFILL COMPLETE
-- ============================================================================
--
-- ✅ Success indicators:
-- - ~95% of articles mapped to feeds
-- - ~5% unmapped (acceptable legacy data)
-- - No orphaned mappings
-- - Article counts match feed sources
--
-- ➡️ Next step: Run 04_migration_028_rpcs.sql
--
-- ============================================================================

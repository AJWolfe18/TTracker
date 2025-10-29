-- ============================================================================
-- BACKFILL STEP 2: CRITICAL MANUAL REVIEW (DO NOT SKIP)
-- ============================================================================

-- 2A) Summary by feed
-- Expected: Reuters ~1, NYT ~150, WaPo ~112, Politico ~93
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

-- 2B) Unmapped articles count
-- Expected: ~18-21 unmapped (test data)
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

-- 2C) Sample of unmapped articles
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

-- 2D) 🛑 CRITICAL: Multi-mapping check (MUST BE ZERO)
-- If this returns ANY rows, STOP and investigate
SELECT
  url,
  COUNT(*) as feed_count,
  array_agg(feed_id) as conflicting_feeds,
  '🛑 STOP - Multiple feeds claimed this URL' as action
FROM admin.article_feed_map
GROUP BY url
HAVING COUNT(*) > 1;

-- 2E) Sample mappings for verification
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

-- 2F) Coverage analysis
SELECT
  (SELECT COUNT(*) FROM admin.article_feed_map) as mapped_count,
  (SELECT COUNT(*) FROM public.articles WHERE url IS NOT NULL) as total_articles,
  ROUND(
    100.0 * (SELECT COUNT(*) FROM admin.article_feed_map) /
    NULLIF((SELECT COUNT(*) FROM public.articles WHERE url IS NOT NULL), 0),
    1
  ) as coverage_percent,
  CASE
    WHEN ROUND(
      100.0 * (SELECT COUNT(*) FROM admin.article_feed_map) /
      NULLIF((SELECT COUNT(*) FROM public.articles WHERE url IS NOT NULL), 0),
      1
    ) >= 85 THEN '✅ Ready to proceed'
    ELSE '⚠️ Coverage below 85% threshold'
  END as status;

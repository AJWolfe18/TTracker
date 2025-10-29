-- ============================================================================
-- BACKFILL STEP 3: Apply UPDATE (ONLY AFTER STEP 2 REVIEW PASSES)
-- ============================================================================
-- DO NOT RUN THIS UNTIL:
-- - Multi-mapping query returned ZERO rows
-- - Coverage is ≥85%
-- - Sample mappings look correct
-- ============================================================================

-- Apply mappings to articles table
UPDATE public.articles a
SET feed_id = m.feed_id,
    updated_at = NOW()
FROM admin.article_feed_map m
WHERE a.url = m.url
  AND a.feed_id IS NULL;

-- Post-update verification
SELECT
  'Backfill applied' as status,
  (SELECT COUNT(*) FROM admin.article_feed_map) as mappings_applied,
  (SELECT COUNT(*) FROM public.articles WHERE feed_id IS NOT NULL) as articles_with_feed_id,
  (SELECT COUNT(*) FROM public.articles WHERE feed_id IS NULL) as articles_without_feed_id;

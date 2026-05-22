-- Migration 093: Drop duplicate indexes flagged by Supabase Performance Advisor
-- Applied: TEST then PROD (via Supabase Dashboard → SQL Editor)
--
-- Estimated savings: ~100MB+ (duplicate HNSW index alone = 78MB)

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ============================================================================
-- 1. Duplicate HNSW index on stories.centroid_embedding_v1 (~78MB saved)
--    Keep: ix_stories_centroid_emb_v1_hnsw (migration 022, explicit m=16)
--    Drop: ix_stories_centroid_hnsw (migration 024, same params via defaults)
-- ============================================================================
DROP INDEX IF EXISTS public.ix_stories_centroid_hnsw;

-- ============================================================================
-- 2. article_story: 3 identical indexes on same column(s)
--    Keep: article_story_pkey (primary key, can't drop)
--    Drop: ux_article_story_article, ux_article_story_unique
-- ============================================================================
DROP INDEX IF EXISTS public.ux_article_story_article;
DROP INDEX IF EXISTS public.ux_article_story_unique;

-- ============================================================================
-- 3. articles: duplicate source indexes
--    Keep: idx_articles_source_domain (more specific name)
--    Drop: idx_articles_source
-- ============================================================================
DROP INDEX IF EXISTS public.idx_articles_source;

-- ============================================================================
-- 4. feed_compliance_rules: pkey duplicated by unique constraint
--    Keep: feed_compliance_rules_pkey
--    Drop: uq_feed_compliance_rules_feed
-- ============================================================================
ALTER TABLE public.feed_compliance_rules DROP CONSTRAINT IF EXISTS uq_feed_compliance_rules_feed;

-- ============================================================================
-- 5. feed_registry: duplicate unique indexes on feed URL
--    Keep: uq_feed_registry_feed_url
--    Drop: ux_feed_registry_feed_url
-- ============================================================================
DROP INDEX IF EXISTS public.ux_feed_registry_feed_url;

-- ============================================================================
-- 6. political_entries: duplicate unique indexes (legacy table)
--    Keep: uq_pol_entries_urlhash_day
--    Drop: uq_political_entries_urlhash_day
-- ============================================================================
ALTER TABLE public.political_entries DROP CONSTRAINT IF EXISTS uq_political_entries_urlhash_day;

-- ============================================================================
-- 7. Fix RLS initplan warnings on admin tables
--    Replace auth.uid() with (select auth.uid()) for per-statement eval
-- ============================================================================
DROP POLICY IF EXISTS "Service role only" ON admin.content_history;
CREATE POLICY "Service role only" ON admin.content_history
  FOR ALL USING ((select current_setting('role')) = 'service_role');

DROP POLICY IF EXISTS "Service role only" ON admin.action_log;
CREATE POLICY "Service role only" ON admin.action_log
  FOR ALL USING ((select current_setting('role')) = 'service_role');

-- ============================================================================
-- 8. Fix duplicate permissive RLS policies on executive_orders
--    Keep: "Allow public read"
--    Drop: "Public read access" (duplicate)
-- ============================================================================
DROP POLICY IF EXISTS "Public read access" ON public.executive_orders;

COMMIT;

-- ============================================================================
-- ROLLBACK (if needed):
-- ============================================================================
/*
CREATE INDEX ix_stories_centroid_hnsw ON public.stories USING hnsw (centroid_embedding_v1 vector_cosine_ops);
CREATE UNIQUE INDEX ux_article_story_article ON public.article_story (article_id, story_id);
CREATE UNIQUE INDEX ux_article_story_unique ON public.article_story (article_id, story_id);
CREATE INDEX idx_articles_source ON public.articles (source_name);
CREATE UNIQUE INDEX uq_feed_compliance_rules_feed ON public.feed_compliance_rules (feed_id);
CREATE UNIQUE INDEX ux_feed_registry_feed_url ON public.feed_registry (url);
CREATE UNIQUE INDEX uq_political_entries_urlhash_day ON public.political_entries (url_hash, published_date);
CREATE POLICY "Public read access" ON public.executive_orders FOR SELECT USING (is_public = true);
CREATE POLICY "Service role only" ON admin.content_history FOR ALL USING (current_setting('role') = 'service_role');
CREATE POLICY "Service role only" ON admin.action_log FOR ALL USING (current_setting('role') = 'service_role');
*/

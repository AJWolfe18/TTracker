-- ============================================================================
-- BACKFILL STEP 1: Generate article→feed mappings in staging table
-- ============================================================================

-- Create admin schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS admin;

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

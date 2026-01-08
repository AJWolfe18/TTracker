-- ============================================================================
-- Migration 042: Require embeddings in get_unclustered_articles RPC
-- ============================================================================
-- Ticket: TTRC-299 (Hybrid clustering integration)
-- Issue: clusterArticle() needs embeddings for 40% of hybrid score
--        Without filter, RPC returns articles that can't be properly clustered
-- Fix: Add embedding_v1 IS NOT NULL filter to only return embedding-ready articles
-- ============================================================================

DROP FUNCTION IF EXISTS get_unclustered_articles(INT);

CREATE OR REPLACE FUNCTION get_unclustered_articles(limit_count INT DEFAULT 100)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  published_date DATE,
  url TEXT,
  excerpt TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.title,
    a.published_date,
    a.url,
    a.excerpt
  FROM articles a
  LEFT JOIN article_story ast ON a.id = ast.article_id
  WHERE
    ast.article_id IS NULL
    AND a.published_date >= CURRENT_DATE - INTERVAL '30 days'
    AND a.embedding_v1 IS NOT NULL  -- TTRC-299: Only return articles ready for hybrid clustering
  ORDER BY a.published_date DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_unclustered_articles IS
'Returns recent articles (last 30 days) not yet assigned to any story.
TTRC-299: Now requires embedding_v1 to ensure articles are ready for hybrid clustering.
Run enrichArticles() before clusterArticles() to generate embeddings first.';

-- ============================================================================
-- Migration 035: Fix get_unclustered_articles RPC Schema Alignment
-- ============================================================================
-- Ticket: TTRC-266 (RSS inline automation fix)
-- Issue: Migration 034 used wrong column name (description vs excerpt)
--        and wrong type (TIMESTAMPTZ vs DATE for published_date)
-- Fix: Align RPC with actual articles table schema from migration 005a
-- Verified: Parameter name (limit_count) matches all JS callers
-- ============================================================================

DROP FUNCTION IF EXISTS get_unclustered_articles(INT);

CREATE OR REPLACE FUNCTION get_unclustered_articles(limit_count INT DEFAULT 100)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  published_date DATE,      -- VERIFIED: Matches GENERATED column type
  url TEXT,
  excerpt TEXT              -- VERIFIED: Matches actual column name
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.published_date,        -- DATE type
    a.url,
    a.excerpt                -- Column exists
  FROM articles a
  LEFT JOIN article_story ast ON a.id = ast.article_id
  WHERE 
    ast.article_id IS NULL
    AND a.published_date >= CURRENT_DATE - INTERVAL '30 days'  -- KEPT: Performance safeguard
  ORDER BY a.published_date DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_unclustered_articles IS 
'Returns recent articles (last 30 days) not yet assigned to any story. 
Fixed in migration 035 to use correct column names (excerpt, not description) 
and correct type (DATE, not TIMESTAMPTZ) matching articles table schema.
Verified: limit_count parameter matches all JS callers.';

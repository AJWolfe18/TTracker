-- ============================================================================
-- Migration 034: RSS Tracker Inline Infrastructure
-- ============================================================================
-- Ticket: TTRC-266, TTRC-267
-- Purpose: Inline RSS automation infrastructure for GitHub Actions runner
-- Date: 2025-11-17
--
-- Creates:
-- 1. admin.run_stats table for execution tracking
-- 2. increment_budget_with_limit() RPC for atomic budget enforcement
-- 3. acquire_feed_lock() / release_feed_lock() RPCs for concurrency control
-- 4. get_unclustered_articles() RPC for clustering workflow
-- 5. Performance indexes for feed selection and run stats queries
--
-- Dependencies: Requires budgets table from migration 020
-- ============================================================================

-- ============================================================================
-- 1. ADMIN SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS admin;

COMMENT ON SCHEMA admin IS 'Administrative tables and functions for RSS automation tracking';

-- ============================================================================
-- 2. RUN STATS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin.run_stats (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL,
  run_started_at TIMESTAMPTZ NOT NULL,
  run_finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_success', 'failed', 'skipped_budget')),
  
  -- Feed processing metrics
  feeds_total INT DEFAULT 0,
  feeds_processed INT DEFAULT 0,
  feeds_succeeded INT DEFAULT 0,
  feeds_failed INT DEFAULT 0,
  feeds_skipped_lock INT DEFAULT 0,
  feeds_304_cached INT DEFAULT 0,
  
  -- Story processing metrics
  stories_clustered INT DEFAULT 0,
  stories_enriched INT DEFAULT 0,
  
  -- Budget tracking
  total_openai_cost_usd NUMERIC(10,4) DEFAULT 0,
  enrichment_skipped_budget INT DEFAULT 0,
  
  -- Optional tier stats (JSONB for flexibility)
  feeds_by_tier JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE admin.run_stats IS 'Execution tracking for RSS automation runs (production + test environments)';
COMMENT ON COLUMN admin.run_stats.environment IS 'Environment identifier: production, test, or local';
COMMENT ON COLUMN admin.run_stats.status IS 'Run outcome: success (all feeds OK), partial_success (some failures), failed (critical error), skipped_budget (budget exceeded)';
COMMENT ON COLUMN admin.run_stats.feeds_304_cached IS 'Feeds skipped due to HTTP 304 Not Modified (cached)';
COMMENT ON COLUMN admin.run_stats.feeds_by_tier IS 'Optional JSON breakdown of feed metrics by tier: {tier_1: {total: 5, succeeded: 4, failed: 1}, ...}';

-- Performance index for recent runs queries
CREATE INDEX IF NOT EXISTS idx_run_stats_env_started
  ON admin.run_stats (environment, run_started_at DESC);

COMMENT ON INDEX admin.idx_run_stats_env_started IS 'Optimizes queries for recent runs by environment (used in Phase 6/7 reporting)';

-- ============================================================================
-- 3. ATOMIC BUDGET ENFORCEMENT RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_budget_with_limit(
  day_param DATE,
  amount_usd NUMERIC,
  call_count INT,
  daily_limit NUMERIC DEFAULT 5.00
)
RETURNS TABLE (
  success BOOLEAN,
  new_total NUMERIC,
  remaining NUMERIC
) AS $$
DECLARE
  current_total NUMERIC;
  current_calls INT;
  new_total_value NUMERIC;
BEGIN
  -- Acquire row lock to prevent race conditions
  SELECT spent_usd, openai_calls INTO current_total, current_calls
  FROM budgets
  WHERE day = day_param
  FOR UPDATE;
  
  -- If no row exists, treat as zero
  IF NOT FOUND THEN
    current_total := 0;
    current_calls := 0;
  END IF;
  
  new_total_value := current_total + amount_usd;
  
  -- Check if increment would exceed limit
  IF new_total_value > daily_limit THEN
    -- Return failure without updating
    RETURN QUERY SELECT 
      false AS success,
      current_total AS new_total,
      (daily_limit - current_total) AS remaining;
    RETURN;
  END IF;
  
  -- Within limit: update or insert
  INSERT INTO budgets (day, spent_usd, openai_calls)
  VALUES (day_param, amount_usd, call_count)
  ON CONFLICT (day) DO UPDATE
  SET 
    spent_usd = budgets.spent_usd + EXCLUDED.spent_usd,
    openai_calls = budgets.openai_calls + EXCLUDED.openai_calls;
  
  -- Return success with new totals
  RETURN QUERY SELECT 
    true AS success,
    new_total_value AS new_total,
    (daily_limit - new_total_value) AS remaining;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_budget_with_limit IS 'Atomically increment daily budget if within limit. Uses FOR UPDATE to prevent race conditions. Returns success=false if would exceed daily_limit.';

-- ============================================================================
-- 4. ADVISORY LOCK RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION acquire_feed_lock(feed_id_param INT)
RETURNS BOOLEAN AS $$
  SELECT pg_try_advisory_lock(feed_id_param);
$$ LANGUAGE sql;

COMMENT ON FUNCTION acquire_feed_lock IS 'Attempt to acquire advisory lock for feed processing. Returns true if lock acquired, false if already locked by another process.';

CREATE OR REPLACE FUNCTION release_feed_lock(feed_id_param INT)
RETURNS BOOLEAN AS $$
  SELECT pg_advisory_unlock(feed_id_param);
$$ LANGUAGE sql;

COMMENT ON FUNCTION release_feed_lock IS 'Release advisory lock for feed. Returns true if successfully released, false if lock was not held.';

-- ============================================================================
-- 5. GET UNCLUSTERED ARTICLES RPC
-- ============================================================================

-- Drop existing function first (return type changed from UUID to TEXT)
DROP FUNCTION IF EXISTS get_unclustered_articles(INT);

CREATE OR REPLACE FUNCTION get_unclustered_articles(limit_count INT DEFAULT 100)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  published_date TIMESTAMPTZ,
  url TEXT,
  description TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.published_date,
    a.url,
    a.description
  FROM articles a
  LEFT JOIN article_story ast ON a.id = ast.article_id
  WHERE 
    ast.article_id IS NULL  -- Not yet clustered
    AND a.published_date >= NOW() - INTERVAL '30 days'  -- Recent articles only
  ORDER BY a.published_date DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_unclustered_articles IS 'Returns recent articles (last 30 days) not yet assigned to any story. Used by clustering workflow to find articles needing story assignment.';

-- ============================================================================
-- 6. PERFORMANCE INDEXES
-- ============================================================================

-- Partial index for active feed selection query
CREATE INDEX IF NOT EXISTS idx_feed_registry_active_scheduling
  ON feed_registry (is_active, failure_count, last_fetched_at)
  WHERE is_active = true AND failure_count < 5;

COMMENT ON INDEX idx_feed_registry_active_scheduling IS 'Optimizes feed selection query: WHERE is_active = true AND failure_count < 5 ORDER BY last_fetched_at';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify admin schema created
-- SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'admin';

-- Verify admin.run_stats table structure
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_schema = 'admin' AND table_name = 'run_stats'
-- ORDER BY ordinal_position;

-- Verify functions created
-- SELECT routine_name, routine_type 
-- FROM information_schema.routines 
-- WHERE routine_schema = 'public' 
-- AND routine_name IN ('increment_budget_with_limit', 'acquire_feed_lock', 'release_feed_lock', 'get_unclustered_articles');

-- Verify indexes created
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE schemaname IN ('admin', 'public') 
-- AND indexname IN ('idx_run_stats_env_started', 'idx_feed_registry_active_scheduling');

-- Test budget increment (should succeed within limit)
-- SELECT * FROM increment_budget_with_limit(CURRENT_DATE, 0.50, 1, 5.00);

-- Test advisory locks (acquire then release)
-- SELECT acquire_feed_lock(999);
-- SELECT release_feed_lock(999);

-- Test unclustered articles query
-- SELECT COUNT(*) FROM get_unclustered_articles(10);

-- ============================================================================
-- END MIGRATION 034
-- ============================================================================

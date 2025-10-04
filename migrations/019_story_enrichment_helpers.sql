-- Migration 019: Story Enrichment Helpers
-- Purpose: Performance indexes, job idempotency, budget tracking RPC, security hardening
-- Related: TTRC-190 (Phase 2: Database Helpers)
-- Date: 2025-10-03

-- ============================================================================
-- 1. UNIQUE JOB IDEMPOTENCY INDEX
-- ============================================================================
-- Prevents duplicate enrichment jobs while jobs are pending/processing
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_payload
ON public.job_queue (type, payload_hash)
WHERE status IN ('pending', 'processing');

-- ============================================================================
-- 2. PERFORMANCE INDEXES
-- ============================================================================
-- Article-story lookups (used during enrichment to fetch 6 articles per story)
CREATE INDEX IF NOT EXISTS idx_article_story_story 
ON public.article_story(story_id);

-- Article ordering by date (used for chronological queries)
CREATE INDEX IF NOT EXISTS idx_articles_published_at 
ON public.articles(published_at DESC);

-- Composite index for enrichment article fetch (ORDER BY is_primary_source DESC, similarity_score DESC, matched_at DESC LIMIT 6)
CREATE INDEX IF NOT EXISTS idx_article_story_story_order
ON public.article_story (
  story_id,
  is_primary_source DESC,
  similarity_score DESC,
  matched_at DESC
);

-- Job claiming index (WHERE status='pending' AND run_at <= now() ORDER BY run_at LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_job_queue_pending_run_at
ON public.job_queue (status, run_at);

-- ============================================================================
-- 3. BUDGET TRACKING RPC FUNCTION
-- ============================================================================
-- Atomic budget updates for OpenAI API cost tracking
CREATE OR REPLACE FUNCTION increment_budget(
  p_day DATE,
  p_cost NUMERIC,
  p_calls INTEGER
) RETURNS VOID AS $$
  INSERT INTO public.budgets (day, spent_usd, openai_calls, cap_usd)
  VALUES (p_day, p_cost, p_calls, 50.00)
  ON CONFLICT (day) DO UPDATE 
  SET 
    spent_usd = budgets.spent_usd + EXCLUDED.spent_usd,
    openai_calls = budgets.openai_calls + EXCLUDED.openai_calls,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. SECURITY HARDENING
-- ============================================================================
-- Prevent public access to budget function
REVOKE ALL ON FUNCTION increment_budget(date, numeric, integer) FROM PUBLIC;

-- Grant only to service_role (Edge Functions)
GRANT EXECUTE ON FUNCTION increment_budget(date, numeric, integer) TO service_role;

-- Lock down search_path to prevent SQL injection
ALTER FUNCTION increment_budget(date, numeric, integer) SET search_path = public;

-- ============================================================================
-- 5. INCREASE SPENT_USD PRECISION FOR MICRO-COSTS
-- ============================================================================
-- Change from NUMERIC(8,2) to NUMERIC(10,6) to handle OpenAI micro-costs
-- OpenAI enrichment costs are ~$0.000167 per story (6 decimal places needed)
ALTER TABLE public.budgets 
  ALTER COLUMN spent_usd TYPE NUMERIC(10,6);

-- ============================================================================
-- 6. INITIALIZE TODAY'S BUDGET ROW
-- ============================================================================
-- Ensures today's budget exists for immediate tracking
INSERT INTO public.budgets (day, cap_usd, spent_usd, openai_calls)
VALUES (CURRENT_DATE, 50.00, 0.00, 0)
ON CONFLICT (day) DO NOTHING;

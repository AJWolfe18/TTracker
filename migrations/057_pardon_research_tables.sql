-- ============================================================
-- Migration 057: Pardon Research Tracking (Perplexity API)
-- ADO-253: Research cost tracking + error handling + idempotency
-- ============================================================
--
-- This migration adds:
-- 1. Idempotency columns on pardons (research_prompt_version, researched_at)
-- 2. Cost tracking table for Perplexity API calls
-- 3. Dead-letter queue for failed research (with dedupe)
-- 4. RLS hardening (no public access to internal tables)
-- 5. Data integrity constraints
-- 6. Query indexes for reporting/triage
--
-- Prerequisites: Migration 056_pardons_table.sql applied
-- ============================================================

SET search_path = public;

-- ============================================================
-- 1. Add idempotency columns to pardons table
-- ============================================================
-- These columns make the "pending" query trivial:
-- WHERE research_prompt_version IS DISTINCT FROM '1.0' OR researched_at IS NULL

ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS research_prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.pardons.research_prompt_version IS 'Version of Perplexity prompt used for research (null = never researched)';
COMMENT ON COLUMN public.pardons.researched_at IS 'When Perplexity research was last completed';

-- Index for finding pardons needing research (more selective)
CREATE INDEX IF NOT EXISTS idx_pardons_research_status_prompt
  ON public.pardons(research_status, research_prompt_version)
  WHERE is_public = false AND research_status IN ('pending', 'in_progress');

-- ============================================================
-- 2. Cost tracking for Perplexity API calls
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pardon_research_costs (
  id BIGSERIAL PRIMARY KEY,
  pardon_id BIGINT NOT NULL REFERENCES public.pardons(id) ON DELETE CASCADE,
  input_tokens INT,
  output_tokens INT,
  usd_estimate NUMERIC(10,6),
  model TEXT NOT NULL DEFAULT 'sonar',
  prompt_version TEXT NOT NULL,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pardon_research_costs IS 'Audit log of Perplexity API costs per pardon';

CREATE INDEX IF NOT EXISTS idx_pardon_research_costs_pardon_id
  ON public.pardon_research_costs(pardon_id);
CREATE INDEX IF NOT EXISTS idx_pardon_research_costs_run_id
  ON public.pardon_research_costs(run_id);
CREATE INDEX IF NOT EXISTS idx_pardon_research_costs_created_at_desc
  ON public.pardon_research_costs(created_at DESC);

-- ============================================================
-- 3. Dead-letter queue for failed research
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pardon_research_errors (
  id BIGSERIAL PRIMARY KEY,
  pardon_id BIGINT NOT NULL REFERENCES public.pardons(id) ON DELETE CASCADE,
  prompt_version TEXT NOT NULL,
  run_id TEXT,
  query TEXT,
  error_code TEXT,
  http_status INT,
  message TEXT,
  error_json JSONB,
  attempt_count INT NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pardon_research_errors IS 'Dead-letter queue for failed Perplexity research attempts';

-- Dedupe: one error record per pardon+prompt_version (UPSERT pattern)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pardon_research_errors_pardon_prompt
  ON public.pardon_research_errors(pardon_id, prompt_version);
CREATE INDEX IF NOT EXISTS idx_pardon_research_errors_last_attempt_at_desc
  ON public.pardon_research_errors(last_attempt_at DESC);
CREATE INDEX IF NOT EXISTS idx_pardon_research_errors_run_id
  ON public.pardon_research_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_pardon_research_errors_prompt_version
  ON public.pardon_research_errors(prompt_version);

-- ============================================================
-- 4. RLS hardening + REVOKE (hard deny for all)
-- ============================================================
-- Service role bypasses RLS, so enrichment scripts still work

ALTER TABLE public.pardon_research_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pardon_research_errors ENABLE ROW LEVEL SECURITY;

-- Hard-deny for anon, authenticated, AND public
REVOKE ALL ON TABLE public.pardon_research_costs FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.pardon_research_errors FROM anon, authenticated, PUBLIC;

-- Lock down sequences too (BIGSERIAL creates them)
DO $$
DECLARE
  seq1 text;
  seq2 text;
BEGIN
  seq1 := pg_get_serial_sequence('public.pardon_research_costs', 'id');
  seq2 := pg_get_serial_sequence('public.pardon_research_errors', 'id');

  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated;', seq1);
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated;', seq2);

  -- Grant to service_role for script inserts
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role;', seq1);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role;', seq2);
END $$;

-- ============================================================
-- 5. Data integrity CHECK constraints (idempotent, table-specific)
-- ============================================================

DO $$
BEGIN
  -- Costs: tokens must be non-negative
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_research_costs_tokens_nonneg_chk'
      AND conrelid = 'public.pardon_research_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_research_costs
      ADD CONSTRAINT pardon_research_costs_tokens_nonneg_chk
        CHECK ((input_tokens IS NULL OR input_tokens >= 0)
           AND (output_tokens IS NULL OR output_tokens >= 0));
  END IF;

  -- Costs: USD must be non-negative
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_research_costs_usd_nonneg_chk'
      AND conrelid = 'public.pardon_research_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_research_costs
      ADD CONSTRAINT pardon_research_costs_usd_nonneg_chk
        CHECK (usd_estimate IS NULL OR usd_estimate >= 0);
  END IF;

  -- Costs: model must be allowed value
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_research_costs_model_chk'
      AND conrelid = 'public.pardon_research_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_research_costs
      ADD CONSTRAINT pardon_research_costs_model_chk
        CHECK (model IN ('sonar', 'sonar-pro', 'sonar-reasoning'));
  END IF;

  -- Errors: attempt_count >= 1
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_research_errors_attempt_count_chk'
      AND conrelid = 'public.pardon_research_errors'::regclass
  ) THEN
    ALTER TABLE public.pardon_research_errors
      ADD CONSTRAINT pardon_research_errors_attempt_count_chk
        CHECK (attempt_count >= 1);
  END IF;

  -- Errors: http_status in valid range
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_research_errors_http_status_chk'
      AND conrelid = 'public.pardon_research_errors'::regclass
  ) THEN
    ALTER TABLE public.pardon_research_errors
      ADD CONSTRAINT pardon_research_errors_http_status_chk
        CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599));
  END IF;
END $$;

-- ============================================================
-- Verification queries
-- ============================================================
-- Run these after applying migration:

-- Check columns added to pardons
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'pardons' AND column_name IN ('research_prompt_version', 'researched_at');

-- Check tables created
-- SELECT tablename FROM pg_tables WHERE tablename IN ('pardon_research_costs', 'pardon_research_errors');

-- Check RLS enabled
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pardon_research_costs', 'pardon_research_errors');

-- Check constraints
-- SELECT conname FROM pg_constraint WHERE conrelid = 'pardon_research_costs'::regclass;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'pardon_research_errors'::regclass;

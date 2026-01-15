-- ============================================================
-- Migration 060: Pardon Enrichment Tracking (GPT)
-- ADO-246: Enrichment idempotency + cost tracking
-- ============================================================
--
-- This migration adds:
-- 1. enrichment_prompt_version column for idempotency
-- 2. pardon_enrichment_costs table for GPT API cost audit
-- 3. RLS + grants consistent with research tables
--
-- Prerequisites: Migration 056_pardons_table.sql applied
-- ============================================================

SET search_path = public;

-- ============================================================
-- 1. Add idempotency column to pardons table
-- ============================================================
-- Allows re-enrichment when prompt version changes:
-- WHERE enrichment_prompt_version IS DISTINCT FROM '1.0' OR enriched_at IS NULL

ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS enrichment_prompt_version TEXT;

COMMENT ON COLUMN public.pardons.enrichment_prompt_version IS 'Version of GPT prompt used for enrichment (null = never enriched)';

-- Index for finding pardons needing enrichment
CREATE INDEX IF NOT EXISTS idx_pardons_enrichment_status
  ON public.pardons(research_status, enrichment_prompt_version)
  WHERE research_status = 'complete' AND enriched_at IS NULL;

-- ============================================================
-- 2. Cost tracking for GPT API calls
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pardon_enrichment_costs (
  id BIGSERIAL PRIMARY KEY,
  pardon_id BIGINT NOT NULL REFERENCES public.pardons(id) ON DELETE CASCADE,
  input_tokens INT,
  output_tokens INT,
  usd_estimate NUMERIC(10,6),
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_version TEXT NOT NULL,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pardon_enrichment_costs IS 'Audit log of GPT API costs per pardon enrichment';

CREATE INDEX IF NOT EXISTS idx_pardon_enrichment_costs_pardon_id
  ON public.pardon_enrichment_costs(pardon_id);
CREATE INDEX IF NOT EXISTS idx_pardon_enrichment_costs_run_id
  ON public.pardon_enrichment_costs(run_id);
CREATE INDEX IF NOT EXISTS idx_pardon_enrichment_costs_created_at_desc
  ON public.pardon_enrichment_costs(created_at DESC);

-- ============================================================
-- 3. RLS hardening + REVOKE
-- ============================================================
-- Service role bypasses RLS, so enrichment scripts still work

ALTER TABLE public.pardon_enrichment_costs ENABLE ROW LEVEL SECURITY;

-- Hard-deny for anon, authenticated, AND public
REVOKE ALL ON TABLE public.pardon_enrichment_costs FROM anon, authenticated, PUBLIC;

-- Lock down sequence
DO $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.pardon_enrichment_costs', 'id');

  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated;', seq_name);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role;', seq_name);
END $$;

-- ============================================================
-- 4. Data integrity CHECK constraints
-- ============================================================

DO $$
BEGIN
  -- Tokens must be non-negative
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_enrichment_costs_tokens_nonneg_chk'
      AND conrelid = 'public.pardon_enrichment_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_enrichment_costs
      ADD CONSTRAINT pardon_enrichment_costs_tokens_nonneg_chk
        CHECK ((input_tokens IS NULL OR input_tokens >= 0)
           AND (output_tokens IS NULL OR output_tokens >= 0));
  END IF;

  -- USD must be non-negative
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_enrichment_costs_usd_nonneg_chk'
      AND conrelid = 'public.pardon_enrichment_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_enrichment_costs
      ADD CONSTRAINT pardon_enrichment_costs_usd_nonneg_chk
        CHECK (usd_estimate IS NULL OR usd_estimate >= 0);
  END IF;

  -- Model must be allowed value
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pardon_enrichment_costs_model_chk'
      AND conrelid = 'public.pardon_enrichment_costs'::regclass
  ) THEN
    ALTER TABLE public.pardon_enrichment_costs
      ADD CONSTRAINT pardon_enrichment_costs_model_chk
        CHECK (model IN ('gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'));
  END IF;
END $$;

-- ============================================================
-- Verification queries
-- ============================================================
-- Run these after applying migration:

-- Check column added
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'pardons' AND column_name = 'enrichment_prompt_version';

-- Check table created
-- SELECT tablename FROM pg_tables WHERE tablename = 'pardon_enrichment_costs';

-- Check RLS enabled
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'pardon_enrichment_costs';

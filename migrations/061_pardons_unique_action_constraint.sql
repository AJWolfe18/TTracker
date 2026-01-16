-- Migration 061: Pardons Unique Action Constraint
-- Purpose: Support multiple clemency actions per recipient (e.g., commutation then pardon)
-- Created: 2026-01-15
--
-- Problem: ON CONFLICT (recipient_slug) DO NOTHING loses records when same person
-- has multiple clemency actions (e.g., Zuberi: commutation 2025-05-28, pardon 2025-10-01)
--
-- Solution: Add composite unique constraint on (recipient_slug, clemency_type, pardon_date)
-- This allows:
--   - Same person, different dates (multiple actions over time)
--   - Same person, same date, different types (rare but possible)
-- While preventing:
--   - True duplicates (same person, same type, same date)

-- ============================================================================
-- 1. ADD COMPOSITE UNIQUE CONSTRAINT
-- ============================================================================

-- Create unique index for clemency actions
-- Using CREATE INDEX IF NOT EXISTS for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_pardons_action
  ON public.pardons (recipient_slug, clemency_type, pardon_date);

-- ============================================================================
-- 2. OPTIONAL: Add data_quality_flags for tracking review reasons
-- ============================================================================
-- This allows tracking WHY something needs review instead of just a boolean

ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS data_quality_flags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.pardons.data_quality_flags IS
  'Tracks reasons for review: duplicate_candidate, missing_primary_source, multi_value_field, etc.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running, verify with:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'pardons' AND indexname = 'uq_pardons_action';

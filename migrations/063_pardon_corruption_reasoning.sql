-- ============================================================
-- Migration 058: Add corruption_reasoning column to pardons
-- ADO-253: Store Perplexity's reasoning for corruption level
-- ============================================================
--
-- This column captures "why did we rate this a 4?" for the spicy meter.
-- Nullable because:
-- - Older rows won't have it
-- - "no_connection" cases may have thin reasoning
-- - We don't want publish blocked by missing explanation
--
-- Prerequisites: Migration 057_pardon_research_tables.sql applied
-- ============================================================

-- Note: Using fully qualified names (public.pardons) so no search_path needed

ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS corruption_reasoning TEXT;

COMMENT ON COLUMN public.pardons.corruption_reasoning IS 'Perplexity reasoning for corruption_level score (nullable for no_connection cases)';

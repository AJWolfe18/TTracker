-- Migration 088: SCOTUS Scout Live Run Columns
-- ADO-457: Add metadata and field columns for Scout live writes
-- Created: 2026-03-29
--
-- Adds:
-- - substantive_winner TEXT: Free-text "who benefits" (Scout-owned, replaces prevailing_party for Scout writes)
-- - fact_extracted_at TIMESTAMPTZ: When Scout last extracted facts for this case
-- - fact_sources TEXT[]: Perplexity citation URLs from the Scout run
-- - fact_review_status TEXT: Scout's validation verdict (ok/needs_review/failed)
--
-- DEPENDENCY: Requires 067_scotus_two_pass.sql

-- ============================================================================
-- 1. SUBSTANTIVE WINNER (free-text, replaces prevailing_party for Scout writes)
-- ============================================================================
-- prevailing_party stays untouched with its enum CHECK constraint.
-- Scout writes to this new column instead.
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS substantive_winner TEXT;

COMMENT ON COLUMN scotus_cases.substantive_winner IS
'Who actually benefits from the ruling (1-2 sentences). Written by Scout. Distinct from prevailing_party (enum).';

-- ============================================================================
-- 2. FACT EXTRACTION TIMESTAMP
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS fact_extracted_at TIMESTAMPTZ;

COMMENT ON COLUMN scotus_cases.fact_extracted_at IS
'When Scout last extracted facts for this case.';

-- ============================================================================
-- 3. FACT SOURCES (Perplexity citations)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS fact_sources TEXT[];

COMMENT ON COLUMN scotus_cases.fact_sources IS
'Perplexity citation URLs from Scout run (capped at 20).';

-- ============================================================================
-- 4. FACT REVIEW STATUS (Scout validation verdict)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS fact_review_status TEXT
  CHECK (fact_review_status IS NULL OR fact_review_status IN ('ok', 'needs_review', 'failed'));

COMMENT ON COLUMN scotus_cases.fact_review_status IS
'Scout validation verdict: ok (write-eligible), needs_review (uncertain), failed (parse/validation error).';

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- ============================================================================
--
-- -- 1. Verify all 4 columns exist (must return 4 rows)
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'scotus_cases'
--   AND column_name IN ('substantive_winner', 'fact_extracted_at', 'fact_sources', 'fact_review_status')
-- ORDER BY column_name;
--
-- -- 2. Verify CHECK constraint on fact_review_status
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'scotus_cases'::regclass
--   AND conname LIKE '%fact_review_status%';
--
-- ============================================================================
-- DOWN MIGRATION (rollback)
-- ============================================================================
--
-- ALTER TABLE scotus_cases DROP COLUMN IF EXISTS substantive_winner;
-- ALTER TABLE scotus_cases DROP COLUMN IF EXISTS fact_extracted_at;
-- ALTER TABLE scotus_cases DROP COLUMN IF EXISTS fact_sources;
-- ALTER TABLE scotus_cases DROP COLUMN IF EXISTS fact_review_status;

-- Migration 067: SCOTUS Two-Pass Enrichment Schema
-- ADO-280: Two-pass architecture for factual accuracy
-- Created: 2026-01-21
--
-- This migration adds:
-- - enrichment_status lifecycle field (pending/enriched/flagged/failed)
-- - Pass 1 fact extraction fields (disposition, merits_reached, etc.)
-- - Confidence and review tracking fields
-- - Source quality tracking fields (debugging)
-- - Drift detection and error tracking
-- - Manual review tracking
--
-- DEPENDENCY: Requires 066_scotus_cases.sql

-- ============================================================================
-- 1. ENRICHMENT LIFECYCLE STATUS (CRITICAL for idempotency)
-- ============================================================================
-- IMPORTANT: Add WITHOUT default first, backfill, THEN set default.
-- If you add with DEFAULT, existing rows get 'pending' immediately,
-- making the backfill WHERE clause a no-op.

-- Step 1a: Add column WITHOUT default
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS enrichment_status TEXT
  CHECK (enrichment_status IN ('pending', 'enriched', 'flagged', 'failed'));

-- Step 1b: Backfill existing enriched cases (enriched_at IS NOT NULL)
UPDATE scotus_cases
SET enrichment_status = 'enriched'
WHERE enriched_at IS NOT NULL AND enrichment_status IS NULL;

-- Step 1c: Backfill remaining rows as 'pending'
UPDATE scotus_cases
SET enrichment_status = 'pending'
WHERE enrichment_status IS NULL;

-- Step 1d: NOW set the default for future inserts
ALTER TABLE scotus_cases
ALTER COLUMN enrichment_status SET DEFAULT 'pending';

-- ============================================================================
-- 2. PASS 1 FACT EXTRACTION FIELDS (NEW - not in 066)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS disposition TEXT
  CHECK (disposition IS NULL OR disposition IN ('affirmed', 'reversed', 'vacated', 'remanded',
                         'dismissed', 'granted', 'denied', 'other'));

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS merits_reached BOOLEAN;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS case_type TEXT
  CHECK (case_type IS NULL OR case_type IN ('merits', 'procedural', 'shadow_docket', 'cert_stage', 'unclear'));

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS holding TEXT;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS prevailing_party TEXT
  CHECK (prevailing_party IS NULL OR prevailing_party IN ('petitioner', 'respondent', 'partial', 'unclear'));

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS practical_effect TEXT;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS dissent_exists BOOLEAN;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS evidence_quotes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- 3. CONFIDENCE AND REVIEW TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS fact_extraction_confidence TEXT
  CHECK (fact_extraction_confidence IS NULL OR fact_extraction_confidence IN ('high', 'medium', 'low'));

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS low_confidence_reason TEXT;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN DEFAULT false;

-- ============================================================================
-- 4. SOURCE QUALITY TRACKING (debugging)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS source_char_count INTEGER;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS contains_anchor_terms BOOLEAN;

-- ============================================================================
-- 5. DRIFT DETECTION + ERROR TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS drift_detected BOOLEAN DEFAULT false;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS drift_reason TEXT;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- ============================================================================
-- 6. MANUAL REVIEW TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS manual_reviewed_at TIMESTAMPTZ;

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS manual_review_note TEXT;

-- ============================================================================
-- 7. INDEXES
-- ============================================================================

-- Index for manual review queue
CREATE INDEX IF NOT EXISTS idx_scotus_needs_review
ON scotus_cases (needs_manual_review)
WHERE needs_manual_review = true;

-- Index for drift detection
CREATE INDEX IF NOT EXISTS idx_scotus_drift
ON scotus_cases (drift_detected)
WHERE drift_detected = true;

-- Index for run selection (critical for idempotency)
CREATE INDEX IF NOT EXISTS idx_scotus_enrichment_status
ON scotus_cases (enrichment_status)
WHERE enrichment_status IN ('pending', 'failed');

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- ============================================================================
--
-- -- New columns exist
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'scotus_cases'
--   AND column_name IN ('enrichment_status', 'disposition', 'case_type',
--                       'fact_extraction_confidence', 'drift_detected');
--
-- -- enrichment_status backfill worked
-- SELECT enrichment_status, COUNT(*)
-- FROM scotus_cases
-- GROUP BY enrichment_status;
--
-- -- New indexes exist
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'scotus_cases'
--   AND indexname LIKE 'idx_scotus_%';

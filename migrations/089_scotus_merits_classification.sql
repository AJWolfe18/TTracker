-- Migration 089: Add merits classification column for Scout v2 triage
-- ADO-457: Scout v2 Triage + Targeted Retry
-- Created: 2026-03-29
--
-- Adds is_merits_decision boolean for case classification.
-- NULL = not yet classified, true = merits, false = non-merits.
-- Triage step in Scout v2 classifies cases before enrichment.

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS is_merits_decision BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN scotus_cases.is_merits_decision IS
'Case classification: true=merits (eligible for enrichment), false=non-merits (cert denied, stay, GVR). NULL=not yet classified.';

-- Index for efficiently querying unclassified cases
CREATE INDEX IF NOT EXISTS idx_scotus_cases_merits_null
  ON scotus_cases(id)
  WHERE is_merits_decision IS NULL;

-- 072_scotus_clamp_fields.sql
-- ADO-300: SCOTUS clamp/retry/publish override fields
--
-- Adds columns to support:
-- 1. Clamping cert/procedural cases to safe output
-- 2. Retry ladder tracking (which model succeeded)
-- 3. Publish override for clamped cases (decouple from confidence)

BEGIN;

-- Add nullable columns first (idempotent)
ALTER TABLE IF EXISTS scotus_cases
  ADD COLUMN IF NOT EXISTS clamp_reason TEXT,
  ADD COLUMN IF NOT EXISTS publish_override BOOLEAN,
  ADD COLUMN IF NOT EXISTS facts_model_used TEXT,
  ADD COLUMN IF NOT EXISTS retry_reason TEXT;

-- Set default and NOT NULL on publish_override separately (idempotent)
ALTER TABLE scotus_cases
  ALTER COLUMN publish_override SET DEFAULT FALSE;

UPDATE scotus_cases SET publish_override = FALSE WHERE publish_override IS NULL;

ALTER TABLE scotus_cases
  ALTER COLUMN publish_override SET NOT NULL;

COMMENT ON COLUMN scotus_cases.clamp_reason IS
  'Clamp reason: missing_text, cert_no_merits, procedural_no_merits, drift_clamp, facts_failed, etc.';

COMMENT ON COLUMN scotus_cases.publish_override IS
  'When true, publish even if confidence < high (used for cert/procedural clamps only).';

COMMENT ON COLUMN scotus_cases.facts_model_used IS
  'Final model used for Pass 1 fact extraction after retries/fallbacks.';

COMMENT ON COLUMN scotus_cases.retry_reason IS
  'Why Pass 1 retried (e.g., missing_fields, stage_mismatch, missing_evidence).';

COMMIT;

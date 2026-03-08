-- ADO-438: Invariant check result columns
-- Replaces the old QA validator stack with 7 cheap invariant checks

ALTER TABLE scotus_cases
  ADD COLUMN IF NOT EXISTS invariant_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS invariant_failures JSONB;

COMMENT ON COLUMN scotus_cases.invariant_passed IS 'ADO-438: Whether all 7 invariant checks passed';
COMMENT ON COLUMN scotus_cases.invariant_failures IS 'ADO-438: Array of {code, detail} for failed invariant checks';

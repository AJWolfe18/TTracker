-- ADO-446: Add reconciliation_corrections column to scotus_cases
-- Stores array of { field, outcome, reason, old?, new? } from cross-check of Pass 1 vs SCOTUSblog

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS reconciliation_corrections JSONB DEFAULT NULL;

COMMENT ON COLUMN scotus_cases.reconciliation_corrections IS 'ADO-446: Array of reconciliation outcomes from cross-checking Pass 1 GPT output vs SCOTUSblog grounding data';

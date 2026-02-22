-- Migration 068: Add unique constraint on docket_number to prevent duplicates
-- ADO-280: CourtListener creates new cluster_ids for case revisions,
-- but docket_number is the true unique identifier for a SCOTUS case.

-- First, normalize existing docket_numbers (remove "No. " prefix)
UPDATE scotus_cases
SET docket_number = REGEXP_REPLACE(docket_number, '^No\.\s*', '')
WHERE docket_number LIKE 'No.%';

-- Add unique constraint (will fail if duplicates exist - run cleanup first)
ALTER TABLE scotus_cases
ADD CONSTRAINT scotus_cases_docket_number_unique UNIQUE (docket_number);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_scotus_cases_docket_number
ON scotus_cases(docket_number);

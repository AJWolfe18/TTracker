-- Migration 087: Add compound disposition values to scotus_cases CHECK constraint
-- Required for Scout live writes (ADO-457) — syllabus extractor produces these values
-- from official SCOTUS opinion judgment lines (e.g. "reversed and remanded")

-- Drop the existing constraint
ALTER TABLE scotus_cases
DROP CONSTRAINT IF EXISTS scotus_cases_disposition_check;

-- Re-add with compound disposition values
ALTER TABLE scotus_cases
ADD CONSTRAINT scotus_cases_disposition_check
  CHECK (disposition IS NULL OR disposition IN (
    'affirmed', 'reversed', 'vacated', 'remanded',
    'reversed_and_remanded', 'vacated_and_remanded', 'affirmed_and_remanded',
    'dismissed', 'granted', 'denied', 'GVR', 'other'
  ));

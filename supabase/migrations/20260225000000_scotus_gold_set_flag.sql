-- Migration 085: Add is_gold_set flag to scotus_cases (ADO-394)
-- Gold cases are protected from re-enrichment unless --force-gold is used.

ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS is_gold_set BOOLEAN DEFAULT FALSE;

UPDATE scotus_cases
SET is_gold_set = TRUE
WHERE id IN (286, 51, 192, 4, 64, 120, 133, 68, 63, 109);

COMMENT ON COLUMN scotus_cases.is_gold_set IS 'True = eval gold set case. Protected from re-enrichment unless --force-gold.';

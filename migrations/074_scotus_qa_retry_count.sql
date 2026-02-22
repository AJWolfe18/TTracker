-- Migration 074: Add qa_retry_count column to scotus_cases (ADO-309)
-- Purpose: Track how many QA retry attempts were made during enrichment
--
-- Columns added:
--   qa_retry_count: INTEGER default 0, tracks retry attempts for fixable QA issues

-- Use DO block for idempotent column addition
DO $$
BEGIN
    -- qa_retry_count: Tracks retry attempts for fixable QA issues
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_retry_count'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_retry_count INTEGER DEFAULT 0;

        RAISE NOTICE 'Added column: qa_retry_count';
    ELSE
        RAISE NOTICE 'Column qa_retry_count already exists';
    END IF;
END $$;

-- Comment on column for documentation
COMMENT ON COLUMN public.scotus_cases.qa_retry_count IS 'Number of QA retry attempts made during enrichment (max 1)';

-- Verification query
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'scotus_cases'
AND column_name = 'qa_retry_count';

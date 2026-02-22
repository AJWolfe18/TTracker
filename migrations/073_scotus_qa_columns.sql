-- Migration 073: Add QA columns to scotus_cases (ADO-308)
-- Purpose: Support deterministic QA validators with shadow mode
--
-- Columns added:
--   qa_status: pending_qa | approved | flagged | rejected | human_override
--   qa_verdict: APPROVE | FLAG | REJECT (from validators)
--   qa_issues: JSONB array of detected issues
--   qa_reviewed_at: When human reviewed (for flagged cases)
--   qa_review_note: Human reviewer notes

-- Use DO block for idempotent column additions
DO $$
BEGIN
    -- qa_status: Tracks case through QA workflow
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_status'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_status TEXT DEFAULT 'pending_qa';

        RAISE NOTICE 'Added column: qa_status';
    ELSE
        RAISE NOTICE 'Column qa_status already exists';
    END IF;

    -- qa_verdict: Raw verdict from validators (APPROVE/FLAG/REJECT)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_verdict'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_verdict TEXT;

        RAISE NOTICE 'Added column: qa_verdict';
    ELSE
        RAISE NOTICE 'Column qa_verdict already exists';
    END IF;

    -- qa_issues: JSONB array of issues detected by validators
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_issues'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_issues JSONB;

        RAISE NOTICE 'Added column: qa_issues';
    ELSE
        RAISE NOTICE 'Column qa_issues already exists';
    END IF;

    -- qa_reviewed_at: Timestamp of human review
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_reviewed_at'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_reviewed_at TIMESTAMPTZ;

        RAISE NOTICE 'Added column: qa_reviewed_at';
    ELSE
        RAISE NOTICE 'Column qa_reviewed_at already exists';
    END IF;

    -- qa_review_note: Human reviewer notes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'scotus_cases'
        AND column_name = 'qa_review_note'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD COLUMN qa_review_note TEXT;

        RAISE NOTICE 'Added column: qa_review_note';
    ELSE
        RAISE NOTICE 'Column qa_review_note already exists';
    END IF;
END $$;

-- Add CHECK constraint for qa_status values (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'scotus_cases'
        AND constraint_name = 'scotus_cases_qa_status_check'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD CONSTRAINT scotus_cases_qa_status_check
        CHECK (qa_status IN ('pending_qa', 'approved', 'flagged', 'rejected', 'human_override'));

        RAISE NOTICE 'Added constraint: scotus_cases_qa_status_check';
    ELSE
        RAISE NOTICE 'Constraint scotus_cases_qa_status_check already exists';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint scotus_cases_qa_status_check already exists (caught duplicate)';
END $$;

-- Add CHECK constraint for qa_verdict values (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'scotus_cases'
        AND constraint_name = 'scotus_cases_qa_verdict_check'
    ) THEN
        ALTER TABLE public.scotus_cases
        ADD CONSTRAINT scotus_cases_qa_verdict_check
        CHECK (qa_verdict IS NULL OR qa_verdict IN ('APPROVE', 'FLAG', 'REJECT'));

        RAISE NOTICE 'Added constraint: scotus_cases_qa_verdict_check';
    ELSE
        RAISE NOTICE 'Constraint scotus_cases_qa_verdict_check already exists';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint scotus_cases_qa_verdict_check already exists (caught duplicate)';
END $$;

-- Index for querying flagged cases needing review
CREATE INDEX IF NOT EXISTS idx_scotus_cases_qa_flagged
ON public.scotus_cases (qa_status, qa_reviewed_at)
WHERE qa_status = 'flagged';

-- Comment on columns for documentation
COMMENT ON COLUMN public.scotus_cases.qa_status IS 'QA workflow status: pending_qa, approved, flagged, rejected, human_override';
COMMENT ON COLUMN public.scotus_cases.qa_verdict IS 'Raw validator verdict: APPROVE, FLAG, REJECT';
COMMENT ON COLUMN public.scotus_cases.qa_issues IS 'JSONB array of detected issues from validators';
COMMENT ON COLUMN public.scotus_cases.qa_reviewed_at IS 'Timestamp when human reviewed flagged case';
COMMENT ON COLUMN public.scotus_cases.qa_review_note IS 'Notes from human reviewer';

-- Verification query
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'scotus_cases'
AND column_name LIKE 'qa_%'
ORDER BY column_name;

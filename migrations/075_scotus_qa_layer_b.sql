-- Migration 075: Add Layer B QA columns to scotus_cases (ADO-310)
-- Purpose: Support LLM-based QA validation with shadow mode and retry logic
--
-- Layer B columns (all nullable to support shadow mode):
--   qa_layer_b_verdict: APPROVE | FLAG | REJECT (NULL = NO_DECISION/not run)
--   qa_layer_b_issues: JSONB array of detected issues
--   qa_layer_b_confidence: 0-100 raw confidence from LLM
--   qa_layer_b_severity_score: 0-100 computed severity score
--   qa_layer_b_prompt_version: Version of the QA prompt used
--   qa_layer_b_model: Model used (e.g., gpt-4o-mini)
--   qa_layer_b_ran_at: Timestamp when Layer B ran
--   qa_layer_b_error: Error message if Layer B failed
--   qa_layer_b_latency_ms: Time taken for Layer B call
--   layer_b_retry_count: Number of content-level retries

-- Layer B verdict column (NULL allowed for NO_DECISION)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_verdict TEXT
    CHECK (qa_layer_b_verdict IS NULL OR qa_layer_b_verdict IN ('APPROVE', 'FLAG', 'REJECT'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B issues (JSONB array)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_issues JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B confidence (0-100)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_confidence INTEGER
    CHECK (qa_layer_b_confidence IS NULL OR (qa_layer_b_confidence >= 0 AND qa_layer_b_confidence <= 100));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B severity score (0-100)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_severity_score INTEGER
    CHECK (qa_layer_b_severity_score IS NULL OR (qa_layer_b_severity_score >= 0 AND qa_layer_b_severity_score <= 100));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B prompt version
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_prompt_version TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B model
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_model TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B ran at timestamp
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_ran_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B error message
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_error TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B latency tracking (optional performance metric)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN qa_layer_b_latency_ms INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Layer B retry count (content-level retries, max 1)
DO $$ BEGIN
  ALTER TABLE scotus_cases ADD COLUMN layer_b_retry_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Index for querying Layer B flagged/rejected cases needing review
CREATE INDEX IF NOT EXISTS idx_scotus_cases_qa_layer_b_flagged
ON public.scotus_cases (qa_layer_b_verdict, qa_layer_b_ran_at)
WHERE qa_layer_b_verdict IN ('FLAG', 'REJECT');

-- Comments for documentation
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_verdict IS 'Layer B LLM verdict: APPROVE, FLAG, REJECT (NULL = not run or NO_DECISION)';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_issues IS 'JSONB array of issues detected by Layer B LLM';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_confidence IS 'Raw confidence (0-100) from Layer B LLM';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_severity_score IS 'Computed severity score (0-100) from issues';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_prompt_version IS 'Version of QA prompt used (e.g., v1-ado310)';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_model IS 'Model used for Layer B (e.g., gpt-4o-mini)';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_ran_at IS 'Timestamp when Layer B QA ran';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_error IS 'Error message if Layer B failed';
COMMENT ON COLUMN public.scotus_cases.qa_layer_b_latency_ms IS 'Time in ms for Layer B LLM call';
COMMENT ON COLUMN public.scotus_cases.layer_b_retry_count IS 'Number of content-level retries for Layer B (max 1)';

-- Verification query
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'scotus_cases'
AND (column_name LIKE 'qa_layer_b%' OR column_name = 'layer_b_retry_count')
ORDER BY column_name;

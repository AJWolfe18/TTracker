-- 078_qa_overrides.sql
-- SCOTUS-only override log

BEGIN;

CREATE TABLE IF NOT EXISTS public.qa_overrides (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'scotus_case',
  content_id BIGINT NOT NULL,
  original_verdict TEXT NOT NULL,
  override_verdict TEXT NOT NULL,
  override_reason TEXT NOT NULL,
  dismissed_issues JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_id TEXT NOT NULL,
  add_to_gold_set BOOLEAN DEFAULT false,

  CONSTRAINT qa_overrides_scotus_only CHECK (content_type = 'scotus_case'),
  CONSTRAINT qa_overrides_original_verdict CHECK (original_verdict IN ('APPROVE','FLAG','REJECT')),
  CONSTRAINT qa_overrides_override_verdict CHECK (override_verdict IN ('APPROVE','FLAG','REJECT'))
);

CREATE INDEX IF NOT EXISTS idx_qa_overrides_content
  ON public.qa_overrides (content_type, content_id);

CREATE INDEX IF NOT EXISTS idx_qa_overrides_created
  ON public.qa_overrides (created_at DESC);

COMMIT;

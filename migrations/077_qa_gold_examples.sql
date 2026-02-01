-- 077_qa_gold_examples.sql
-- SCOTUS-only gold examples (Phase 4 uses embeddings; safe to create now)

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.qa_gold_examples (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'scotus_case',
  content_id BIGINT NOT NULL,
  expected_verdict TEXT NOT NULL,
  expected_issues TEXT[] NOT NULL DEFAULT '{}',
  input_snapshot JSONB NOT NULL,
  correct_issues JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  embedding VECTOR(1536),

  CONSTRAINT qa_gold_scotus_only CHECK (content_type = 'scotus_case'),
  CONSTRAINT qa_gold_expected_verdict CHECK (expected_verdict IN ('APPROVE','FLAG','REJECT'))
);

CREATE INDEX IF NOT EXISTS idx_qa_gold_content
  ON public.qa_gold_examples (content_type, content_id);

CREATE INDEX IF NOT EXISTS idx_qa_gold_active
  ON public.qa_gold_examples (is_active)
  WHERE is_active = true;

COMMIT;

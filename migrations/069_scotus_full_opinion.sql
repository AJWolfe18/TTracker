-- Migration 069: Separate table for full opinion text
-- Rationale: Prevents accidental egress from SELECT * on scotus_cases

-- Create separate table for full opinion storage
-- NOTE: No source_data_version here - if row exists, it's v2 by definition
-- Single source of truth: scotus_cases.source_data_version
CREATE TABLE IF NOT EXISTS scotus_opinions (
  case_id UUID PRIMARY KEY REFERENCES scotus_cases(id) ON DELETE CASCADE,
  opinion_full_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,  -- sha256 hex, enables skip-if-unchanged + change detection
  char_count INTEGER GENERATED ALWAYS AS (LENGTH(opinion_full_text)) STORED,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add version tracking to main table (lightweight)
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS source_data_version TEXT DEFAULT 'v1-syllabus';

-- CRITICAL: Backfill existing NULLs BEFORE adding CHECK constraint
-- (Otherwise constraint fails on existing rows)
UPDATE scotus_cases
SET source_data_version = 'v1-syllabus'
WHERE source_data_version IS NULL;

-- IDEMPOTENT: Drop constraint if exists, then recreate
-- (Plain ADD CONSTRAINT fails if already exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_source_data_version'
  ) THEN
    ALTER TABLE scotus_cases DROP CONSTRAINT chk_source_data_version;
  END IF;
END $$;

ALTER TABLE scotus_cases
ADD CONSTRAINT chk_source_data_version
CHECK (source_data_version IN ('v1-syllabus', 'v2-full-opinion'));

-- NOTE: No index needed on scotus_opinions(case_id) - PRIMARY KEY already creates one

-- SECURITY: Enable RLS and do NOT add public read policies
-- service_role bypasses RLS for ingestion/enrichment jobs
ALTER TABLE scotus_opinions ENABLE ROW LEVEL SECURITY;

-- No policies = no anon/authenticated access (only service_role can read/write)

COMMENT ON TABLE scotus_opinions IS
'Stores full opinion text separately to prevent accidental egress. Job-read-only. RLS enabled, no public policies.';

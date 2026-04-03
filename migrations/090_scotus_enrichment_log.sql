-- Migration 090: Create scotus_enrichment_log for cloud agent observability
-- SCOTUS Claude Agent: Tracks every agent run — what it found, what it enriched, any errors.
-- Created: 2026-04-02
--
-- DEPENDENCY: None (standalone table)

CREATE TABLE IF NOT EXISTS scotus_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    agent_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    prompt_version TEXT NOT NULL,  -- format: 'v1', 'v2', etc. matching prompt-vN.md filename
    cases_found INTEGER NOT NULL DEFAULT 0,
    cases_enriched INTEGER NOT NULL DEFAULT 0,
    cases_failed INTEGER NOT NULL DEFAULT 0,
    cases_skipped INTEGER NOT NULL DEFAULT 0,
    case_details JSONB DEFAULT '[]'::jsonb,
    -- Per-case: [{id, case_name, disposition, confidence, status, error?}]
    errors JSONB DEFAULT '[]'::jsonb,
    run_source TEXT NOT NULL DEFAULT 'cloud-agent',
    -- 'cloud-agent' | 'manual' | 'github-action'
    duration_seconds INTEGER
);

-- Index for monitoring queries (most recent runs first)
CREATE INDEX IF NOT EXISTS idx_scotus_enrichment_log_ran_at
    ON scotus_enrichment_log (ran_at DESC);

-- No RLS — internal observability table, only accessed via service_role.
-- Enabling RLS without policies would make the table inaccessible.

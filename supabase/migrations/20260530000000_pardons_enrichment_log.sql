-- Migration 094: Create pardons_enrichment_log for cloud agent observability
-- Pardons Claude Agent (ADO-518): Tracks every agent run — what it found, what it enriched, any errors.
-- Created: 2026-05-30
--
-- DEPENDENCY: None (standalone table — no FK to pardons, mirrors SCOTUS 090 pattern)

CREATE TABLE IF NOT EXISTS pardons_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    agent_model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    prompt_version TEXT NOT NULL,
    pardons_found INTEGER NOT NULL DEFAULT 0,
    pardons_enriched INTEGER NOT NULL DEFAULT 0,
    pardons_failed INTEGER NOT NULL DEFAULT 0,
    pardons_skipped INTEGER NOT NULL DEFAULT 0,
    pardon_details JSONB DEFAULT '[]'::jsonb,
    -- Per-pardon: [{id, recipient_name, corruption_level, status, error?}]
    errors JSONB DEFAULT '[]'::jsonb,
    run_source TEXT NOT NULL DEFAULT 'cloud-agent',
    -- 'cloud-agent' | 'manual'
    duration_seconds INTEGER
);

-- Index for monitoring queries (most recent runs first)
CREATE INDEX IF NOT EXISTS idx_pardons_enrichment_log_ran_at
    ON pardons_enrichment_log (ran_at DESC);

-- Enable RLS — service_role bypasses RLS automatically, so agent writes work.
-- Without RLS, the anon key (public) could read run logs including non-public pardon recipient names.
ALTER TABLE pardons_enrichment_log ENABLE ROW LEVEL SECURITY;

-- Migration: 098_stories_enrichment_log.sql
-- Purpose: Observability table for the Stories Claude Agent (mirrors 091_executive_orders_enrichment_log.sql)
-- Tracks every enrichment attempt: prompt version, status, timing.
--
-- DEPENDENCY: stories table must exist (stories.id is BIGSERIAL / bigint on both TEST and PROD —
-- unlike executive_orders, there is no PROD/TEST id-type drift here).
--
-- story_id is NULLABLE, unlike EO's equivalent table (executive_orders_enrichment_log.eo_id is NOT NULL).
-- EO/SCOTUS leave zero log rows on a healthy 0-found run, which is fine at their once-daily cadence.
-- Stories runs every 2 hours; several consecutive healthy 0-candidate cycles are plausible (overnight
-- lulls), and with a per-story-only log, that would look identical to the agent not running at all —
-- a monitoring false-alert (Codex review round 3, 2026-06-30). NULL story_id = a run-level heartbeat
-- row written when Step 2 finds 0 candidates, so "last completed row" stays a reliable run-health signal
-- regardless of candidate volume.

CREATE TABLE IF NOT EXISTS stories_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,  -- NULL = run-level heartbeat, no candidates found
    prompt_version TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    duration_ms INTEGER,
    needs_manual_review BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most recent enrichment runs first (admin dashboard, monitoring queries)
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_created_at
    ON stories_enrichment_log (created_at DESC);

-- Per-story enrichment history (admin dashboard drill-down)
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_story_id_created_at
    ON stories_enrichment_log (story_id, created_at DESC);

-- Enable RLS — service_role bypasses RLS automatically, so agent writes work.
-- Without RLS, the anon key (public) could read run logs.
ALTER TABLE stories_enrichment_log ENABLE ROW LEVEL SECURITY;

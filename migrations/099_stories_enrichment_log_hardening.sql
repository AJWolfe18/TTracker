-- Migration: 099_stories_enrichment_log_hardening.sql
-- Purpose: Additive hardening for stories_enrichment_log (098), per Codex PR review (2026-07-03, PR #103).
-- All changes are additive/non-breaking — 098 is left unchanged since it's already applied on TEST.

-- duration_ms should never be negative; a bad value would skew monitoring/alerting.
ALTER TABLE stories_enrichment_log
    ADD CONSTRAINT stories_enrichment_log_duration_ms_nonneg
    CHECK (duration_ms IS NULL OR duration_ms >= 0);

-- Guard against duplicate heartbeat rows (story_id IS NULL) for the same run_id —
-- a retried/duplicate heartbeat write would otherwise look like two separate healthy
-- empty runs instead of one, undermining the "last completed row" health signal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_enrichment_log_run_heartbeat_unique
    ON stories_enrichment_log (run_id)
    WHERE story_id IS NULL;

-- Per-run lookups/drill-down (e.g. "show me every row from run X") would otherwise
-- seq-scan; this table grows continuously at a 2-hour cadence.
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_run_id_created_at
    ON stories_enrichment_log (run_id, created_at DESC);

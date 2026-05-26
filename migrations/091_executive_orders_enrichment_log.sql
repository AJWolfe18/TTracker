-- Migration: Create executive_orders_enrichment_log for EO Claude Agent observability
-- EO Claude Agent (ADO-476): Tracks each EO enrichment attempt — prompt version, status, timing.
-- Created: 2026-04-15
--
-- DEPENDENCY: executive_orders table must exist

-- NOTE: executive_orders.id type drift between TEST and PROD:
--   - PROD: VARCHAR(50) (legacy `eo_<timestamp>_<suffix>` IDs from the RSS-v1 fetcher)
--   - TEST: INTEGER
-- This file declares `eo_id VARCHAR(50)` so PROD applies cleanly. On TEST the FK was
-- created with INTEGER before this file was patched; that state is fine because
-- `CREATE TABLE IF NOT EXISTS` no-ops on existing table. The edge-function code now
-- treats IDs as opaque strings and works against either column type.
--
-- CLEAN-SLATE REBUILD CAVEAT: running this migration on a fresh TEST DB (where
-- executive_orders.id is still INTEGER) will FAIL the FK constraint here. The fix is
-- to first align executive_orders.id to VARCHAR(50) on TEST OR seed TEST from a PROD
-- schema dump. Not a concern for routine migration applies on long-running envs.
CREATE TABLE IF NOT EXISTS executive_orders_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    eo_id VARCHAR(50) NOT NULL REFERENCES executive_orders(id) ON DELETE CASCADE,
    prompt_version TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    duration_ms INTEGER,
    needs_manual_review BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most recent enrichment runs first
CREATE INDEX IF NOT EXISTS idx_eo_enrichment_log_created_at
    ON executive_orders_enrichment_log (created_at DESC);

-- Per-EO enrichment history (admin dashboard drill-down)
CREATE INDEX IF NOT EXISTS idx_eo_enrichment_log_eo_id_created_at
    ON executive_orders_enrichment_log (eo_id, created_at DESC);

-- Enable RLS — service_role bypasses RLS automatically, so agent writes work.
-- Without RLS, the anon key (public) could read run logs including non-public EO metadata.
ALTER TABLE executive_orders_enrichment_log ENABLE ROW LEVEL SECURITY;

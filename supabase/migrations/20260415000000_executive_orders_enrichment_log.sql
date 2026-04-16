-- Migration: Create executive_orders_enrichment_log for EO Claude Agent observability
-- EO Claude Agent (ADO-476): Tracks each EO enrichment attempt — prompt version, status, timing.
-- Created: 2026-04-15
--
-- DEPENDENCY: executive_orders table must exist

CREATE TABLE IF NOT EXISTS executive_orders_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    eo_id INTEGER NOT NULL REFERENCES executive_orders(id) ON DELETE CASCADE,
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

-- No RLS — internal observability table, only accessed via service_role.
-- Enabling RLS without policies would make the table inaccessible.

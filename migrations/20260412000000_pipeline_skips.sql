-- Migration: pipeline_skips table for silent-skip observability
-- ADO-466: Silent Skip Visibility
--
-- Centralized log of work skipped by any pipeline (budget caps, freshness
-- filters, parse errors, missing entities, etc). Every call site that skips
-- work via continue/return-early MUST write a row here before skipping.
-- Backs the admin dashboard skip-visibility card.
--
-- Canonical pipeline + reason values: scripts/lib/skip-reasons.js
-- Retention: 30 days. Daily cleanup cron TBD (next task in ADO-466).

CREATE TABLE IF NOT EXISTS pipeline_skips (
  id          BIGSERIAL PRIMARY KEY,
  pipeline    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_skips_created_at
  ON pipeline_skips (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_skips_pipeline_reason
  ON pipeline_skips (pipeline, reason, created_at DESC);

COMMENT ON TABLE pipeline_skips IS
  'Centralized observability log for work skipped across pipelines. See scripts/lib/skip-reasons.js for canonical values. 30-day retention (cron TBD).';
COMMENT ON COLUMN pipeline_skips.pipeline IS
  'Pipeline that skipped the work. Free-form TEXT; use constants from scripts/lib/skip-reasons.js.';
COMMENT ON COLUMN pipeline_skips.reason IS
  'Why the work was skipped. Free-form TEXT; use constants from scripts/lib/skip-reasons.js.';
COMMENT ON COLUMN pipeline_skips.entity_type IS
  'Type of the skipped entity: article, story, feed_item, scotus_case, etc.';
COMMENT ON COLUMN pipeline_skips.entity_id IS
  'Polymorphic identifier of the skipped entity (TEXT to support any pk type).';
COMMENT ON COLUMN pipeline_skips.metadata IS
  'Optional JSONB context: url, error message, counts, etc.';

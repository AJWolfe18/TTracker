-- Migration: 081_admin_content_history.sql
-- Purpose: Create admin schema and content_history table for undo support
-- ADO: Feature 328, Story 337

-- Create admin schema for admin-only tables
CREATE SCHEMA IF NOT EXISTS admin;

-- Content history table for tracking all field changes (enables undo)
CREATE TABLE IF NOT EXISTS admin.content_history (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,        -- 'story', 'article', 'pardon', 'eo', 'feed', 'scotus'
  entity_id TEXT NOT NULL,          -- ID as text (handles bigint and uuid)
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT,                  -- GitHub username or 'system'
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  change_source TEXT DEFAULT 'admin' -- 'admin', 'pipeline', 'api', 'undo'
);

-- Index for quick lookups of entity history (most recent first)
CREATE INDEX IF NOT EXISTS idx_content_history_entity
ON admin.content_history(entity_type, entity_id, changed_at DESC);

-- Index for cleanup job (90-day retention)
CREATE INDEX IF NOT EXISTS idx_content_history_changed_at
ON admin.content_history(changed_at DESC);

-- Enable RLS - only service_role can access
ALTER TABLE admin.content_history ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists (for idempotency)
DROP POLICY IF EXISTS "Service role only" ON admin.content_history;

-- Only service_role can access content history
CREATE POLICY "Service role only" ON admin.content_history
  FOR ALL USING (auth.role() = 'service_role');

-- Grant access to service_role
GRANT ALL ON admin.content_history TO service_role;
GRANT USAGE ON SCHEMA admin TO service_role;
GRANT USAGE, SELECT ON SEQUENCE admin.content_history_id_seq TO service_role;

COMMENT ON TABLE admin.content_history IS 'Tracks all field-level changes for undo support. Retained for 90 days.';
COMMENT ON COLUMN admin.content_history.entity_type IS 'Type of entity: story, article, pardon, eo, feed, scotus';
COMMENT ON COLUMN admin.content_history.entity_id IS 'ID of the entity (as text to handle various ID types)';
COMMENT ON COLUMN admin.content_history.change_source IS 'Source of change: admin, pipeline, api, undo';

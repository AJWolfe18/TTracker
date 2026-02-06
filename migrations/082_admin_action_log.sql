-- Migration: 082_admin_action_log.sql
-- Purpose: Create action_log table for admin audit trail
-- ADO: Feature 328, Story 337

-- Action audit log - tracks all admin actions
CREATE TABLE IF NOT EXISTS admin.action_log (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID,                  -- Group related actions (optional)
  user_id TEXT NOT NULL,            -- GitHub username
  action TEXT NOT NULL,             -- 'create', 'update', 'delete', 're-enrich', 'bulk_update', 'undo'
  entity_type TEXT NOT NULL,        -- 'story', 'article', 'pardon', 'eo', 'feed', 'scotus'
  entity_id TEXT,                   -- Single entity
  entity_ids TEXT[],                -- For bulk operations
  details JSONB,                    -- Action-specific metadata
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user activity lookup
CREATE INDEX IF NOT EXISTS idx_action_log_user
ON admin.action_log(user_id, created_at DESC);

-- Index for entity-specific activity
CREATE INDEX IF NOT EXISTS idx_action_log_entity
ON admin.action_log(entity_type, entity_id);

-- Index for recent activity (cleanup job)
CREATE INDEX IF NOT EXISTS idx_action_log_created
ON admin.action_log(created_at DESC);

-- Enable RLS - only service_role can access
ALTER TABLE admin.action_log ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists (for idempotency)
DROP POLICY IF EXISTS "Service role only" ON admin.action_log;

-- Only service_role can access action log
CREATE POLICY "Service role only" ON admin.action_log
  FOR ALL USING (auth.role() = 'service_role');

-- Grant access to service_role
GRANT ALL ON admin.action_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE admin.action_log_id_seq TO service_role;

COMMENT ON TABLE admin.action_log IS 'Audit log of all admin actions. Retained for 90 days.';
COMMENT ON COLUMN admin.action_log.action IS 'Type of action: create, update, delete, re-enrich, bulk_update, undo';
COMMENT ON COLUMN admin.action_log.details IS 'Action-specific metadata (e.g., estimated_cost for re-enrich)';

-- Migration 026: Story Split Audit Trail (TTRC-231)
-- Tracks story split operations for quality monitoring

-- ============================================================================
-- PART 1: Audit Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS story_split_actions (
  id BIGSERIAL PRIMARY KEY,
  original_story_id BIGINT,
  coherence_score NUMERIC(5,3),
  articles_count INT DEFAULT 0,
  new_stories_created INT DEFAULT 0,
  new_story_ids BIGINT[],
  split_at TIMESTAMPTZ DEFAULT NOW(),
  performed_by TEXT DEFAULT 'system',
  reason TEXT,
  CONSTRAINT fk_original_story FOREIGN KEY (original_story_id) REFERENCES stories(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE story_split_actions IS 'TTRC-231: Audit trail for story split operations';
COMMENT ON COLUMN story_split_actions.original_story_id IS 'Story that was split (marked as archived)';
COMMENT ON COLUMN story_split_actions.coherence_score IS 'Internal coherence score that triggered split (0.0-1.0)';
COMMENT ON COLUMN story_split_actions.articles_count IS 'Number of articles re-clustered from original story';
COMMENT ON COLUMN story_split_actions.new_stories_created IS 'Number of new stories created from split';
COMMENT ON COLUMN story_split_actions.new_story_ids IS 'Array of story IDs created from split';
COMMENT ON COLUMN story_split_actions.performed_by IS 'system or user account ID if manual';
COMMENT ON COLUMN story_split_actions.reason IS 'Human-readable reason for split';

-- ============================================================================
-- PART 2: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_story_split_actions_original ON story_split_actions(original_story_id);
CREATE INDEX IF NOT EXISTS idx_story_split_actions_split_at ON story_split_actions(split_at DESC);

-- ============================================================================
-- PART 3: Grants
-- ============================================================================

GRANT SELECT, INSERT ON story_split_actions TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE story_split_actions_id_seq TO service_role, authenticated;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- This migration is safe to run multiple times (idempotent)
-- Creates audit trail for story split operations
-- Tracks splits for rollback and historical analysis

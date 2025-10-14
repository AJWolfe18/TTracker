-- Migration 025: Story Merge Audit Trail (TTRC-231)
-- Tracks story merge operations for quality monitoring

-- ============================================================================
-- PART 1: Audit Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS story_merge_actions (
  id BIGSERIAL PRIMARY KEY,
  source_story_id BIGINT,
  target_story_id BIGINT,
  coherence_score NUMERIC(5,3),
  shared_entities TEXT[],
  articles_moved INT DEFAULT 0,
  merged_at TIMESTAMPTZ DEFAULT NOW(),
  performed_by TEXT DEFAULT 'system',
  reason TEXT,
  CONSTRAINT fk_source_story FOREIGN KEY (source_story_id) REFERENCES stories(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT fk_target_story FOREIGN KEY (target_story_id) REFERENCES stories(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE story_merge_actions IS 'TTRC-231: Audit trail for story merge operations';
COMMENT ON COLUMN story_merge_actions.source_story_id IS 'Story that was merged into target (marked as merged_into)';
COMMENT ON COLUMN story_merge_actions.target_story_id IS 'Story that received articles from source';
COMMENT ON COLUMN story_merge_actions.coherence_score IS 'Centroid similarity score that triggered merge (0.0-1.0)';
COMMENT ON COLUMN story_merge_actions.shared_entities IS 'Entity IDs shared between stories';
COMMENT ON COLUMN story_merge_actions.articles_moved IS 'Number of articles moved from source to target';
COMMENT ON COLUMN story_merge_actions.performed_by IS 'system or user account ID if manual';
COMMENT ON COLUMN story_merge_actions.reason IS 'Human-readable reason for merge';

-- ============================================================================
-- PART 2: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_story_merge_actions_source ON story_merge_actions(source_story_id);
CREATE INDEX IF NOT EXISTS idx_story_merge_actions_target ON story_merge_actions(target_story_id);
CREATE INDEX IF NOT EXISTS idx_story_merge_actions_merged_at ON story_merge_actions(merged_at DESC);

-- ============================================================================
-- PART 3: Add 'merged_into' Status to Stories
-- ============================================================================

-- Check if enum value already exists before adding
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'merged_into'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'story_status')
  ) THEN
    ALTER TYPE story_status ADD VALUE IF NOT EXISTS 'merged_into';
  END IF;
END$$;

COMMENT ON TYPE story_status IS 'Story status: active, closed, archived, merged_into';

-- ============================================================================
-- PART 4: Add merged_into_story_id Column
-- ============================================================================

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS merged_into_story_id BIGINT,
  ADD CONSTRAINT fk_merged_into_story
    FOREIGN KEY (merged_into_story_id)
    REFERENCES stories(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_stories_merged_into ON stories(merged_into_story_id)
  WHERE merged_into_story_id IS NOT NULL;

COMMENT ON COLUMN stories.merged_into_story_id IS 'TTRC-231: Points to target story if this story was merged';

-- ============================================================================
-- PART 5: Grants
-- ============================================================================

GRANT SELECT, INSERT ON story_merge_actions TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE story_merge_actions_id_seq TO service_role, authenticated;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- This migration is safe to run multiple times (idempotent)
-- Creates audit trail for story merge operations
-- Adds merged_into status and merged_into_story_id column for tracking

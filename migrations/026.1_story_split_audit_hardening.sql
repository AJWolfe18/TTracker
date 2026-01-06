-- Migration 026.1: Story Split Audit Hardening (TTRC-231)
-- Adds data integrity constraints and performance indexes

-- ============================================================================
-- PART 1: Data Integrity Constraints
-- ============================================================================

-- 1. NOT NULL constraints (these fields should always have values)
ALTER TABLE story_split_actions
  ALTER COLUMN split_at SET NOT NULL,
  ALTER COLUMN performed_by SET NOT NULL,
  ALTER COLUMN articles_count SET NOT NULL,
  ALTER COLUMN new_stories_created SET NOT NULL;

-- 2. Set default for new_story_ids (empty array if no stories created)
ALTER TABLE story_split_actions
  ALTER COLUMN new_story_ids SET DEFAULT ARRAY[]::bigint[];

-- 3. Bounds checks (prevent invalid data)
ALTER TABLE story_split_actions
  ADD CONSTRAINT chk_coherence_0_1
    CHECK (coherence_score IS NULL OR (coherence_score >= 0.0 AND coherence_score <= 1.0)),
  ADD CONSTRAINT chk_counts_nonneg
    CHECK (articles_count >= 0 AND new_stories_created >= 0);

COMMENT ON CONSTRAINT chk_coherence_0_1 ON story_split_actions IS 'Coherence score must be between 0.0 and 1.0 (cosine similarity range)';
COMMENT ON CONSTRAINT chk_counts_nonneg ON story_split_actions IS 'Article and story counts cannot be negative';

-- ============================================================================
-- PART 2: Performance Indexes
-- ============================================================================

-- GIN index for "which splits created story X?" queries
CREATE INDEX IF NOT EXISTS idx_story_split_actions_new_ids_gin
  ON story_split_actions USING gin (new_story_ids);

COMMENT ON INDEX idx_story_split_actions_new_ids_gin IS 'Enables fast lookups of splits that created specific stories (overlap queries)';

-- ============================================================================
-- PART 3: Prevent Accidental Modifications (Optional)
-- ============================================================================

-- Enable RLS (but keep it simple - just prevent UPDATE/DELETE via grants)
-- No need for complex policies; service_role INSERT-only is sufficient
ALTER TABLE story_split_actions ENABLE ROW LEVEL SECURITY;

-- Allow all reads (audit table should be transparent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'story_split_actions'
      AND policyname = 'p_select_all'
  ) THEN
    CREATE POLICY p_select_all ON story_split_actions
      FOR SELECT USING (true);
  END IF;
END$$;

-- Allow inserts for service_role only (app layer controls writes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'story_split_actions'
      AND policyname = 'p_insert_service_role'
  ) THEN
    CREATE POLICY p_insert_service_role ON story_split_actions
      FOR INSERT TO service_role
      WITH CHECK (true);
  END IF;
END$$;

-- No UPDATE/DELETE policies = operations denied by default

COMMENT ON TABLE story_split_actions IS 'TTRC-231: Append-only audit trail for story split operations. Use RLS to prevent modifications.';

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Changes applied:
-- ✅ NOT NULL constraints on required fields
-- ✅ Bounds checks for coherence (0-1) and counts (non-negative)
-- ✅ GIN index for story overlap queries
-- ✅ RLS enabled to prevent UPDATE/DELETE
-- ✅ Default empty array for new_story_ids

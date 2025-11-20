-- Migration 027: Add 'merged_into' to stories status CHECK constraint
-- Required for TTRC-231 periodic merge functionality

-- Drop existing constraint (if exists)
ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_status_check;

-- Re-create constraint with 'merged_into' value
ALTER TABLE stories
  ADD CONSTRAINT stories_status_check
    CHECK (status IN ('active', 'closed', 'archived', 'merged_into'));

COMMENT ON CONSTRAINT stories_status_check ON stories IS
  'Valid status values: active, closed, archived, merged_into';

-- Verify constraint was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_status_check'
      AND conrelid = 'stories'::regclass
  ) THEN
    RAISE EXCEPTION 'Failed to create stories_status_check constraint';
  END IF;
END $$;

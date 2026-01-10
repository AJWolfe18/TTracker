-- Migration 055: Phase 4 Final Cleanup (TTRC-376)
-- Purpose: Drop redundant index + remove dormant merge/split feature
-- Evidence: idx_stories_status covered by ix_stories_status_first_seen
--           Merge/split dormant since Oct 2025, tables empty (verified)
-- PREREQUISITE: Run preflight queries first! merged_into_rows must be 0

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';  -- Safe margin for large stories table

-- ============================================================================
-- 1. Drop redundant idx_stories_status
-- Covered by: ix_stories_status_first_seen (status, first_seen_at DESC)
-- ============================================================================
DROP INDEX IF EXISTS public.idx_stories_status;

-- ============================================================================
-- 2. Drop merge/split audit tables (dormant feature)
-- Last used: Oct 2025, verified empty (0 rows each)
-- NOTE: No CASCADE - dependencies verified in preflight
-- ============================================================================
DROP TABLE IF EXISTS public.story_merge_actions;
DROP TABLE IF EXISTS public.story_split_actions;

-- ============================================================================
-- 3. Drop merged_into_story_id column from stories
-- Verified: 0 non-null values
-- ============================================================================
ALTER TABLE public.stories DROP COLUMN IF EXISTS merged_into_story_id;

-- ============================================================================
-- 4. Remove 'merged_into' from status CHECK constraint
-- Using NOT VALID + VALIDATE pattern to minimize lock time
-- Verified: 0 rows with status='merged_into'
-- ============================================================================
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_status_check;

ALTER TABLE public.stories
  ADD CONSTRAINT stories_status_check
  CHECK (status IN ('active', 'closed', 'archived')) NOT VALID;

ALTER TABLE public.stories
  VALIDATE CONSTRAINT stories_status_check;

COMMIT;

-- ============================================================================
-- ROLLBACK SECTION (if needed)
-- ============================================================================
/*
-- Recreate index
CREATE INDEX idx_stories_status ON public.stories USING btree (status);

-- Recreate merged_into_story_id column
ALTER TABLE public.stories ADD COLUMN merged_into_story_id BIGINT REFERENCES public.stories(id);

-- Recreate CHECK constraint with merged_into
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_status_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_status_check
  CHECK (status IN ('active', 'closed', 'archived', 'merged_into'));

-- Recreate story_merge_actions table
CREATE TABLE public.story_merge_actions (
  id BIGSERIAL PRIMARY KEY,
  source_story_id BIGINT NOT NULL REFERENCES public.stories(id),
  target_story_id BIGINT NOT NULL REFERENCES public.stories(id),
  merged_at TIMESTAMPTZ DEFAULT NOW(),
  merged_by TEXT,
  reason TEXT
);

-- Recreate story_split_actions table
CREATE TABLE public.story_split_actions (
  id BIGSERIAL PRIMARY KEY,
  original_story_id BIGINT NOT NULL REFERENCES public.stories(id),
  new_story_ids BIGINT[] NOT NULL,
  split_at TIMESTAMPTZ DEFAULT NOW(),
  split_by TEXT,
  reason TEXT
);
*/

-- Migration: 080_story_review_flags.sql
-- Purpose: Add review flags to stories table for admin dashboard "Needs Attention" panel
-- ADO: Feature 327, Story 333

-- Add review columns to stories table
ALTER TABLE stories ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Index for quick lookups of stories needing review
CREATE INDEX IF NOT EXISTS idx_stories_needs_review
ON stories(needs_review)
WHERE needs_review = TRUE;

-- Auto-flag trigger function for stories needing review
CREATE OR REPLACE FUNCTION flag_story_for_review()
RETURNS TRIGGER AS $$
DECLARE
  reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Flag if summary too short (less than 50 chars)
  IF NEW.summary_neutral IS NOT NULL AND LENGTH(NEW.summary_neutral) < 50 THEN
    reasons := array_append(reasons, 'Summary too short');
  END IF;

  -- Flag if low confidence (below 50%)
  IF NEW.confidence_score IS NOT NULL AND NEW.confidence_score < 0.5 THEN
    reasons := array_append(reasons, 'Low confidence score');
  END IF;

  -- Flag if enrichment failed
  IF NEW.enrichment_failure_count IS NOT NULL AND NEW.enrichment_failure_count > 0 THEN
    reasons := array_append(reasons, 'Enrichment failed');
  END IF;

  -- Set needs_review and concatenate reasons
  IF array_length(reasons, 1) > 0 THEN
    NEW.needs_review := TRUE;
    NEW.review_reason := array_to_string(reasons, '; ');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first if exists to allow re-running)
DROP TRIGGER IF EXISTS story_review_flag_trigger ON stories;

CREATE TRIGGER story_review_flag_trigger
  BEFORE INSERT OR UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION flag_story_for_review();

-- Backfill existing stories that need review
-- Uses concat_ws to combine multiple reasons (matching trigger behavior)
UPDATE stories
SET
  needs_review = TRUE,
  review_reason = concat_ws('; ',
    CASE WHEN summary_neutral IS NOT NULL AND LENGTH(summary_neutral) < 50
         THEN 'Summary too short' END,
    CASE WHEN confidence_score IS NOT NULL AND confidence_score < 0.5
         THEN 'Low confidence score' END,
    CASE WHEN enrichment_failure_count IS NOT NULL AND enrichment_failure_count > 0
         THEN 'Enrichment failed' END
  )
WHERE
  (summary_neutral IS NOT NULL AND LENGTH(summary_neutral) < 50)
  OR (confidence_score IS NOT NULL AND confidence_score < 0.5)
  OR (enrichment_failure_count IS NOT NULL AND enrichment_failure_count > 0);

COMMENT ON COLUMN stories.needs_review IS 'Flag for admin review queue - set automatically by trigger or manually';
COMMENT ON COLUMN stories.review_reason IS 'Reason(s) why story needs review - auto-generated or manual';
COMMENT ON COLUMN stories.reviewed_at IS 'When the story was reviewed/approved';
COMMENT ON COLUMN stories.reviewed_by IS 'GitHub username of reviewer';

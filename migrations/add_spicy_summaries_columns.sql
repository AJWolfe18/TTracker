-- Spicy Summaries Database Migration
-- Run this in Supabase SQL Editor
-- Date: August 24, 2025
-- Purpose: Add columns for spicy summaries feature

-- Add new columns to political_entries table
ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS editorial_summary TEXT,
ADD COLUMN IF NOT EXISTS spicy_summary TEXT,
ADD COLUMN IF NOT EXISTS shareable_hook VARCHAR(280),
ADD COLUMN IF NOT EXISTS severity_label_inapp VARCHAR(50),
ADD COLUMN IF NOT EXISTS severity_label_share VARCHAR(50);

-- Add comment to explain the columns
COMMENT ON COLUMN political_entries.editorial_summary IS 'Original neutral summary for control group';
COMMENT ON COLUMN political_entries.spicy_summary IS 'Angry, truthful summary that validates user frustration';
COMMENT ON COLUMN political_entries.shareable_hook IS 'One-liner designed for social media sharing';
COMMENT ON COLUMN political_entries.severity_label_inapp IS 'Raw severity label for app users (e.g., Fucking Treason)';
COMMENT ON COLUMN political_entries.severity_label_share IS 'Clean severity label for social sharing';

-- Verify columns were added
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'political_entries' 
AND column_name IN ('editorial_summary', 'spicy_summary', 'shareable_hook', 'severity_label_inapp', 'severity_label_share');

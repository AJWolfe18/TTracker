-- Fix Test Database Schema
-- Add missing columns that exist in production but not in test

-- Add added_at column to political_entries if it doesn't exist
ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add added_at column to executive_orders if it doesn't exist
ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update any existing records to have added_at = created_at if created_at exists
UPDATE political_entries 
SET added_at = created_at 
WHERE added_at IS NULL AND created_at IS NOT NULL;

UPDATE executive_orders
SET added_at = created_at
WHERE added_at IS NULL AND created_at IS NOT NULL;

-- Verify the columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'political_entries' 
ORDER BY ordinal_position;
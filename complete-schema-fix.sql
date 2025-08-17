-- Complete Schema Fix for Test Database
-- Add ALL missing columns that exist in production but not in test

-- Add missing columns to political_entries
ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS verified_by TEXT;

ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS tags TEXT[];

ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS impact_score INTEGER;

-- Add missing columns to executive_orders
ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS agencies_affected TEXT[];

ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS implementation_date DATE;

ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS status TEXT;

-- Check what columns exist in political_entries
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'political_entries' 
ORDER BY ordinal_position;

-- Check what columns exist in executive_orders
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'executive_orders' 
ORDER BY ordinal_position;
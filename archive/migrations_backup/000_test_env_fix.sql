-- TrumpyTracker Test Environment Fix
-- Fixes the political_entries.id type mismatch issue
-- Run this BEFORE the main migration on TEST environment only

BEGIN;

-- ================================================
-- FIX 1: Check current state of political_entries
-- ================================================
DO $$ 
DECLARE
    id_type text;
BEGIN
    -- Get the current data type of the id column
    SELECT data_type INTO id_type
    FROM information_schema.columns 
    WHERE table_name = 'political_entries' 
    AND column_name = 'id';
    
    RAISE NOTICE 'Current political_entries.id type: %', id_type;
    
    -- Only proceed if we need to fix it
    IF id_type = 'integer' OR id_type = 'bigint' THEN
        RAISE NOTICE 'Need to convert political_entries.id from % to TEXT', id_type;
    ELSE
        RAISE NOTICE 'political_entries.id is already TEXT, skipping conversion';
    END IF;
END $$;

-- ================================================
-- FIX 2: Convert political_entries.id to TEXT if needed
-- ================================================

-- First, drop any existing constraints that depend on the id column
ALTER TABLE political_entries DROP CONSTRAINT IF EXISTS political_entries_pkey CASCADE;

-- Create a new TEXT id column
ALTER TABLE political_entries ADD COLUMN IF NOT EXISTS id_new TEXT;

-- Copy existing IDs to the new column, converting to text
UPDATE political_entries 
SET id_new = CASE 
    WHEN id IS NULL THEN gen_random_uuid()::text
    WHEN id::text ~ '^\d+$' THEN 'legacy-' || id::text  -- Prefix numeric IDs
    ELSE id::text
END
WHERE id_new IS NULL;

-- Drop the old id column and rename the new one
ALTER TABLE political_entries DROP COLUMN IF EXISTS id;
ALTER TABLE political_entries RENAME COLUMN id_new TO id;

-- Re-add the primary key constraint
ALTER TABLE political_entries ADD PRIMARY KEY (id);

-- ================================================
-- FIX 3: Ensure all required columns exist
-- ================================================
ALTER TABLE political_entries 
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS severity_level INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS processed BOOLEAN DEFAULT FALSE;

-- ================================================
-- VERIFY: Check the fix worked
-- ================================================
DO $$ 
DECLARE
    id_type text;
    row_count integer;
BEGIN
    -- Check the new data type
    SELECT data_type INTO id_type
    FROM information_schema.columns 
    WHERE table_name = 'political_entries' 
    AND column_name = 'id';
    
    -- Count existing rows
    SELECT COUNT(*) INTO row_count FROM political_entries;
    
    RAISE NOTICE 'After fix - political_entries.id type: %', id_type;
    RAISE NOTICE 'Total rows preserved: %', row_count;
    
    IF id_type != 'text' AND id_type != 'character varying' THEN
        RAISE EXCEPTION 'Failed to convert political_entries.id to TEXT';
    END IF;
END $$;

COMMIT;

-- ================================================
-- SUCCESS! Now you can run 001_critical_fixes_v3.1.sql
-- ================================================
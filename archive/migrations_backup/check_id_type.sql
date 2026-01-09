-- Check and Fix political_entries.id Type Issue

-- First, let's see what we're dealing with
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'political_entries' 
AND column_name = 'id';

-- Check if there are any dependent views
SELECT 
    viewname,
    definition 
FROM pg_views 
WHERE definition LIKE '%political_entries%';

-- Count existing data
SELECT COUNT(*) as row_count FROM political_entries;

-- Show a sample of existing IDs
SELECT id, title FROM political_entries LIMIT 5;
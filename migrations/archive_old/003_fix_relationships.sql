-- Fix foreign key relationships for Edge Functions
-- Run this in Supabase SQL Editor on TEST environment

-- First, check if the foreign keys exist
DO $$
BEGIN
  -- Add foreign key from article_story to articles if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'article_story_article_id_fkey'
  ) THEN
    ALTER TABLE article_story
    ADD CONSTRAINT article_story_article_id_fkey
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;
  END IF;

  -- Add foreign key from article_story to stories if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'article_story_story_id_fkey'
  ) THEN
    ALTER TABLE article_story
    ADD CONSTRAINT article_story_story_id_fkey
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Grant necessary permissions for the Edge Functions to work
GRANT SELECT ON articles TO anon, authenticated;
GRANT SELECT ON stories TO anon, authenticated;
GRANT SELECT ON article_story TO anon, authenticated;
GRANT SELECT ON feed_registry TO anon, authenticated;
GRANT SELECT ON job_queue TO anon, authenticated;

-- For admin operations
GRANT INSERT, UPDATE ON articles TO authenticated;
GRANT INSERT, UPDATE ON stories TO authenticated;
GRANT INSERT, UPDATE ON article_story TO authenticated;

-- Enable RLS but create policies that allow access
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_story ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for reading (anyone can read)
CREATE POLICY "Allow public read access" ON articles
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON stories
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON article_story
  FOR SELECT USING (true);

-- Create policies for writing (only authenticated users)
CREATE POLICY "Allow authenticated insert" ON articles
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update" ON articles
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Verify the relationships exist
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('article_story', 'articles', 'stories');

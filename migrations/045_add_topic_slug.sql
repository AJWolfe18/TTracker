-- TTRC-306: Add topic_slug for improved clustering recall
-- Topic slugs identify specific news events (e.g., HEGSETH-CONFIRMATION-HEARING)
-- rather than just semantic similarity

-- Add topic_slug to articles (individual article's extracted slug)
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS topic_slug VARCHAR(100);

-- Add topic_slugs array to stories (aggregated from all articles)
-- NOT NULL + explicit cast ensures consistent behavior in code
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS topic_slugs TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Create GIN index for fast slug-based candidate generation
-- This enables: WHERE topic_slugs @> ARRAY['HEGSETH-CONFIRMATION']
CREATE INDEX IF NOT EXISTS idx_stories_topic_slugs_gin
ON stories USING GIN (topic_slugs);

-- Create index on articles.topic_slug for filtering
-- Partial index only on non-null slugs for efficiency
CREATE INDEX IF NOT EXISTS idx_articles_topic_slug
ON articles (topic_slug)
WHERE topic_slug IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN articles.topic_slug IS 'AI-extracted canonical topic slug (e.g., HEGSETH-CONFIRMATION). Used for clustering improvement.';
COMMENT ON COLUMN stories.topic_slugs IS 'Aggregated topic slugs from all articles in this story. Used for candidate generation.';

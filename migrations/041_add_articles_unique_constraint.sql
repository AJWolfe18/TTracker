-- Migration 041: Add unique constraint on articles (url_hash, published_date)
-- Fixes TTRC-296: QA tests fail - missing unique constraint
--
-- The tests use `ON CONFLICT (url_hash, published_date)` but the constraint
-- was never applied to the TEST database.

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_articles_urlhash_day'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT uq_articles_urlhash_day
      UNIQUE (url_hash, published_date);
    RAISE NOTICE 'Added uq_articles_urlhash_day constraint';
  ELSE
    RAISE NOTICE 'Constraint uq_articles_urlhash_day already exists';
  END IF;
END $$;

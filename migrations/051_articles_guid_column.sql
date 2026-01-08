-- migrations/051_articles_guid_column.sql
-- TTRC-362: Add guid column for TEST/PROD schema parity
-- Apply to PROD manually via Supabase SQL Editor

-- Add guid column (optional; may also exist in metadata JSONB)
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS guid TEXT;

-- Partial index keeps it smaller (only indexes non-null values)
CREATE INDEX IF NOT EXISTS idx_articles_guid
  ON public.articles (guid)
  WHERE guid IS NOT NULL;

COMMENT ON COLUMN public.articles.guid
  IS 'RSS item GUID for deduplication (optional; may also be in metadata JSONB)';

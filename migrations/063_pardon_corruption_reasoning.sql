-- ============================================================
-- Migration 058: Add corruption_reasoning column to pardons
-- ADO-253: Store Perplexity's reasoning for corruption level
-- ============================================================
--
-- This column captures "why did we rate this a 4?" for the spicy meter.
-- Nullable because:
-- - Older rows won't have it
-- - "no_connection" cases may have thin reasoning
-- - We don't want publish blocked by missing explanation
--
-- Prerequisites: Migration 057_pardon_research_tables.sql applied
-- ============================================================

-- Note: Using fully qualified names (public.pardons) so no search_path needed

-- Add column with type assertion to catch schema drift
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pardons'
      AND column_name = 'corruption_reasoning'
  ) THEN
    ALTER TABLE public.pardons ADD COLUMN corruption_reasoning TEXT;
  ELSE
    -- Assert type matches expected (fail loudly on schema drift)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pardons'
        AND column_name = 'corruption_reasoning'
        AND data_type <> 'text'
    ) THEN
      RAISE EXCEPTION 'Column public.pardons.corruption_reasoning exists with wrong type. Expected text.';
    END IF;
  END IF;
END$$;

COMMENT ON COLUMN public.pardons.corruption_reasoning IS 'Perplexity reasoning for corruption_level score (nullable for no_connection cases)';

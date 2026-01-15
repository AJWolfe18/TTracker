-- ============================================================
-- Migration 059: Add pardon_advocates column
-- ADO-246: Research prompt v1.2 - store who advocated for each pardon
-- ============================================================

-- Note: Using fully qualified names (public.pardons) so no search_path needed

-- Add pardon_advocates as TEXT array (multiple advocates common)
-- Step 1: Add column without NOT NULL first (in case column exists as nullable)
ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS pardon_advocates TEXT[] DEFAULT '{}'::TEXT[];

-- Step 2: Backfill any NULLs to empty array
UPDATE public.pardons SET pardon_advocates = '{}'::TEXT[] WHERE pardon_advocates IS NULL;

-- Step 3: Now set NOT NULL constraint (idempotent with DO block)
DO $$
BEGIN
  ALTER TABLE public.pardons ALTER COLUMN pardon_advocates SET NOT NULL;
EXCEPTION
  WHEN others THEN NULL; -- Already NOT NULL
END $$;

COMMENT ON COLUMN public.pardons.pardon_advocates IS 'Array of names/orgs who publicly advocated for this pardon';

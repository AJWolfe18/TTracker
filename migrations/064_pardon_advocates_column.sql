-- ============================================================
-- Migration 059: Add pardon_advocates column
-- ADO-246: Research prompt v1.2 - store who advocated for each pardon
-- ============================================================

-- Note: Using fully qualified names (public.pardons) so no search_path needed

-- Add pardon_advocates as TEXT array (multiple advocates common)
-- Step 1: Add column (IF NOT EXISTS handles idempotency)
ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS pardon_advocates TEXT[];

-- Step 2: Ensure DEFAULT is set (even if column pre-existed without it)
ALTER TABLE public.pardons
  ALTER COLUMN pardon_advocates SET DEFAULT '{}'::TEXT[];

-- Step 3: Backfill any NULLs to empty array
UPDATE public.pardons SET pardon_advocates = '{}'::TEXT[] WHERE pardon_advocates IS NULL;

-- Step 4: Enforce NOT NULL (safe to run repeatedly - idempotent in Postgres)
ALTER TABLE public.pardons ALTER COLUMN pardon_advocates SET NOT NULL;

COMMENT ON COLUMN public.pardons.pardon_advocates IS 'Array of names/orgs who publicly advocated for this pardon';

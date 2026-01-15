-- ============================================================
-- Migration 059: Add pardon_advocates column
-- ADO-246: Research prompt v1.2 - store who advocated for each pardon
-- ============================================================

SET search_path = public;

-- Add pardon_advocates as TEXT array (multiple advocates common)
ALTER TABLE public.pardons
  ADD COLUMN IF NOT EXISTS pardon_advocates TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN public.pardons.pardon_advocates IS 'Array of names/orgs who publicly advocated for this pardon';

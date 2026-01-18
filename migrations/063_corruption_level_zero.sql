-- Migration: 063_corruption_level_zero.sql
-- Date: 2026-01-17
-- Purpose: Update corruption_level CHECK constraint to allow Level 0 (Actual Mercy)
-- ADO: Related to ADO-264

-- Drop existing constraint
ALTER TABLE public.pardons DROP CONSTRAINT IF EXISTS pardons_corruption_level_check;

-- Add new constraint allowing 0-5
ALTER TABLE public.pardons ADD CONSTRAINT pardons_corruption_level_check
  CHECK (corruption_level IS NULL OR corruption_level BETWEEN 0 AND 5);

COMMENT ON COLUMN public.pardons.corruption_level IS 'Corruption level 0-5: 0=Actual Mercy, 1=Ego Discount, 2=PR Stunt, 3=Party Favor, 4=Cronies-in-Chief, 5=Pay 2 Win';

-- migrations/064_add_alarm_level_to_stories.sql
-- ADO-270: Adds numeric 0-5 alarm_level for tone system alignment
-- Idempotent: safe to re-run
--
-- This enables Stories to use the same 0-5 scale as Pardons and SCOTUS
-- while preserving backward compatibility with the legacy text severity enum.

-- 1. Add the column
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS alarm_level SMALLINT;

-- 2. Add constraint (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stories_alarm_level_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_alarm_level_check
      CHECK (alarm_level BETWEEN 0 AND 5);
  END IF;
END $$;

-- 3. Backfill from legacy 4-tier enum where possible
-- Mapping: critical→5, severe→4, moderate→3, minor→2
-- Levels 0-1 (positive outcomes) have no legacy equivalent
UPDATE public.stories
SET alarm_level = CASE severity
  WHEN 'critical'  THEN 5
  WHEN 'severe'    THEN 4
  WHEN 'moderate'  THEN 3
  WHEN 'minor'     THEN 2
  ELSE NULL
END
WHERE alarm_level IS NULL
  AND severity IS NOT NULL;

-- 4. Create index for filtering
CREATE INDEX IF NOT EXISTS stories_alarm_level_idx
  ON public.stories (alarm_level);

-- 5. Add comment for documentation
COMMENT ON COLUMN public.stories.alarm_level IS
  'Numeric severity 0-5 for tone system. 5=constitutional crisis, 0=positive outcome. Maps to tone-system.json labels.';

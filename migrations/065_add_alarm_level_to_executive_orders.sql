-- migrations/065_add_alarm_level_to_executive_orders.sql
-- ADO-271: Adds numeric 0-5 alarm_level for tone system alignment
-- Idempotent: safe to re-run
--
-- This enables EOs to use the same 0-5 scale as Pardons, Stories, and SCOTUS
-- while preserving backward compatibility with the legacy text severity_rating field.

-- 1. Add the column
ALTER TABLE public.executive_orders
  ADD COLUMN IF NOT EXISTS alarm_level SMALLINT;

-- 2. Add constraint (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'executive_orders_alarm_level_check'
  ) THEN
    ALTER TABLE public.executive_orders
      ADD CONSTRAINT executive_orders_alarm_level_check
      CHECK (alarm_level BETWEEN 0 AND 5);
  END IF;
END $$;

-- 3. Backfill from legacy severity_rating where possible
-- Mapping: critical→5, high→4, medium→3, low→2
-- Levels 0-1 (positive outcomes) have no legacy equivalent
UPDATE public.executive_orders
SET alarm_level = CASE severity_rating
  WHEN 'critical' THEN 5
  WHEN 'high'     THEN 4
  WHEN 'medium'   THEN 3
  WHEN 'low'      THEN 2
  ELSE NULL
END
WHERE alarm_level IS NULL
  AND severity_rating IS NOT NULL;

-- 4. Create index for filtering
CREATE INDEX IF NOT EXISTS executive_orders_alarm_level_idx
  ON public.executive_orders (alarm_level);

-- 5. Add comment for documentation
COMMENT ON COLUMN public.executive_orders.alarm_level IS
  'Numeric severity 0-5 for tone system. 5=authoritarian power grab, 0=actually helpful. Maps to tone-system.json labels.';

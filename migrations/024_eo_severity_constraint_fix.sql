-- Migration 024: Fix Executive Orders Severity Constraint
-- Purpose: Update severity CHECK constraint to use new enum values
-- Blocker Fix: TTRC-218 (Worker cannot run without this)
-- Related: TTRC-216, Migration 023
-- Date: 2025-10-12
--
-- ISSUE: Migration 023 added enrichment fields but didn't update the severity constraint.
-- The old constraint expects: 'low', 'medium', 'high'
-- But enrichment uses: 'critical', 'severe', 'moderate', 'minor'
--
-- ERROR (without this fix):
--   new row for relation "executive_orders" violates check constraint "executive_orders_severity_check"
--
-- ============================================================================
-- FIX SEVERITY CONSTRAINT
-- ============================================================================

-- Drop old constraint (if exists)
ALTER TABLE executive_orders DROP CONSTRAINT IF EXISTS executive_orders_severity_check;

-- Add new constraint with correct values
-- NOTE: severity is NULLABLE because legacy records don't have it yet
ALTER TABLE executive_orders ADD CONSTRAINT executive_orders_severity_check
  CHECK (
    severity IS NULL
    OR severity IN ('critical', 'severe', 'moderate', 'minor')
  );

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test that new values are accepted
DO $$
DECLARE
  test_id integer;
BEGIN
  -- Get first EO for testing
  SELECT id INTO test_id FROM executive_orders LIMIT 1;

  IF test_id IS NOT NULL THEN
    -- Try updating with each new severity value
    UPDATE executive_orders SET severity = 'critical' WHERE id = test_id;
    UPDATE executive_orders SET severity = 'severe' WHERE id = test_id;
    UPDATE executive_orders SET severity = 'moderate' WHERE id = test_id;
    UPDATE executive_orders SET severity = 'minor' WHERE id = test_id;
    UPDATE executive_orders SET severity = NULL WHERE id = test_id;  -- Restore NULL

    RAISE NOTICE '✅ Severity constraint accepts all new values';
  ELSE
    RAISE NOTICE '⚠️  No EOs found for testing (table empty)';
  END IF;
END$$;

-- Check constraint exists with correct definition
SELECT
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'executive_orders'::regclass
AND conname = 'executive_orders_severity_check';

-- Count EOs by current severity (should all be NULL before enrichment)
SELECT
  severity,
  COUNT(*) as count
FROM executive_orders
GROUP BY severity
ORDER BY count DESC;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT '✅ Migration 024 complete - Severity constraint fixed' as status;

-- ============================================================================
-- NEXT STEPS
-- ============================================================================
-- 1. Run enrichment worker: node scripts/enrichment/enrich-executive-orders.js 3
-- 2. Verify 3 EOs enriched successfully
-- 3. Check costs: SELECT * FROM eo_enrichment_costs ORDER BY created_at DESC LIMIT 5;
-- 4. Run full backfill: node scripts/enrichment/enrich-executive-orders.js 190

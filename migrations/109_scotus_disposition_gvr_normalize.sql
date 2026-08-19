-- Migration 109: Normalize SCOTUS disposition 'GVR' -> 'gvr' (ADO-551)
-- GVR broke the snake_case convention used by every other disposition value.
-- Data fix + CHECK constraint swap. Idempotent — safe to re-run.
--
-- APPLY ORDER (matters on PROD):
--   1. Apply this migration FIRST (SQL Editor, TEST then PROD).
--   2. Then deploy code that writes 'gvr' (admin.html dropdown, admin-update-scotus
--      edge function, SCOTUS agent prompt allow-list) — the old CHECK rejects 'gvr'.
-- PROD rows affected by the UPDATE: ids 1906, 2051 (audited 2026-08-19). TEST: none.
-- The 10 PROD null-disposition rows (ids 1, 296-304) are deliberately NOT touched —
-- Josh decides hide vs delete separately.

-- Single transaction: the ALTER's ACCESS EXCLUSIVE lock is held until COMMIT,
-- so no concurrent write can land between the drop and the re-add, and a
-- failure anywhere rolls the whole swap back (table never left unconstrained).
BEGIN;

LOCK TABLE scotus_cases IN ACCESS EXCLUSIVE MODE;

-- Step 1: drop the old constraint so the data update can't race it
ALTER TABLE scotus_cases
DROP CONSTRAINT IF EXISTS scotus_cases_disposition_check;

-- Step 2: normalize existing data
UPDATE scotus_cases SET disposition = 'gvr' WHERE disposition = 'GVR';

-- Step 3: re-add the constraint with the canonical snake_case enum
-- (same values as migration 087 except 'GVR' -> 'gvr'; NULL still allowed)
ALTER TABLE scotus_cases
ADD CONSTRAINT scotus_cases_disposition_check
  CHECK (disposition IS NULL OR disposition IN (
    'affirmed', 'reversed', 'vacated', 'remanded',
    'reversed_and_remanded', 'vacated_and_remanded', 'affirmed_and_remanded',
    'dismissed', 'granted', 'denied', 'gvr', 'other'
  ));

COMMIT;

-- Verify (expect 0):
-- SELECT count(*) FROM scotus_cases WHERE disposition = 'GVR';

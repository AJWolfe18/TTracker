-- Migration 110: Hide the 10 legacy null-disposition SCOTUS rows (ADO-551 issue #3)
-- Josh's call 2026-08-19: HIDE (is_public=false), not delete.
--
-- These are early-backfill artifacts on PROD: ids 1, 296-304, all decided_at
-- Jan 2020 (pre-scope for this tracker), null disposition AND null case_type,
-- including the duplicate "In re Raghubir" pair (297, 298). They currently
-- render publicly with a blank disposition.
--
-- Predicate is the full artifact signature (not just ids) so this is a no-op
-- anywhere the ids belong to real cases (safe on TEST and PROD). Idempotent.

UPDATE scotus_cases
SET is_public = false
WHERE id IN (1, 296, 297, 298, 299, 300, 301, 302, 303, 304)
  AND disposition IS NULL
  AND case_type IS NULL
  AND decided_at < '2025-01-01';

-- Verify (expect 0 public artifact rows remaining):
-- SELECT count(*) FROM scotus_cases
-- WHERE is_public = true AND disposition IS NULL AND case_type IS NULL AND decided_at < '2025-01-01';

-- Migration: Add admin publish gate to executive_orders for EO admin tab (ADO-480)
-- Adds is_public + needs_manual_review columns, updated_at auto-increment trigger,
-- and sync trigger that copies executive_orders_enrichment_log.needs_manual_review
-- onto the row (with auto-unpublish on re-flag).
-- Created: 2026-04-18
--
-- DEPENDENCY: executive_orders + executive_orders_enrichment_log tables must exist (migration 091)
--
-- ROLLBACK:
--   DROP TRIGGER eo_log_sync_needs_review_update ON executive_orders_enrichment_log;
--   DROP TRIGGER eo_log_sync_needs_review_insert ON executive_orders_enrichment_log;
--   DROP FUNCTION sync_eo_needs_review_from_log();
--   DROP TRIGGER eo_set_updated_at ON executive_orders;
--   DROP FUNCTION set_eo_updated_at();
--   DROP INDEX IF EXISTS idx_eo_publish_state;
--   ALTER TABLE executive_orders DROP COLUMN needs_manual_review, DROP COLUMN is_public;

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Column adds — idempotent (safe to re-run, admin-publish-state preserving)
-- ─────────────────────────────────────────────────────────────
-- First-apply backfill: every existing row stays visible on the public site.
-- `NOT NULL DEFAULT true` on ADD COLUMN populates the initial backfill for free —
-- no explicit UPDATE needed.
--
-- Re-apply safety: ADD COLUMN IF NOT EXISTS is a no-op when the column already
-- exists, so the existing row values are preserved. We DELIBERATELY do not
-- UPDATE here — a post-migration admin action that unpublishes a row (sets
-- is_public=false) must survive a migration replay.
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS needs_manual_review boolean NOT NULL DEFAULT false;

-- Future rows default to false (require explicit admin publish). Safe to re-run:
-- ALTER COLUMN SET DEFAULT is idempotent (no-op if the default is already false).
ALTER TABLE executive_orders ALTER COLUMN is_public SET DEFAULT false;

-- ─────────────────────────────────────────────────────────────
-- updated_at auto-increment trigger
-- Required so admin optimistic locking (CAS on if_updated_at) actually advances.
-- Without this, two same-millisecond writes could share updated_at and both succeed.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_eo_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eo_set_updated_at ON executive_orders;
CREATE TRIGGER eo_set_updated_at
  BEFORE UPDATE ON executive_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_eo_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Sync trigger: log.needs_manual_review → executive_orders.needs_manual_review
-- When the log raises the flag, ALSO set is_public = false (re-flag auto-unpublishes
-- so admin must re-review before content reappears on the public site).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_eo_needs_review_from_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE executive_orders
     SET needs_manual_review = NEW.needs_manual_review,
         is_public = CASE
                       WHEN NEW.needs_manual_review = true THEN false
                       ELSE is_public
                     END
   WHERE id = NEW.eo_id;
  RETURN NEW;
END;
$$;

-- Two triggers split INSERT vs UPDATE so the firing contract is explicit.
-- INSERT: fires iff the inserted row is already 'completed'.
DROP TRIGGER IF EXISTS eo_log_sync_needs_review_insert ON executive_orders_enrichment_log;
CREATE TRIGGER eo_log_sync_needs_review_insert
  AFTER INSERT ON executive_orders_enrichment_log
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION sync_eo_needs_review_from_log();

-- UPDATE: fires iff status transitions INTO 'completed' from anything else.
-- Redundant 'completed' → 'completed' writes do not re-fire the sync.
DROP TRIGGER IF EXISTS eo_log_sync_needs_review_update ON executive_orders_enrichment_log;
CREATE TRIGGER eo_log_sync_needs_review_update
  AFTER UPDATE OF status ON executive_orders_enrichment_log
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION sync_eo_needs_review_from_log();

-- Firing guarantee:
--   For any single agent run that creates one log row per EO, the sync fires
--   EXACTLY ONCE per EO on the first transition into 'completed' — regardless
--   of whether the agent does INSERT(running) → UPDATE(completed) or
--   INSERT(completed) directly. Redundant UPDATE(completed) writes are no-ops.
--   A failed→completed retry DOES re-fire (correct — new result deserves sync).

-- ─────────────────────────────────────────────────────────────
-- Indexes supporting tab predicates
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_eo_publish_state
  ON executive_orders (prompt_version, is_public, needs_manual_review);

COMMIT;

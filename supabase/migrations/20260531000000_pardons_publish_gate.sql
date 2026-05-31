-- Migration: Pardons publish-review gate (ADO-527)
-- Created: 2026-05-31
--
-- Gates is_public on needs_review at the DB layer.
-- A BEFORE trigger forces is_public=false whenever needs_review=true on any write path.
-- This makes the gate impossible to bypass regardless of caller (agent, admin UI, direct SQL).
--
-- Precedent: supabase/migrations/20260418000000_eo_admin_publish_gate.sql (EO version).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS pardons_publish_gate ON pardons;
--   DROP FUNCTION IF EXISTS enforce_pardons_publish_gate();
--   DROP INDEX IF EXISTS idx_pardons_needs_review;

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Trigger function: needs_review=true forces is_public=false
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_pardons_publish_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF NEW.needs_review = true THEN
    NEW.is_public := false;
  END IF;
  RETURN NEW;
END;
$$;

-- Idempotent: DROP + CREATE (CREATE TRIGGER IF NOT EXISTS is not supported)
DROP TRIGGER IF EXISTS pardons_publish_gate ON public.pardons;
CREATE TRIGGER pardons_publish_gate
  BEFORE INSERT OR UPDATE ON public.pardons
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_pardons_publish_gate();

-- ─────────────────────────────────────────────────────────────
-- Backfill: clear the now-invalid state (is_public=true AND needs_review=true)
-- Rows in this state were reviewed in the 2026-05-31 quality review
-- and are legitimately public; the needs_review flag was advisory only
-- and has been consumed. The trigger only fires on writes, so an explicit
-- backfill is required.
-- ─────────────────────────────────────────────────────────────
UPDATE public.pardons
SET needs_review = false
WHERE is_public = true
  AND needs_review = true;

-- ─────────────────────────────────────────────────────────────
-- Index: partial index for the review-queue admin filter
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pardons_needs_review
  ON public.pardons (id)
  WHERE needs_review = true;

COMMIT;

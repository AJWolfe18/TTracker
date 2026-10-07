-- Migration 128: EO review flag becomes advisory - a flag no longer unpublishes the order.
--
-- Why (Josh, October 6, 2026: "EOs should almost never be held back"): migration 092 made the
-- log-to-row sync trigger set is_public = false whenever the agent raised needs_manual_review, so
-- every flagged EO vanished from the site until someone opened admin. EOs now follow the SCOTUS
-- model: publish by default, the flag only marks the order for an after-publish look in the admin
-- Needs Review tab. Pardons keep their deliberate needs_review publish gate (ADO-527).
--
-- The trigger still copies the boolean onto executive_orders, so the admin tab, the admin stats
-- card and the needs-review Discord alert keep working. Admin "Mark reviewed" (the existing
-- publish action) clears it.
--
-- Rows the old trigger already hid are republished by the one-time
-- scripts/maintenance/2026-10-06-held-back-rows.sql (kept out of this file so a replay can never
-- republish an EO an admin unpublished by hand later).
--
-- Idempotent: CREATE OR REPLACE only. The triggers from 092 are unchanged and keep pointing at
-- this function. SET search_path matches migration 095's hardening (CREATE OR REPLACE drops it).
--
-- Rollback: re-run the function body from migrations/092_eo_admin_publish_gate.sql, then
-- ALTER FUNCTION sync_eo_needs_review_from_log() SET search_path = pg_catalog, public, extensions;

CREATE OR REPLACE FUNCTION sync_eo_needs_review_from_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  UPDATE executive_orders
     SET needs_manual_review = NEW.needs_manual_review
   WHERE id = NEW.eo_id;
  RETURN NEW;
END;
$$;

-- VERIFICATION (read-only, run after). Expect one row: hides_on_flag = false, has_search_path = true
-- SELECT position('is_public' in prosrc) > 0 AS hides_on_flag,
--        proconfig::text LIKE '%search_path%' AS has_search_path
--   FROM pg_proc WHERE proname = 'sync_eo_needs_review_from_log';

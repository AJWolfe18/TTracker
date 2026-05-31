-- Migration: 095_security_hardening_rpcs.sql
-- Purpose: Resolve Supabase security advisor WARN findings (TEST first, then PR to PROD).
--   A) Revoke default-PUBLIC / anon / authenticated EXECUTE on internal SECURITY DEFINER
--      RPCs that only service_role legitimately calls; grant service_role explicitly.
--   B) Set a non-mutable search_path on the 9 advisor-flagged functions, using the repo's
--      established hardening value `pg_catalog, public, extensions` (see migration 052).
--
-- Implementation note: functions are resolved by NAME + ARG COUNT and altered via dynamic
-- SQL (oid::regprocedure) rather than hardcoded type signatures. This is robust to the two
-- upsert_article_and_enqueue_jobs overloads (we target only the 14-arg one) and avoids
-- fragile long type-lists. REVOKE/GRANT/ALTER are idempotent; the whole block is atomic.
--
-- Scope:
--   * upsert_article_and_enqueue_jobs(14 args) = legacy/canonical overload, advisor-flagged,
--     locked down here. The 10-arg overload (live RSS hot path, scripts/rss/fetch_feed.js;
--     hardened in 052; NOT flagged) is intentionally LEFT UNTOUCHED.
--   * undo_content_change grants are NOT changed (admin.html calls it with the anon key) —
--     only its search_path is set. Proper lockdown is deferred to ADO-525.

DO $$
DECLARE
  r record;
BEGIN
  -- A) Lock down the 3 internal RPCs: revoke anon/PUBLIC/authenticated, grant service_role.
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      (p.proname = 'log_content_change'              AND p.pronargs = 7)  OR
      (p.proname = 'log_admin_action'                AND p.pronargs = 6)  OR
      (p.proname = 'upsert_article_and_enqueue_jobs' AND p.pronargs = 14)
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;

  -- B) Harden search_path on the 9 advisor-flagged functions (no behavior change).
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      (p.proname = 'log_content_change'            AND p.pronargs = 7) OR
      (p.proname = 'log_admin_action'              AND p.pronargs = 6) OR
      (p.proname = 'undo_content_change'           AND p.pronargs = 3) OR
      (p.proname = 'qa_claim_pending_batch_items'  AND p.pronargs = 1) OR
      (p.proname = 'set_eo_updated_at'             AND p.pronargs = 0) OR
      (p.proname = 'sync_eo_needs_review_from_log' AND p.pronargs = 0) OR
      (p.proname = 'flag_story_for_review'         AND p.pronargs = 0) OR
      (p.proname = 'add_content_revision_scotus'   AND p.pronargs = 8) OR
      (p.proname = 'trim_content_revisions_scotus' AND p.pronargs = 2)
    )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions', r.oid::regprocedure);
  END LOOP;
END $$;

--------------------------------------------------------------------------------------------
-- VERIFICATION (run separately AFTER the migration; read-only, zero cost).
-- Expected: log_content_change(7), log_admin_action(6), upsert(14) -> anon=f, authenticated=f,
--   service_role=t. undo_content_change(3) -> anon=t (retained, deferred to ADO-525).
--   All 9 hardened functions -> proconfig shows search_path=pg_catalog, public, extensions.
--   upsert(10) overload -> unchanged.
--------------------------------------------------------------------------------------------
-- SELECT p.proname, p.pronargs,
--        has_function_privilege('anon',         p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated',p.oid, 'EXECUTE') AS authenticated,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
--        p.proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname IN (
--   'log_content_change','log_admin_action','undo_content_change',
--   'upsert_article_and_enqueue_jobs','qa_claim_pending_batch_items','set_eo_updated_at',
--   'sync_eo_needs_review_from_log','flag_story_for_review','add_content_revision_scotus',
--   'trim_content_revisions_scotus')
-- ORDER BY p.proname, p.pronargs;

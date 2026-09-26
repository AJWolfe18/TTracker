-- Migration: 119_admin_audit_tables_hardening.sql
-- ADO-353 (remaining items; the undo_content_change items shipped in migration 118).
-- Hygiene only, no behavior change:
--   1. The "Service role only" FOR ALL policies on admin.content_history and admin.action_log get
--      an explicit WITH CHECK (Postgres already reuses USING when it is omitted; explicit is clearer).
--      Same expression migration 093 set for USING.
--   2. changed_at / created_at become NOT NULL (both default now(); no writer sets them to null).
--      If any null exists, SET NOT NULL fails and the whole transaction rolls back unchanged.
-- Idempotent: ALTER POLICY and SET NOT NULL can be re-run.

BEGIN;

ALTER POLICY "Service role only" ON admin.content_history
  USING ((select current_setting('role')) = 'service_role')
  WITH CHECK ((select current_setting('role')) = 'service_role');

ALTER POLICY "Service role only" ON admin.action_log
  USING ((select current_setting('role')) = 'service_role')
  WITH CHECK ((select current_setting('role')) = 'service_role');

ALTER TABLE admin.content_history ALTER COLUMN changed_at SET NOT NULL;
ALTER TABLE admin.action_log ALTER COLUMN created_at SET NOT NULL;

COMMIT;

-- VERIFY (read-only). Expected: both policies show with_check; both columns is_nullable = NO.
SELECT tablename, policyname, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'admin' AND tablename IN ('content_history', 'action_log');
SELECT table_name, column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'admin'
   AND (table_name, column_name) IN (('content_history', 'changed_at'), ('action_log', 'created_at'));

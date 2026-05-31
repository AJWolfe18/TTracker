-- Migration: 096_prod_security_drift.sql
-- Purpose: Resolve PROD-only Supabase security advisor findings that TEST did not have
--   (PROD had drifted from TEST). Two parts:
--   A) Lock down 3 anon/authenticated-callable SECURITY DEFINER functions that only
--      service_role legitimately uses (job-queue helpers + the 10-arg upsert overload).
--   B) Drop 9 dead, always-true `{public}` write RLS policies. These are NOT exploitable
--      (anon/authenticated hold no INSERT/UPDATE/DELETE table grant on these tables, and
--      service_role bypasses RLS), but they trip advisor rule 0024 and are a latent foot-gun.
--
-- Safety / idempotency:
--   * Functions resolved by name + arg count via dynamic SQL (oid::regprocedure). REVOKE/GRANT
--     are convergent. On TEST these are already locked, so this is a no-op there.
--   * DROP POLICY IF EXISTS is a no-op where the policy is absent (e.g. all of TEST).
--   * KEEPS every SELECT/read policy, the service_role full-access policies, and the
--     conditional `Authenticated users can manage submissions` policy.
--
-- Companion to 095 (095 locked the 14-arg upsert; 096 locks the 10-arg overload).

DO $$
DECLARE
  r record;
BEGIN
  -- A) Lock down the 3 SECURITY DEFINER functions: revoke anon/PUBLIC/authenticated, grant service_role.
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      (p.proname = 'claim_next_job'                  AND p.pronargs = 1)  OR
      (p.proname = 'reset_failed_jobs'               AND p.pronargs = 2)  OR
      (p.proname = 'upsert_article_and_enqueue_jobs' AND p.pronargs = 10)
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- B) Drop the 9 dead always-true `{public}` write policies (advisor rule 0024).
--    executive_orders (active table):
DROP POLICY IF EXISTS "Allow public delete"                 ON public.executive_orders;
DROP POLICY IF EXISTS "Allow public insert"                 ON public.executive_orders;
DROP POLICY IF EXISTS "Service can insert executive orders" ON public.executive_orders;
DROP POLICY IF EXISTS "Enable archive updates"              ON public.executive_orders;

--    political_entries (legacy table):
DROP POLICY IF EXISTS "Allow public delete"                  ON public.political_entries;
DROP POLICY IF EXISTS "Allow public insert"                  ON public.political_entries;
DROP POLICY IF EXISTS "Service can insert political entries"  ON public.political_entries;
DROP POLICY IF EXISTS "Enable archive updates"               ON public.political_entries;

--    pending_submissions:
DROP POLICY IF EXISTS "Service can manage submissions" ON public.pending_submissions;

--------------------------------------------------------------------------------------------
-- VERIFICATION (run separately AFTER the migration; read-only, zero cost).
-- 1) Functions: claim_next_job(1), reset_failed_jobs(2), upsert(10) -> anon=f, authenticated=f,
--    service_role=t.
--    SELECT p.proname, p.pronargs,
--           has_function_privilege('anon',          p.oid,'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid,'EXECUTE') AS authenticated,
--           has_function_privilege('service_role',  p.oid,'EXECUTE') AS service_role
--    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('claim_next_job','reset_failed_jobs','upsert_article_and_enqueue_jobs')
--    ORDER BY p.proname, p.pronargs;
-- 2) Policies: the 9 dropped policies should be gone; reads + service_role policies remain.
--    SELECT tablename, policyname, cmd, roles
--    FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('executive_orders','political_entries','pending_submissions')
--    ORDER BY tablename, cmd, policyname;

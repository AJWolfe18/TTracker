-- ============================================
-- TTRC-314: Supabase Security Hardening - Phase 1
-- Migration: 046_security_lockdown.sql
--
-- IMPORTANT: Run via Supabase SQL Editor (as postgres owner)
-- so ALTER DEFAULT PRIVILEGES applies project-wide
--
-- This migration locks down anon and authenticated roles to
-- SELECT-only on 5 public tables. All other privileges revoked.
-- ============================================

-- Step 1: Hard cut anon off from EVERYTHING
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Step 1b: Also lock down authenticated (not used in current architecture)
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- Step 2: Grant back ONLY what's needed (5 tables, SELECT only)
GRANT SELECT ON public.stories           TO anon;
GRANT SELECT ON public.articles          TO anon;
GRANT SELECT ON public.article_story     TO anon;
GRANT SELECT ON public.executive_orders  TO anon;
GRANT SELECT ON public.political_entries TO anon;
-- NOTHING ELSE for anon

-- Step 2b: authenticated gets same SELECT (for future use if needed)
GRANT SELECT ON public.stories           TO authenticated;
GRANT SELECT ON public.articles          TO authenticated;
GRANT SELECT ON public.article_story     TO authenticated;
GRANT SELECT ON public.executive_orders  TO authenticated;
GRANT SELECT ON public.political_entries TO authenticated;

-- Step 3: Lock down future tables/functions by default
-- This ensures any NEW tables created will NOT have anon/authenticated access
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;

-- ============================================
-- VERIFICATION (run after migration)
-- ============================================
-- Should return ONLY 5 rows for anon, all SELECT:
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.table_privileges
-- WHERE grantee = 'anon' AND table_schema = 'public'
-- ORDER BY table_name;

-- Should return 0 rows (no function access):
-- SELECT routine_name, grantee
-- FROM information_schema.routine_privileges
-- WHERE grantee = 'anon' AND routine_schema = 'public';

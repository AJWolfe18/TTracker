-- ============================================
-- TTRC-314: Supabase Security Hardening - Phase 2
-- Migration: 047_fix_rls_policies.sql
--
-- IMPORTANT: Run via Supabase SQL Editor (as postgres owner)
--
-- This migration:
-- 1. Ensures RLS is enabled on all public-facing tables
-- 2. Removes dangerous UPDATE policies
-- 3. Creates explicit FOR SELECT policies for anon/authenticated
-- 4. Creates service_role policies for documentation
-- ============================================

-- Ensure RLS is enabled on all public-facing tables
-- (idempotent - safe to run even if already enabled)
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_story ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_split_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.political_entries ENABLE ROW LEVEL SECURITY;

-- Fix executive_orders: remove dangerous UPDATE policy (if exists)
DROP POLICY IF EXISTS "Allow archived field updates" ON public.executive_orders;

-- ============================================
-- Ensure anon/authenticated FOR SELECT policies exist on all 5 public tables
-- (Some may already exist from migration 001 - DROP IF EXISTS makes this safe)
-- ============================================

DROP POLICY IF EXISTS "Allow public read" ON public.stories;
CREATE POLICY "Allow public read"
ON public.stories FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public read" ON public.articles;
CREATE POLICY "Allow public read"
ON public.articles FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public read" ON public.article_story;
CREATE POLICY "Allow public read"
ON public.article_story FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public read" ON public.executive_orders;
CREATE POLICY "Allow public read"
ON public.executive_orders FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public read" ON public.political_entries;
CREATE POLICY "Allow public read"
ON public.political_entries FOR SELECT TO anon, authenticated
USING (true);

-- ============================================
-- Add service_role full access policies for documentation/future non-bypass roles
-- Note: With Supabase's service_role key, RLS is bypassed entirely;
-- these policies are mainly redundant but harmless and provide clarity
-- ============================================

DROP POLICY IF EXISTS "service_role full access" ON public.stories;
CREATE POLICY "service_role full access"
ON public.stories FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON public.articles;
CREATE POLICY "service_role full access"
ON public.articles FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON public.article_story;
CREATE POLICY "service_role full access"
ON public.article_story FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON public.executive_orders;
CREATE POLICY "service_role full access"
ON public.executive_orders FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON public.story_split_actions;
CREATE POLICY "service_role full access"
ON public.story_split_actions FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role full access" ON public.political_entries;
CREATE POLICY "service_role full access"
ON public.political_entries FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- ============================================
-- VERIFICATION (run after migration)
-- ============================================
-- Check RLS policies:
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('stories', 'articles', 'article_story',
--                     'executive_orders', 'political_entries', 'story_split_actions')
-- ORDER BY tablename, policyname;

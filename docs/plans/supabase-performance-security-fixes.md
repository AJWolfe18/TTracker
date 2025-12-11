# Supabase Security Hardening Plan (FINAL)

**Status:** CRITICAL - Active vulnerability requiring immediate fix
**Priority:** HIGH - Must-do before any other feature work
**Created:** 2025-12-10
**Revised:** 2025-12-11 (v4 - expert-reviewed)
**JIRA:** [TTRC-314](https://ajwolfe37.atlassian.net/browse/TTRC-314)

---

## Expert Review Summary (2025-12-11)

**Review Status:** APPROVED - Plan aligns with PostgreSQL/Supabase best practices

**Improvements Made in v4:**
1. Added `authenticated` role lockdown (was overlooked - has unused INSERT/UPDATE)
2. Added `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for all public-facing tables (idempotent safety)
3. Added `DROP POLICY IF EXISTS` before `CREATE POLICY` (idempotent safety)
4. Added explicit `anon SELECT` policies for all 5 public tables (not just service_role)
5. Added verification queries for post-migration validation
6. Added rollback plan for emergency recovery (with risk warnings)
7. Added `Authorization: Bearer` headers to curl tests (required by Supabase)
8. Documented job-creation RPC vulnerability being fixed (e.g., `enqueue_job`)
9. Clarified service_role RLS behavior (bypasses RLS via key, policies are for documentation)

**Gotchas Verified:**
| Issue | Status |
|-------|--------|
| anon EXECUTE on job RPCs | Fixed by REVOKE ALL ON FUNCTIONS |
| executive_orders RLS may be disabled | Fixed by ENABLE RLS statement |
| political_entries needs anon SELECT policy | Added explicit "Allow public read" policy |
| "Allow archived field updates" policy location | DROP IF EXISTS handles both cases |
| story_split_actions has existing policies | Multiple policies OR together safely |
| ALTER DEFAULT PRIVILEGES scope | Runs as postgres owner, applies globally |
| service_role RLS behavior | Clarified: bypasses RLS via key, policies for documentation |

---

## Threat Model

**Current State:** anon key (exposed in browser JS) has full CRUD on ~25 internal tables. RLS protects core tables (stories/articles) but internal tables are wide open.

**Known Vulnerabilities Being Fixed:**
- `anon` has EXECUTE on job-creation RPCs (e.g., `enqueue_job()` in `migrations/002_job_queue_functions.sql:69`) - allows arbitrary job creation
- `anon` has SELECT on internal tables (job_queue, feed_registry, etc.)
- `authenticated` role has unused INSERT/UPDATE privileges on core tables
- `executive_orders` may have RLS disabled or dangerous UPDATE policy

**Invariants After Fix:**
1. anon has **only SELECT** privileges on 5 public tables
2. anon has **no EXECUTE** on any function
3. RLS policies for anon are **FOR SELECT only**
4. anon will **never** receive INSERT/UPDATE/DELETE privileges or policies
5. Future tables are **secure by default** via ALTER DEFAULT PRIVILEGES
6. authenticated role locked down (not used in current architecture)

---

## Phase 1: Global Privilege Lockdown (30 min)

### Migration: `migrations/046_security_lockdown.sql`

```sql
-- ============================================
-- PHASE 1: Global REVOKE + explicit GRANT pattern
-- Migration: migrations/046_security_lockdown.sql
-- IMPORTANT: Run via Supabase SQL Editor (as postgres owner)
-- so ALTER DEFAULT PRIVILEGES applies project-wide
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
```

## Phase 2: Fix RLS Policies (30 min)

RLS is already enabled on core tables. We need to:
1. Ensure RLS is enabled on all public-facing tables (may not be for some)
2. Fix the dangerous `executive_orders` UPDATE policy (if exists)
3. Ensure all 5 public tables have FOR SELECT TO anon policies
4. Add service_role policies for documentation (note: service_role key bypasses RLS anyway)

### Migration: `migrations/047_fix_rls_policies.sql`

```sql
-- ============================================
-- PHASE 2: Fix RLS policies
-- Migration: migrations/047_fix_rls_policies.sql
-- IMPORTANT: Run via Supabase SQL Editor (as postgres owner)
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
```

---

## Phase 3: Rotate Keys (REQUIRED)

**Do this AFTER Phases 1-2 are deployed and tested.**

1. Go to Supabase Dashboard → Settings → API
2. Rotate `anon` key → Update frontend config, Netlify env
3. Rotate `service_role` key → Update .env, GitHub Secrets, Edge Functions
4. Remove old keys from all CI/deployment environments
5. Redeploy everything

**Non-optional:** The old anon key has been a "delete everything" credential.

---

## Verification Queries (Run After Each Phase)

```sql
-- After Phase 1: Verify privileges
-- Should return ONLY 5 rows for anon, all SELECT
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'anon' AND table_schema = 'public'
ORDER BY table_name;

-- Verify no function access for anon
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE grantee = 'anon' AND routine_schema = 'public';
-- Should return 0 rows

-- After Phase 2: Verify RLS policies
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('stories', 'articles', 'article_story',
                    'executive_orders', 'political_entries', 'story_split_actions')
ORDER BY tablename, policyname;
```

---

## Sanity Tests (After Deployment)

Run with anon key:
```bash
# Set your environment (TEST)
URL="https://wnrjrywpcadwutfykflu.supabase.co"
ANON="your-anon-key-here"

# These should FAIL (401/403)
curl -X DELETE "$URL/rest/v1/job_queue?id=gt.0" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -X DELETE "$URL/rest/v1/executive_orders?id=gt.0" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# Note: Use whatever job-enqueue RPC exists in your project (enqueue_job, enqueue_fetch_job, etc.)
curl -X POST "$URL/rest/v1/rpc/enqueue_job" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{}'

# These should SUCCEED (200 + data)
curl "$URL/rest/v1/stories?limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl "$URL/rest/v1/articles?limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl "$URL/rest/v1/executive_orders?limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"

# Frontend smoke test
# - Load https://test--ttracker.netlify.app
# - Verify stories display
# - Check browser console for errors
```

Run with service_role key (verify backend still works):
```bash
SERVICE="your-service-role-key-here"

# These should SUCCEED (service_role has full access)
curl "$URL/rest/v1/job_queue?limit=1" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE"
curl -X POST "$URL/rest/v1/rpc/enqueue_fetch_job" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -d '{"p_job_type":"test","p_payload":{}}'
```

---

## Upkeep (Minimal)

| Scenario | Action Required |
|----------|-----------------|
| **New internal table** | None - secure by default (ALTER DEFAULT PRIVILEGES) |
| **New public table** | 1) `GRANT SELECT TO anon` 2) Enable RLS 3) Add FOR SELECT policy |
| **Monthly audit** | Run privilege verification query, confirm only 5 SELECT grants |

---

## Execution Checklist

| # | Task | Status |
|---|------|--------|
| 1 | Create JIRA ticket TTRC-XXX | |
| 2 | Create migration file `migrations/046_security_lockdown.sql` | |
| 3 | Run migration 046 via Supabase SQL Editor | |
| 4 | Run verification queries (privileges) | |
| 5 | Test: frontend loads, curl DELETE fails | |
| 6 | Create migration file `migrations/047_fix_rls_policies.sql` | |
| 7 | Run migration 047 via Supabase SQL Editor | |
| 8 | Run verification queries (RLS policies) | |
| 9 | Test: backend scripts still work | |
| 10 | Rotate anon key in Supabase Dashboard | |
| 11 | Update frontend config (SUPABASE_ANON_KEY) | |
| 12 | Rotate service_role key in Supabase Dashboard | |
| 13 | Update .env, GitHub Secrets, Edge Functions | |
| 14 | Redeploy all services | |
| 15 | Final sanity tests | |
| 16 | Update JIRA ticket to Done | |

**Total: ~1.5 hours**

---

## Rollback Plan (If Something Breaks)

**WARNING:** Rollback steps temporarily re-expose internal tables. Only use if hard-broken and cannot fix immediately. Re-apply Phase 1 ASAP after emergency fix.

If frontend breaks after Phase 1:
```sql
-- EMERGENCY: Re-grant SELECT to anon on all tables
-- WARNING: This reopens the original vulnerability (anon can see internal tables)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
-- Then debug and re-apply Phase 1 with fixes
```

If backend breaks after Phase 2:
```sql
-- EMERGENCY: Grant service_role full access
-- This is less risky (service_role is server-side only) but still weakens posture
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- Then debug and re-apply Phase 2 with fixes
```

After key rotation (cannot rollback):
- **Keys cannot be restored once rotated**
- Immediately update all environments with new keys
- If you rotated by mistake, you must update all configs to the new keys

---

## Quick Reference

**Privileges vs RLS:**
- **Privileges** = Can the role attempt the operation?
- **RLS** = Which rows are visible/modifiable?

**Our invariants:**
- anon has SELECT privilege on 5 tables only
- anon has no EXECUTE on any function
- authenticated has same read-only privileges as anon on 5 tables (for future use)
- RLS policies for anon/authenticated are FOR SELECT only
- service_role bypasses RLS entirely via Supabase key (policies are for documentation)

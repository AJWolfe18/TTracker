# TTRC-314: Supabase Security Hardening - Handoff

**Date:** 2025-12-11
**Status:** Complete (TEST), Pending (PROD)
**JIRA:** [TTRC-314](https://ajwolfe37.atlassian.net/browse/TTRC-314)

---

## What Was Done

Locked down Supabase anon and authenticated roles to prevent unauthorized data access/modification.

### Migrations Applied (TEST)
- `migrations/046_security_lockdown.sql` - REVOKE ALL + GRANT SELECT
- `migrations/047_fix_rls_policies.sql` - ENABLE RLS + FOR SELECT policies

### Before vs After

| Role | Before | After |
|------|--------|-------|
| anon | Full CRUD on ~25 tables, EXECUTE on functions | SELECT on 5 tables only |
| authenticated | INSERT/UPDATE on core tables | SELECT on 5 tables only |
| service_role | Full access | Unchanged (bypasses RLS) |

### Tables Accessible to anon/authenticated
1. `stories`
2. `articles`
3. `article_story`
4. `executive_orders`
5. `political_entries`

---

## Verification Results

```
| grantee | table_name        | privilege_type |
|---------|-------------------|----------------|
| anon    | article_story     | SELECT         |
| anon    | articles          | SELECT         |
| anon    | executive_orders  | SELECT         |
| anon    | political_entries | SELECT         |
| anon    | stories           | SELECT         |
```

### Tests Passed
- DELETE on job_queue: **401** (blocked)
- RPC enqueue_fetch_job: **404** (not visible to anon)
- SELECT on stories: **200** (works)
- Frontend: Stories display correctly

---

## Follow-Up Tickets

| Ticket | Description | Priority |
|--------|-------------|----------|
| [TTRC-315](https://ajwolfe37.atlassian.net/browse/TTRC-315) | Rotate API Keys (TEST) | Medium |
| [TTRC-316](https://ajwolfe37.atlassian.net/browse/TTRC-316) | Apply to PROD Database | High |

---

## Files Changed

```
migrations/046_security_lockdown.sql  (new)
migrations/047_fix_rls_policies.sql   (new)
docs/plans/supabase-performance-security-fixes.md (new)
```

**Commit:** `ae4f02e` on `test` branch

---

## How to Apply to PROD

1. Go to PROD SQL Editor: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg/sql
2. Run migration 046 (copy from file or TTRC-316 ticket)
3. Verify: Should show 5 tables, all SELECT
4. Run migration 047
5. Test trumpytracker.com still works

Full SQL is in TTRC-316 ticket description.

---

## Rollback (Emergency Only)

If frontend breaks:
```sql
-- WARNING: Reopens vulnerability
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
```

Then debug and re-apply migrations.

---

## Key Rotation (Deferred)

Old anon key was exposed with full CRUD access. Even though privileges are now revoked, keys should be rotated to invalidate any leaked credentials.

See TTRC-315 for full steps. Do this after PROD is also hardened.

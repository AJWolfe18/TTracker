# Supabase Linter Exceptions

**Last Updated:** 2026-01-08
**Ticket:** TTRC-368
**Environment:** PROD (osjbulmltfpcoldydexg)

This document explains why certain Supabase linter warnings are intentionally accepted rather than "fixed."

---

## Summary

| Warning Type | Count | Status | Reason |
|--------------|-------|--------|--------|
| Extensions in public schema | 3 | Accepted | CREATE privilege already blocked; moving risks breaking clustering |
| RLS USING(true) policies | 9 | Intentional | Public-read news data; privilege revocation is the security layer |
| Postgres version | 1 | Skipped | Infrastructure change requiring Supabase support |

**Warning reduction:** 16 (original) -> 3 (Phase 1 TTRC-366) -> 13 remaining -> **0 actionable**

---

## Extensions in Public Schema (3 warnings)

### Extensions Affected
- `pg_trgm` - Fuzzy text matching
- `vector` - AI embeddings for article clustering
- `fuzzystrmatch` - Phonetic string matching

### Why We Accept This Warning

**The exploit scenario:** An attacker creates a fake function in the public schema that shadows an extension function, causing malicious code to run when the extension function is called.

**Why it doesn't apply here:** This attack requires CREATE privilege on the public schema. Verification confirms untrusted roles cannot create objects:

```sql
-- Query 6: Schema CREATE Privileges (PROD, 2026-01-08)
SELECT role, has_schema_privilege(role, 'public', 'CREATE') AS can_create
FROM (VALUES ('anon'), ('authenticated'), ('public')) AS t(role);
```

**Result:**
| role | can_create |
|------|------------|
| anon | false |
| authenticated | false |
| public | false |

### Why We Don't Move Extensions

Moving extensions to the `extensions` schema risks breaking:
- Article clustering (depends on `vector` extension)
- Similarity search functions
- Any code calling extension functions without schema qualification

The risk of a production outage far outweighs silencing a theoretical warning that's already mitigated by privilege restrictions.

---

## RLS USING(true) Policies (9 warnings)

### Tables Affected
- `executive_orders`
- `political_entries`
- `pending_submissions`

### Why We Accept This Warning

**The warning:** Linter flags `USING(true)` as "overly permissive" because it allows access to all rows without filtering.

**Why it's intentional:** These tables contain public news data. There is no row-level filtering needed - all users should see the same content.

### Security Layer: Privilege Revocation

Migration 046 (`security_lockdown.sql`) is the actual security mechanism:
- Revoked ALL privileges from anon/authenticated
- Granted back ONLY SELECT on specific public-facing tables
- RLS `USING(true)` is a documentation layer, not the security layer

### Verification: Privilege Posture (PROD, 2026-01-08)

```sql
-- Query 7: Table Privilege Posture
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('executive_orders', 'political_entries', 'pending_submissions')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee;
```

**Result:**
| grantee | table_name | privilege_type |
|---------|------------|----------------|
| anon | executive_orders | SELECT |
| authenticated | executive_orders | SELECT |
| anon | political_entries | SELECT |
| authenticated | political_entries | SELECT |

**Note:** `pending_submissions` has NO privileges for anon/authenticated - it's completely inaccessible to public users (even more restrictive than the other tables).

### Conclusion

- Commands allowed: SELECT only
- Roles affected: anon, authenticated
- Other privileges (INSERT, UPDATE, DELETE): Not granted
- `pending_submissions`: Completely inaccessible to public users

The `USING(true)` warning is a "are you sure?" prompt. Answer: Yes, this is public news data.

---

## Postgres Version (1 warning)

### Status
Skipped - Infrastructure change

### Reason
Postgres version upgrades require Supabase support coordination and a maintenance window. This is not a code-level fix.

### Action
- Support ticket: NOT FILED
- Reason: Current Postgres version is stable; upgrade can be scheduled during planned maintenance

---

## Related Tickets

- **TTRC-366:** Phase 1 - Fixed function search_path issues, dropped duplicate indexes
- **TTRC-368:** Phase 2 - Documented these exceptions (this document)
- **TTRC-314:** Security lockdown migrations (046, 047)

---

## Verification Queries Reference

### Query 6: Schema CREATE Privileges
```sql
SELECT
  'anon' AS role, has_schema_privilege('anon', 'public', 'CREATE') AS can_create
UNION ALL
SELECT
  'authenticated', has_schema_privilege('authenticated', 'public', 'CREATE')
UNION ALL
SELECT
  'public', has_schema_privilege('public', 'public', 'CREATE');
```

### Query 7: Table Privilege Posture
```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('executive_orders', 'political_entries', 'pending_submissions')
ORDER BY table_name, grantee, privilege_type;
```

Run these queries periodically to ensure the security posture hasn't changed.

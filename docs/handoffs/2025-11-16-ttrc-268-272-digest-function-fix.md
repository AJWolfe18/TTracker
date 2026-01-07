# Session Handoff: TTRC-268/272 Follow-up - Database digest() Function Fix

**Date:** 2025-11-16
**Session Duration:** ~3 hours
**Branch:** test
**Commit:** `6ff211a`

---

## Summary

Fixed database-level digest() errors blocking Guardian/NYT/PBS article storage after RSS parsing was fixed in previous session. Articles were parsing successfully but failing to save with `function digest(text, unknown) does not exist` error.

---

## Problem Discovered

### Context
Previous session (2025-11-15) fixed RSS primitive coercion, allowing Guardian/NYT/PBS feeds to parse successfully. However, articles were still not being created in the database.

### Root Cause
Migration 028's `upsert_article_and_enqueue_jobs` function had multiple digest() issues:
1. **Unqualified function calls**: `digest()` instead of `extensions.digest()`
2. **Wrong argument type**: Passing TEXT instead of BYTEA to digest()
3. **Missing schema qualification**: `gen_random_uuid()` not qualified
4. **Incorrect ON CONFLICT targets**: Missing WHERE clause for partial index
5. **Type mismatch**: `p_feed_id` TEXT not cast to BIGINT

### Symptoms
```
ERROR: function digest(text, unknown) does not exist
```
- Guardian/NYT/PBS feeds parsed successfully
- High-scoring articles attempted database insert
- All inserts failed with digest() error
- Zero articles created since Nov 14

---

## Solution Implemented

### Migration 031
Fixed the OLD function signature (with p_url_hash, p_categories, etc):
- Added `extensions.` prefix to all digest() calls
- Added `convert_to(text, 'UTF8')` wrapper for BYTEA conversion
- Added `extensions.` prefix to gen_random_uuid()

**File**: `migrations/031_fix_digest_schema_qualification.sql`

### Migration 032 (Primary Fix)
Fixed the ACTUAL function signature used by RSS worker (Migration 028):
- Added `extensions.` prefix to all 4 digest() calls
- Wrapped all text arguments with `convert_to(text, 'UTF8')`
- Added `extensions.gen_random_uuid()`
- Fixed ON CONFLICT to match partial index: `(payload_hash) WHERE (processed_at IS NULL)`
- Added `p_feed_id::bigint` casts in 3 locations (INSERT, UPDATE, job payload)
- Added NULL/blank URL validation
- Added DROP FUNCTION before CREATE to allow body changes

**Files**:
- `migrations/032_fix_digest_migration_028.sql` (main migration)
- `migrations/032_APPLY_INSTRUCTIONS.md` (deployment guide)

### Key Technical Details

**Digest Function Signature**:
```sql
digest(data BYTEA, type TEXT) RETURNS BYTEA
```

**Before (BROKEN)**:
```sql
encode(digest(p_url, 'sha256'), 'hex')
-- ERROR: function digest(text, unknown) does not exist
```

**After (FIXED)**:
```sql
encode(extensions.digest(convert_to(p_url, 'UTF8'), 'sha256'), 'hex')
-- ✅ Works: schema-qualified, correct type
```

**All 4 digest() locations fixed**:
1. Line 64: URL hash generation
2. Line 119: article.enrich job payload hash
3. Line 156: process_article job payload hash
4. Line 87: gen_random_uuid() call

---

## Verification Results

### Guardian US Politics
- **8 articles created** successfully at `2025-11-16 03:41:50-51`
- Articles: Federal immigration sweep, MTG safety warnings, UC funding case, etc.
- NO digest errors in logs

### PBS NewsHour Politics
- **9 articles created** successfully at `2025-11-16 03:45:00-01`
- Articles: Flight cuts, Trump EO signing, DOJ redistricting suit, etc.
- NO digest errors in logs

### NYT Politics
- **1 article created** successfully at `2025-11-16 03:45:00`
- Article: Trump affordability messaging
- NO digest errors in logs

### Story Clustering
All articles successfully clustered into stories with enrichment jobs enqueued.

---

## Files Changed

```
migrations/031_fix_digest_schema_qualification.sql (248 lines)
migrations/032_fix_digest_migration_028.sql (231 lines)
migrations/032_APPLY_INSTRUCTIONS.md (165 lines)
docs/handoffs/2025-11-15-ttrc-268-272-centralized-primitive-coercion.md (existing)
```

**Commit**: `6ff211a` - "fix(migrations): fix digest() schema qualification and type errors (TTRC-268/272)"

---

## Deployment Notes

Migration 032 was applied to TEST database via Supabase SQL Editor:
1. Opened SQL Editor → New Query
2. Pasted entire contents of `migrations/032_fix_digest_migration_028.sql`
3. Clicked "Run"
4. Result: "Success. No rows returned" (indicates successful execution)
5. Verification NOTICE appears in PostgreSQL logs (not visible in SQL Editor)

**Important**: Worker restart NOT required - new function definition picked up automatically.

---

## Critical Learnings

### Why Migration Failed Initially
First attempt used incomplete temp file missing critical fixes:
- Missing `feed_id` field in article INSERT
- Wrong ON CONFLICT target (missing WHERE clause)
- Missing `feed_id::bigint` cast in job payload

**Lesson**: Always use the FULL migration file from `migrations/`, not temp files.

### Function Overloads
Multiple `upsert_article_and_enqueue_jobs` signatures exist:
- Migration 028 signature (10 params) - Used by RSS worker ✅ Fixed in Migration 032
- Old signature (14 params) - Not used ✅ Fixed in Migration 031

**Lesson**: Verify which function signature is actually being called by the application.

### PostgreSQL CREATE OR REPLACE Limitation
Cannot change function body significantly without DROP:
```sql
DROP FUNCTION IF EXISTS public.upsert_article_and_enqueue_jobs(
  text, text, text, timestamptz, text, text, text, text, boolean, jsonb
);

CREATE OR REPLACE FUNCTION ...
```

---

## Timeline

1. **Previous Session (2025-11-15)**: Fixed RSS primitive coercion (commit `beb3b95`)
2. **This Session Start**: Discovered digest() database errors
3. **Investigation**: Identified unqualified digest() calls in Migration 028 function
4. **Migration 031**: Fixed old function signature (not used by worker)
5. **Migration 032**: Fixed actual function signature used by RSS worker
6. **Verification**: Confirmed Guardian/NYT/PBS articles creating successfully
7. **Cleanup**: Removed temp files, updated instructions
8. **Commit & Push**: Pushed to test branch (commit `6ff211a`)

---

## JIRA Status

**Tickets**: TTRC-268, TTRC-272
**Status**: Ready to mark as **Done** ✅

**Two-Phase Fix**:
1. **Session 1**: RSS parsing (primitive coercion)
2. **Session 2**: Database storage (digest() function)

Both phases complete and verified working.

---

## Next Steps

None - issue fully resolved. RSS pipeline fully functional:
1. ✅ RSS feeds parse successfully
2. ✅ Articles save to database without errors
3. ✅ Story clustering working
4. ✅ Enrichment jobs enqueuing

---

**Created by:** Claude Code
**Review Status:** Complete
**Production Ready:** Yes (TEST database already updated)

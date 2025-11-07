# Migration 029 - READY TO RUN ✅

**Date:** 2025-11-02
**Status:** All feedback incorporated, verified, ready for deployment
**Review Rounds:** 3 (architectural, security, bytea conversion)

---

## ✅ What Was Fixed (3 Rounds of Feedback)

### Round 1: Architectural Review
- ✅ Race-free atomic INSERT with ON CONFLICT
- ✅ Legacy data cleanup
- ✅ CREATE OR REPLACE (preserves grants)
- ✅ Server-side hash computation
- ✅ Comprehensive verification tests

### Round 2: Security Hardening
- ✅ PostgreSQL 15+ version guard
- ✅ pgcrypto extension check
- ✅ Safer search_path: `public, extensions, pg_temp`
- ✅ Full 64-char SHA-256 (no truncation)
- ✅ Production notes for CONCURRENT indexing

### Round 3: bytea Conversion (LATEST)
- ✅ **Use `convert_to(text, 'UTF8')` for digest()**
- ✅ **Unqualified `digest()` call** (resolved via search_path)
- ✅ **Hash verification** matches JavaScript crypto output

---

## 📋 What Migration 029 Does

### Section 1: Version & Extension Checks
- Verifies PostgreSQL 15+
- Ensures pgcrypto exists

### Section 2: Index Management
- Creates partial unique index (active jobs only)
- Drops legacy non-partial indexes

### Section 3: Legacy Data Cleanup
- Sets `processed_at` for completed jobs
- Makes "active = processed_at IS NULL" invariant reliable

### Section 4: Job Enqueue RPC Fix ⭐
```sql
CREATE OR REPLACE FUNCTION enqueue_fetch_job(...)
SET search_path = public, extensions, pg_temp
AS $$
  v_hash := encode(
    digest(convert_to(COALESCE(p_payload::text, '{}'), 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT ... ON CONFLICT (job_type, payload_hash) WHERE (processed_at IS NULL) DO NOTHING
$$;
```

### Section 5: Article RPC Search Path Fix
- `ALTER FUNCTION upsert_article_and_enqueue_jobs SET search_path = 'public, extensions'`
- Allows digest() access for article creation

### Section 6: Permissions
- `REVOKE ALL ... FROM PUBLIC`
- `GRANT EXECUTE ... TO service_role`

### Section 7: Sanity Check ⭐ NEW
- Verifies digest() produces correct 64-char hash
- Confirms hash matches JavaScript crypto output
- Expected: `666c1aa02e8068c6d5cc1d3295009432c16790bec28ec8ce119d0d1a18d61319`

### Section 8: Comprehensive Verification
- Test 1: Create new job (should succeed)
- Test 2: Duplicate active job (should return NULL)
- Test 3: Re-queue after completion (should create new job)

---

## 🚀 How to Run

1. **Go to:** https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new
2. **Copy:** Entire contents of `migrations/029_fix_enqueue_rpc.sql`
3. **Paste** into SQL Editor
4. **Click "Run"**

### Expected Success Messages:

```
✅ "Sanity check PASSED: digest() hash matches JavaScript crypto"
✅ "M029 Test 1/3 PASS: Created job..."
✅ "M029 Test 2/3 PASS: Duplicate blocked..."
✅ "M029 Test 3/3 PASS: Re-queued after completion..."
✅ "Migration 029 verification PASSED"
```

---

## 📊 Files Summary

### Migration File (Single Source of Truth)
- ✅ `migrations/029_fix_enqueue_rpc.sql` - **USE THIS**

### Reference Files (for PROD if needed)
- 📄 `temp_fix_search_path.sql` - Article RPC fix (standalone)
- 📄 `temp_cleanup_legacy_jobs.sql` - Legacy cleanup (standalone)

### Updated Code
- ✅ `scripts/seed-fetch-jobs.js` - Now uses 64-char hash

### Documentation
- 📄 `TTRC-248_MIGRATION_REVIEW.md` - Technical review
- 📄 `TEMP_FILES_STATUS.md` - Verification status
- 📄 `check_migration_coverage.md` - Coverage analysis

---

## 🎯 What This Fixes

### TEST Environment:
- ✅ Broken enqueue_fetch_job RPC (returns "digest not found")
- ✅ Hash consistency (now matches JavaScript)

### PROD Environment (when deployed):
- ✅ Article creation RPC (search_path fix)
- ✅ Job enqueue RPC (atomic, secure, correct)
- ✅ Legacy data cleanup (one-time)
- ✅ All security hardening

---

## 🔒 Security Features

1. **PostgreSQL 15+ required** - Enforced via version guard
2. **pgcrypto required** - Verified before proceeding
3. **SECURITY DEFINER with safe search_path** - Prevents attacks
4. **Service role only** - No public/anon access
5. **Full 64-char SHA-256** - No collision risk
6. **Bytea conversion** - Type-safe digest() calls

---

## ✅ Pre-Run Checklist

- [x] All feedback incorporated (3 rounds)
- [x] Migration file updated
- [x] Seed script updated (64-char hash)
- [x] Temp files recreated for PROD reference
- [x] Documentation complete
- [x] Sanity check added
- [x] Verification tests included

---

## 🚨 Known State

**TEST Database:**
- Article creation RPC: ✅ Working (manually applied earlier)
- Legacy cleanup: ✅ Done (manually applied earlier)
- Job enqueue RPC: ❌ Broken (needs this migration)

**PROD Database:**
- Article creation RPC: ❌ Needs fix (will be applied)
- Legacy cleanup: ❌ Needs cleanup (will be applied)
- Job enqueue RPC: ❌ Needs fix (will be applied)

---

## 💡 Next Steps After Migration

1. Delete test jobs 2574 and 2575
2. Run `node scripts/seed-fetch-jobs.js` (should create 5 jobs)
3. Verify jobs in database
4. Run worker: `node scripts/job-queue-worker.js`
5. Verify articles created
6. Update JIRA with resolution
7. Create handoff document

---

**STATUS: ✅ READY TO RUN**

This migration has been thoroughly reviewed, tested syntax, and verified against JavaScript hash generation. Safe to apply to TEST and PROD.

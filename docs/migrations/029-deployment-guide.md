# Migration 029 Deployment Guide

**Migration:** `029_fix_enqueue_rpc.sql`
**JIRA:** TTRC-248
**Purpose:** Fix RSS job queue RPC - restore frozen RSS pipeline
**Status:** ✅ Verified in TEST, ready for PROD
**Date Created:** November 3, 2025

---

## 🎯 What This Migration Does

Fixes critical issues in `enqueue_fetch_job()` RPC that caused RSS pipeline to freeze:

### Issues Fixed:
1. **SECURITY DEFINER vulnerability** - Unqualified digest() allowed search_path hijacking
2. **Hash instability** - Null values caused spurious deduplication misses
3. **Failed job blocking** - Failed jobs couldn't be retried
4. **Race conditions** - Duplicate active jobs could bypass unique constraint
5. **Type mismatches** - PostgreSQL type errors in constraint cleanup
6. **Silent PROD failures** - Missing prerequisite checks

### Key Changes:
- Replaces broken `enqueue_fetch_job()` RPC with secure, atomic version
- Adds `jsonb_strip_nulls()` for hash stability
- Explicitly qualifies `extensions.digest()` (SECURITY DEFINER hardening)
- Pre-flight deduplication before unique index creation
- PROD safety guard (fails if required index missing)
- Dynamic column detection (schema flexibility)

---

## ⚠️ CRITICAL: Environment-Specific Deployment

**This migration behaves differently in TEST vs PROD:**

| Environment | Index Creation | Verification Tests | Safety Guard |
|-------------|----------------|-------------------|--------------|
| **TEST** | Inside transaction | ✅ Runs | Skipped |
| **PROD** | Must pre-build CONCURRENTLY | Skipped | ✅ Blocks if index missing |

---

## 📋 Pre-Deployment Checklist

### For TEST Environment:
- [ ] Backup current `job_queue` table state
- [ ] Note current `enqueue_fetch_job()` function definition
- [ ] Check for any active jobs: `SELECT COUNT(*) FROM job_queue WHERE processed_at IS NULL`
- [ ] Ready to run migration directly

### For PROD Environment:
- [ ] Backup current `job_queue` table state
- [ ] Note current `enqueue_fetch_job()` function definition
- [ ] Check table size: `SELECT pg_size_pretty(pg_total_relation_size('public.job_queue'))`
- [ ] **CRITICAL:** Build index CONCURRENTLY BEFORE migration (see Step 1 below)
- [ ] Schedule maintenance window (migration takes ~30 seconds for small tables)

---

## 🚀 Deployment Instructions

### TEST Environment Deployment

**Step 1: Run Migration**
1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/[PROJECT_ID]/sql/new
2. Copy entire contents of `migrations/029_fix_enqueue_rpc.sql`
3. Paste into SQL Editor
4. Click **"Run"**

**Step 2: Verify Success**
Look for these messages in output:
```
✅ Legacy cleanup: Updated N jobs
✅ Pre-flight dedupe: Closed N duplicate active jobs
✅ Created partial unique index ux_job_queue_payload_hash_active
✅ Function created
✅ Sanity check PASSED
✅ Test 1/3 PASSED
✅ Test 2/3 PASSED
✅ Test 3/3 PASSED
✅ Migration 029 verification PASSED
```

**Step 3: Test Job Seeding**
```bash
node scripts/seed-fetch-jobs.js
```
Expected output:
```
✅ Created job for: [Feed Name]
...
📊 Summary:
   Created: 5
   Skipped (active): 0
   Failed: 0
```

---

### PROD Environment Deployment

**⚠️ CRITICAL: You MUST complete Step 0 BEFORE running the migration.**

**Step 0: Build Index CONCURRENTLY (REQUIRED - Before Migration)**

Run this FIRST, outside the migration, in a separate SQL query:

```sql
-- This runs non-blocking, safe to run during business hours
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE (processed_at IS NULL);
```

**Estimated time:**
- Small table (<10K rows): 1-5 seconds
- Medium table (10K-100K rows): 10-30 seconds
- Large table (>100K rows): 1-5 minutes

**Wait for completion** - Query will return when done.

**Verify index exists:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'job_queue'
  AND indexname = 'ux_job_queue_payload_hash_active';
```

Should return:
```
indexname: ux_job_queue_payload_hash_active
indexdef: CREATE UNIQUE INDEX ux_job_queue_payload_hash_active ON public.job_queue USING btree (job_type, payload_hash) WHERE (processed_at IS NULL)
```

---

**Step 1: Run Migration**
1. Open Supabase SQL Editor for PROD
2. Copy entire contents of `migrations/029_fix_enqueue_rpc.sql`
3. Paste into SQL Editor
4. Click **"Run"**

**Step 2: Verify Success**
Look for these messages:
```
✅ Legacy cleanup: Updated N jobs
✅ Pre-flight dedupe: Closed N duplicate active jobs
✅ Skipping index create inside tx (PROD). Build CONCURRENTLY beforehand.
✅ Function created
✅ PROD safety check PASSED: Required index exists
✅ Skipping sanity check (not in TEST environment)
✅ Skipping verification tests (not in TEST environment)
```

**If you see this error, you skipped Step 0:**
```
❌ MIGRATION BLOCKED: Required index ux_job_queue_payload_hash_active is missing in PROD.
```
→ Go back to Step 0, build the index, then retry migration.

**Step 3: Test Job Seeding**
```bash
# Use PROD environment variables
SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<prod_key> node scripts/seed-fetch-jobs.js
```

**Step 4: Monitor**
```sql
-- Check jobs are being created
SELECT COUNT(*) FROM job_queue WHERE status = 'pending' AND created_at > NOW() - INTERVAL '5 minutes';

-- Check jobs are being processed
SELECT COUNT(*) FROM job_queue WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '5 minutes';

-- Check for errors
SELECT job_type, last_error, COUNT(*)
FROM job_queue
WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '1 hour'
GROUP BY job_type, last_error;
```

---

## ✅ Expected Output (Complete)

### TEST Environment:
```
NOTICE: PostgreSQL 15+ version check passed
NOTICE: pgcrypto extension confirmed in extensions schema
UPDATE 0  -- (or N if legacy jobs needed cleanup)
NOTICE: Pre-flight dedupe: Closed 0 duplicate active jobs  -- (or N if duplicates found)
NOTICE: Dropped legacy unique constraint: [name]  -- (if any legacy constraints found)
NOTICE: Created partial unique index ux_job_queue_payload_hash_active
NOTICE: Function owner set to postgres
NOTICE: Updated search_path for upsert_article_and_enqueue_jobs  -- (if function exists)
NOTICE: Added hash format constraint (NOT VALID)
NOTICE: TEST environment: Skipping PROD index guard
NOTICE: Sanity check PASSED: digest() hash matches JavaScript crypto (64 chars)
NOTICE: Migration 029: Starting verification tests...
NOTICE: M029 Test 1/3 PASS: Created job [id] with hash [hash]
NOTICE: M029 Test 2/3 PASS: Duplicate blocked (returned NULL as expected)
NOTICE: M029 Test 3/3 PASS: Re-queued after completion (job [new_id] != [old_id])
NOTICE: M029: Cleaned up test jobs
NOTICE: ✅ Migration 029 verification PASSED (created: [id1], re-queued: [id2])
```

### PROD Environment:
```
NOTICE: PostgreSQL 15+ version check passed
NOTICE: pgcrypto extension confirmed in extensions schema
UPDATE N  -- Number of jobs cleaned up
NOTICE: Pre-flight dedupe: Closed N duplicate active jobs
NOTICE: Dropped legacy unique constraint: [name]  -- (if any found)
NOTICE: Skipping index create inside tx (PROD). Build CONCURRENTLY beforehand.
NOTICE: Function owner set to postgres  -- (or "skipped" if insufficient privilege)
NOTICE: Updated search_path for upsert_article_and_enqueue_jobs  -- (or "Skipped" if not present)
NOTICE: Added hash format constraint (NOT VALID)
NOTICE: PROD safety check PASSED: Required index ux_job_queue_payload_hash_active exists
NOTICE: Skipping sanity check (not in TEST environment)
NOTICE: Skipping verification tests (not in TEST environment)
```

---

## 🔍 Post-Deployment Verification

### Immediate Checks (5 minutes after deployment):

**1. Test RPC directly:**
```sql
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  '{"feed_id": 1, "url": "https://test.com/feed", "source_name": "Test Feed"}',
  NULL  -- Let function compute hash
);
```
Should return: Job ID (bigint) or NULL (if duplicate exists)

**2. Check for errors:**
```sql
-- Should return no rows (no recent failures)
SELECT * FROM job_queue
WHERE status = 'failed'
  AND last_error LIKE '%digest%'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

**3. Verify hash format:**
```sql
-- All hashes should be 64 hex characters
SELECT id, job_type,
       length(payload_hash) as hash_length,
       payload_hash ~ '^[0-9a-f]{64}$' as valid_format
FROM job_queue
WHERE created_at > NOW() - INTERVAL '5 minutes'
LIMIT 10;
```
All should show: `hash_length: 64`, `valid_format: true`

---

### Extended Monitoring (24 hours):

**Track job creation rate:**
```sql
SELECT
  date_trunc('hour', created_at) as hour,
  job_type,
  COUNT(*) as jobs_created
FROM job_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

**Track processing rate:**
```sql
SELECT
  date_trunc('hour', completed_at) as hour,
  job_type,
  COUNT(*) as jobs_completed,
  AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
FROM job_queue
WHERE completed_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

**Check for hash collisions (should be zero):**
```sql
SELECT payload_hash, COUNT(*) as collision_count
FROM job_queue
WHERE processed_at IS NULL  -- Active jobs only
GROUP BY payload_hash
HAVING COUNT(*) > 1;
```

---

## 🔄 Rollback Plan

**If migration causes critical issues:**

### Option 1: Restore Function Only (Fastest)
```sql
-- Drop new function
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);

-- Restore from backup (you noted definition in pre-deployment checklist)
-- Run your backed-up CREATE FUNCTION statement here
```

### Option 2: Full Rollback (Nuclear)
```sql
BEGIN;

-- 1. Drop new index
DROP INDEX IF EXISTS public.ux_job_queue_payload_hash_active;

-- 2. Restore old function from backup
-- (Paste your backed-up function definition)

-- 3. Restore old constraint if it existed
-- (Check your pre-deployment notes)

-- 4. Verify
SELECT * FROM public.enqueue_fetch_job('fetch_feed', '{"test": true}', 'rollback_test');

COMMIT;
```

**After Rollback:**
1. Document what went wrong
2. Check Supabase logs for errors
3. Create JIRA ticket for investigation
4. Do NOT retry deployment until issue understood

**Note:** Rollback should NOT be needed - migration tested through 11 review rounds.

---

## 📊 Success Criteria

Migration is successful if:

- [x] No SQL errors during execution
- [x] All NOTICE messages show "PASSED" or "✅"
- [x] `enqueue_fetch_job()` returns job IDs (not NULL for all calls)
- [x] `seed-fetch-jobs.js` creates 5/5 jobs
- [x] Worker processes jobs without "digest not found" errors
- [x] Articles and stories being created in database
- [x] No increase in failed jobs with "digest" errors

---

## 🆘 Troubleshooting

### Error: "MIGRATION BLOCKED: Required index missing"
**Cause:** Skipped Step 0 (CONCURRENTLY index build) in PROD
**Fix:** Run Step 0, then retry migration

### Error: "operator does not exist: name[] = text[]"
**Cause:** Old version of migration file
**Fix:** Get latest version from repo (should have `::name[]` cast)

### Error: "function digest(bytea, unknown) does not exist"
**Cause:** pgcrypto extension not installed
**Fix:** Migration should handle this automatically. Check if extensions schema exists.

### Error: "duplicate key value violates unique constraint"
**Cause:** Pre-flight dedupe didn't run or failed
**Fix:** Check for active duplicate jobs:
```sql
SELECT job_type, payload_hash, COUNT(*), array_agg(id) as job_ids
FROM job_queue
WHERE processed_at IS NULL
GROUP BY job_type, payload_hash
HAVING COUNT(*) > 1;
```
Manually close duplicates, keeping oldest:
```sql
-- For each duplicate group, run:
UPDATE job_queue
SET status = 'failed',
    last_error = 'manual dedupe before migration',
    processed_at = NOW()
WHERE id IN ([newer_ids_from_above]);
```

### RPC returns NULL for all calls after migration
**Cause:** Likely hashes don't match between client and server
**Fix:** Verify seed script updated with `stripNulls()` helper
```bash
git diff scripts/seed-fetch-jobs.js
# Should show stripNulls function added
```

---

## 📞 Support Contacts

**For deployment issues:**
1. Check this guide first
2. Review handoff document: `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md`
3. Check common issues: `docs/common-issues.md` (search "TTRC-248")
4. Create JIRA ticket with logs

**Required information for support:**
- Environment (TEST/PROD)
- Migration output (full text)
- Error message (exact text)
- Current state: `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;`
- Job queue state: `SELECT status, COUNT(*) FROM job_queue GROUP BY status;`

---

## 📁 Related Files

- **Migration SQL:** `migrations/029_fix_enqueue_rpc.sql` (365 lines)
- **Seed Script:** `scripts/seed-fetch-jobs.js` (updated with stripNulls)
- **Session Handoff:** `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md`
- **Common Issues:** `docs/common-issues.md` (TTRC-248 entry)
- **Manual PROD Fixes:** `temp_fix_search_path.sql`, `temp_cleanup_legacy_jobs.sql`

---

## ✅ Deployment Checklist

### Pre-Deployment:
- [ ] Backed up current function definition
- [ ] Noted current job_queue stats
- [ ] (PROD only) Built index CONCURRENTLY
- [ ] Scheduled deployment window
- [ ] Notified team

### During Deployment:
- [ ] Migration ran without errors
- [ ] All verification messages show PASSED
- [ ] (PROD only) PROD safety check passed

### Post-Deployment:
- [ ] Tested RPC directly (returns job IDs)
- [ ] Ran seed script (5/5 jobs created)
- [ ] Worker processing jobs successfully
- [ ] No "digest not found" errors
- [ ] Monitoring dashboard shows normal metrics
- [ ] Updated deployment log

### 24-Hour Follow-Up:
- [ ] Job creation rate normal
- [ ] Job processing rate normal
- [ ] No hash collision warnings
- [ ] No increase in failed jobs
- [ ] RSS articles ingesting normally
- [ ] Closed JIRA ticket

---

**Migration 029 is production-ready. Follow this guide step-by-step for safe deployment.**

_Last Updated: November 3, 2025_
_Tested: ✅ TEST environment verified_
_Ready: ✅ PROD deployment_

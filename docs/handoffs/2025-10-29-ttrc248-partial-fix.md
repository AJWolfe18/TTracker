# TTRC-248: RSS Pipeline Fix - Session Handoff

**Date:** 2025-10-30 @ 00:40 UTC
**Session Duration:** ~2 hours
**Status:** 🟡 Partial Fix - Article Creation Working, Job Seeding Blocked
**Next Session:** Investigate partial unique index behavior

---

## 🎯 What Was Fixed

### ✅ Fix #1: Article Creation RPC (WORKING)
**File:** `temp_fix_search_path.sql` (already applied)

**Problem:** `upsert_article_and_enqueue_jobs()` RPC couldn't find `digest()` function
**Root Cause:** RPC set `search_path = 'public'` but `pgcrypto` extension is in `extensions` schema
**Solution:** Changed to `search_path = 'public, extensions'`

**Verified Working:**
```javascript
// Test article created successfully
Article ID: art-6ffed13d-e7da-4945-b3e1-92668ae5d57d
Created: 2025-10-30T00:30:29.184681+00:00
```

### ✅ Fix #2: Job Enqueue RPC (APPLIED)
**File:** `temp_fix_enqueue_fetch_job.sql` (already applied)

**Problem:** `enqueue_fetch_job()` failed silently using `ON CONFLICT ON CONSTRAINT` with an INDEX
**Root Cause:** Migration 013 line 34 references `ux_job_queue_payload_hash_active` as CONSTRAINT but it's an INDEX
**Solution:** Rewrote to use manual SELECT check instead of ON CONFLICT

### ✅ Fix #3: Legacy Job Cleanup (APPLIED)
**File:** `temp_cleanup_legacy_jobs.sql` (already applied)

**Problem:** Old jobs (pre-Oct 20) had `processed_at = NULL` blocking new job creation
**Solution:** Set `processed_at` for all old completed/failed jobs

---

## 🚧 What's Still Broken

### ❌ Issue: RSS Job Seeding Returns NULL

**Symptom:**
```bash
node scripts/seed-fetch-jobs.js
# Output: "Job already active" for all 5 feeds
# But NO jobs with processed_at = NULL exist!
```

**Evidence:**
1. Direct RPC call with feed 1 hash returns `NULL`
2. Query shows only 1 job with that hash, `processed_at` IS NOT NULL
3. Partial unique index SHOULD allow insert (WHERE clause excludes this row)
4. Yet RPC's exception handler catches `unique_violation`

**Hypothesis:**
The partial unique index `ux_job_queue_payload_hash_active` may not be defined correctly in the database, OR there's another constraint/index blocking inserts.

**Next Step:**
```sql
-- Run this to see actual index definition:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'job_queue'
  AND indexname LIKE '%payload_hash%';
```

Expected definition:
```sql
CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;
```

If definition is wrong, need to recreate the index.

---

## 📊 Current State

### Database
- ✅ `pgcrypto` extension enabled (version 1.3, extensions schema)
- ✅ Article creation working (test article exists)
- ✅ Legacy jobs cleaned up (all have `processed_at` set)
- ❌ Can't create new fetch_feed jobs (returns NULL silently)

### Test Results
| Test | Status | Details |
|------|--------|---------|
| `upsert_article_and_enqueue_jobs` RPC | ✅ PASS | Created article art-6ffed13d... |
| Direct `job_queue` INSERT | ✅ PASS | Created job 2574, 2575 |
| `enqueue_fetch_job` with unique hash | ✅ PASS | Created job 2575 |
| `enqueue_fetch_job` with existing hash | ❌ FAIL | Returns NULL (unique violation) |
| Full RSS E2E test | ❌ FAIL | No runnable jobs after seeding |

### Jobs in Database
```
Recent jobs (processed):
- 2532-2536: From Oct 29 test (3 done, 2 failed, all processed_at set)
- 2574: Direct insert test (pending, unique hash)
- 2575: RPC test (pending, unique hash)

No jobs with processed_at = NULL blocking creation
```

---

## 🔍 Investigation Trail

### What I Tried

1. **Verified pgcrypto existence** ✅
   - Extension IS installed in `extensions` schema
   - But RPC couldn't find it (search_path issue)

2. **Fixed article creation RPC** ✅
   - Updated search_path to include `extensions`
   - Tested and confirmed working

3. **Fixed job enqueue RPC** ✅
   - Replaced broken ON CONFLICT syntax
   - Manual duplicate check works for unique hashes

4. **Cleaned up legacy jobs** ✅
   - Set processed_at for old jobs
   - Verified 0 blocking jobs remain

5. **Tested job seeding** ❌
   - Still returns NULL for standard feed hashes
   - Works for unique test hashes
   - Suggests constraint/index issue

6. **Traced RPC execution** ❌
   - Confirmed no jobs with processed_at = NULL
   - Confirmed INSERT catches unique_violation
   - Index definition needs verification

---

## 📁 Files Created

### Applied Fixes (already run in Supabase)
1. `temp_fix_search_path.sql` - Fixed article creation RPC
2. `temp_fix_enqueue_fetch_job.sql` - Fixed job enqueue RPC
3. `temp_cleanup_legacy_jobs.sql` - Cleaned up legacy jobs

### Diagnostic Scripts (for investigation)
4. `temp_check_index.sql` - Check index definition (NOT RUN YET)
5. `temp_enable_pgcrypto.sql` - Original fix attempt (not needed)
6. `TTRC-248_FINDINGS.md` - Initial investigation summary (outdated)

### Test Scripts (in project root)
7. `test_enqueue.js` - Test enqueue RPC
8. `debug_enqueue.js` - Debug RPC matching
9. `check_insert.js` - Test direct insert
10. `test_rpc_detailed.js` - Test with unique hash
11. `check_hashes.js` - Show expected hashes
12. `check_constraints.js` - Attempt to check constraints
13. `trace_rpc.js` - Trace RPC execution

---

## 🎯 Next Session Tasks

### Immediate (5 minutes)
1. ✅ Run `temp_check_index.sql` to see actual index definition
2. 📝 Compare with expected definition from migration 013
3. 🔧 If wrong, recreate index with correct WHERE clause

### If Index is Correct (15 minutes)
4. 🔍 Check for other unique constraints/indexes on `(job_type, payload_hash)`
5. 🔍 Check if there's a trigger preventing inserts
6. 🔍 Enable PostgreSQL query logging to see actual error

### Alternative Approach (30 minutes)
7. 🔄 Modify `enqueue_fetch_job` to use time-based hashes instead of stable hashes
   - Pro: Allows re-queuing same feed
   - Con: Loses idempotency protection
8. 🔄 OR: Change WHERE clause to `processed_at IS NULL AND status = 'pending'`
   - May allow completed jobs to be re-queued

---

## 🎉 Success Metrics

### What's Working Now
- ✅ Manual article creation via RPC
- ✅ Article enrichment jobs (worker processed embedding)
- ✅ Direct job_queue inserts
- ✅ Job enqueue with unique hashes

### What Needs to Work
- ❌ RSS job seeding with standard feed hashes
- ❌ Full RSS pipeline end-to-end
- ❌ Automated 2-hour cron job

---

## 💡 Key Learnings

1. **PostgreSQL search_path matters** - SECURITY DEFINER functions need explicit schema paths
2. **Indexes ≠ Constraints** - `ON CONFLICT ON CONSTRAINT` doesn't work with unique indexes
3. **Partial unique indexes are tricky** - WHERE clause must match actual query patterns
4. **Legacy data causes issues** - Old jobs with NULL fields block new operations

---

## 📞 Questions for Next Session

1. **Is the partial unique index defined correctly?**
   - Run `temp_check_index.sql` to verify

2. **Should we allow re-queuing completed jobs?**
   - Current design: One active job per feed at a time
   - Alternative: Allow new job after previous is processed

3. **Do we need idempotency protection?**
   - If yes: Fix the partial unique index
   - If no: Remove hash-based deduplication entirely

---

## 🚀 Quick Start for Next Session

```bash
# 1. Check index definition
# Run temp_check_index.sql in Supabase SQL Editor

# 2. If index looks wrong, fix it
# (Will create migration once we understand the issue)

# 3. Test job seeding
cd /path/to/TTracker
node scripts/seed-fetch-jobs.js

# 4. If jobs created, run worker
node scripts/job-queue-worker.js

# 5. Verify articles created
# Check articles table for new entries
```

---

## 📈 Estimated Remaining Work

- **Index investigation:** 5-15 minutes
- **Index fix (if needed):** 10 minutes
- **Full pipeline test:** 10 minutes
- **JIRA update:** 5 minutes
- **Total:** 30-40 minutes to complete TTRC-248

---

## 🔗 Related Issues

- **TTRC-250:** Add new RSS feeds (blocked by TTRC-248)
- **TTRC-249:** Health dashboard UI (blocked by TTRC-248)
- **Migration 029:** May need to address index definition

---

**Token Usage:** ~92K tokens used this session
**Files Modified:** 3 SQL fixes applied, 13 test scripts created
**Database Changes:** 2 RPC functions updated, 1 cleanup run

**Ready for handoff** ✅

# Next Session: Start Here

**Last Session:** November 3, 2025
**Completed:** TTRC-248 - Migration 029 deployed to TEST
**Status:** ✅ RSS pipeline operational in TEST
**Next:** Run test suite, verify stability, prepare for PROD

---

## 🎯 What We Accomplished Last Session

Fixed RSS pipeline freeze (18 days frozen) by deploying Migration 029:
- ✅ Fixed 6 critical issues in job queue RPC
- ✅ Deployed to TEST successfully
- ✅ Verified working end-to-end (5/5 feeds, articles created, stories clustered)
- ✅ All documentation complete
- ✅ JIRA updated to "Ready for Test"

**Files created:**
- `migrations/029_fix_enqueue_rpc.sql` (365 lines, production-hardened)
- `docs/migrations/029-deployment-guide.md` (PROD deployment instructions)
- `docs/migrations/029-test-verification.md` (5-minute test suite)
- `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md` (complete session recap)

---

## 🧪 Step 1: Run Test Suite (5 minutes)

**Purpose:** Confirm migration is still working after time has passed.

### Open Test Guide:
📄 `docs/migrations/029-test-verification.md`

### Quick Test (10 seconds):
```bash
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
node scripts/seed-fetch-jobs.js
```

**✅ Expected:**
```
✅ Created job for: AP News US
✅ Created job for: Politico Top
✅ Created job for: NYT Politics
✅ Created job for: WaPo Politics
✅ Created job for: Reuters Politics

📊 Summary:
   Created: 5
   Skipped (active): 0
   Failed: 0
```

**❌ If you see "Skipped: 5" or "Failed: N":**
- Stop here
- Tell Claude: "Test suite failed - [paste the error]"
- We'll investigate before proceeding

---

## 🔍 Step 2: Full Verification (5 minutes)

**If quick test passed, run full suite:**

### Test 1: Direct RPC Call
Open Supabase SQL Editor: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new

```sql
-- Create test job
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  '{"test": true, "feed_id": 999}',
  NULL
) AS job_id;

-- Try duplicate (should return NULL)
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  '{"test": true, "feed_id": 999}',
  NULL
) AS should_be_null;

-- Check hash format
SELECT id, length(payload_hash) as hash_len
FROM job_queue
WHERE payload->>'feed_id' = '999'
ORDER BY id DESC LIMIT 1;

-- Cleanup
DELETE FROM job_queue WHERE payload->>'feed_id' = '999';
```

**✅ Expected:**
- `job_id`: Some number
- `should_be_null`: NULL
- `hash_len`: 64

---

### Test 2: Worker Processing
```bash
# Run worker for 60 seconds
timeout 60 node scripts/job-queue-worker.js
```

**✅ Look for:**
- Jobs being claimed and processed
- No "digest not found" errors
- Articles being created

**Stop worker with Ctrl+C after 60 seconds.**

---

### Test 3: Check Database Health
**In Supabase SQL Editor:**
```sql
SELECT
  'Jobs (pending)' as metric,
  COUNT(*)::text as value
FROM job_queue
WHERE status = 'pending'

UNION ALL

SELECT 'Articles (last hour)', COUNT(*)::text
FROM articles
WHERE created_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 'Stories (last 24h)', COUNT(*)::text
FROM stories
WHERE first_seen_at > NOW() - INTERVAL '24 hours';
```

**✅ Expected:**
- Jobs (pending): 0-10
- Articles (last hour): > 0
- Stories (last 24h): > 0

---

## ✅ Step 3: If All Tests Pass

**Tell Claude:**
> "All tests passed! Ready to proceed with PROD deployment planning."

**Then we'll:**
1. Review PROD deployment guide together
2. Schedule PROD deployment window
3. Create pre-deployment checklist
4. Walk through PROD deployment step-by-step

---

## ❌ Step 4: If Any Test Fails

**Tell Claude:**
> "Test [number] failed with error: [paste error message]"

**Include:**
- Which test failed (1, 2, or 3)
- Exact error message or unexpected output
- Screenshots if helpful

**We'll investigate and fix before proceeding to PROD.**

---

## 📋 Decision Point: What's Next?

### Option A: Tests Pass → PROD Deployment
**Timeline:** Can deploy anytime (takes 30 minutes)

**Prerequisites for PROD:**
1. Build index CONCURRENTLY (5 minutes, non-blocking)
2. Run Migration 029 (30 seconds)
3. Verify with test suite (5 minutes)
4. Monitor for 24 hours

**Full guide:** `docs/migrations/029-deployment-guide.md`

---

### Option B: Tests Pass → Monitor TEST First
**Timeline:** Wait 24-48 hours, monitor TEST stability

**Monitoring queries:**
```sql
-- Check for errors
SELECT job_type, last_error, COUNT(*)
FROM job_queue
WHERE status = 'failed'
  AND last_error LIKE '%digest%'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY job_type, last_error;

-- Check processing rate
SELECT
  date_trunc('hour', created_at) as hour,
  job_type,
  COUNT(*) as jobs_created
FROM job_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC;
```

**Tell Claude:**
> "Tests pass. I want to monitor TEST for 24 hours before PROD deployment."

---

### Option C: Tests Fail → Debug
**Tell Claude the error, we'll investigate together.**

---

## 🚀 PROD Deployment Preview (When Ready)

**Step 1: Pre-Migration (5 minutes)**
```sql
-- In PROD Supabase SQL Editor
-- This is NON-BLOCKING, safe to run anytime
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE (processed_at IS NULL);
```

**Step 2: Migration (30 seconds)**
- Copy `migrations/029_fix_enqueue_rpc.sql`
- Paste into PROD Supabase SQL Editor
- Click Run
- Migration will BLOCK if index missing (safe guard)

**Step 3: Verification (5 minutes)**
- Run test suite in PROD
- Verify RSS pipeline operational

**Step 4: Monitor (24 hours)**
- Watch for errors
- Verify article creation rate
- Check feed health

**Complete guide with rollback plan:** `docs/migrations/029-deployment-guide.md`

---

## 📁 Documents You'll Need

**For Testing:**
- 📄 `docs/migrations/029-test-verification.md` - Test suite

**For PROD Deployment:**
- 📄 `docs/migrations/029-deployment-guide.md` - Step-by-step PROD deployment
- 📄 `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md` - Complete context

**For Understanding:**
- 📄 `docs/common-issues.md` - Search "TTRC-248" for debugging trail

---

## 💬 Example Session Start

**You say:**
> "Starting next session. Running test suite from NEXT_SESSION_START_HERE.md"

**Claude responds:**
> "Great! Let's verify the migration is still working. Please run: `node scripts/seed-fetch-jobs.js` and paste the output."

**You paste output, Claude analyzes:**

**If tests pass:**
> "✅ All tests passing! Migration stable. Ready to discuss PROD deployment. Would you like to:
> A) Deploy to PROD now (takes 30 min)
> B) Monitor TEST for 24 hours first
> C) Review deployment guide together"

**If tests fail:**
> "❌ Test failed with [specific error]. Let me investigate. Please also run this query: [diagnostic query]"

---

## 🎓 Key Context for Claude

**When you start next session, tell Claude:**

> "Continuing TTRC-248. Migration 029 deployed to TEST last session. Running test suite to verify stability before PROD deployment. [paste test results]"

**Claude will have context from:**
- Handoff document: `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md`
- Common issues entry: "Job Queue RPC Returns NULL"
- This guide

---

## ⚠️ Important Reminders

### For TEST:
- ✅ Migration already deployed
- ✅ RSS pipeline operational
- ✅ Just need to verify stability

### For PROD:
- ⏸️ Not deployed yet
- ⚠️ MUST build index CONCURRENTLY first
- ⏸️ Waiting for test verification + your go-ahead

### Environment:
- Current branch: `test`
- Working directory: `C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker`
- Database: Supabase TEST

---

## 🔄 Quick Reference Commands

```bash
# Run quick test
node scripts/seed-fetch-jobs.js

# Run worker (Ctrl+C to stop)
node scripts/job-queue-worker.js

# Check git status
git status

# View recent articles
# (Use Supabase SQL Editor)
SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## ✅ Success Criteria

**Before PROD deployment:**
- [ ] Quick test passes (5/5 jobs created)
- [ ] RPC test passes (job IDs returned, deduplication works)
- [ ] Worker test passes (jobs processed, articles created)
- [ ] No "digest not found" errors
- [ ] Database health check shows activity

**After PROD deployment:**
- [ ] All TEST success criteria met in PROD
- [ ] No increase in failed jobs
- [ ] RSS articles ingesting normally
- [ ] 24-hour monitoring shows stability

---

## 📞 Quick Links

- **TEST Supabase:** https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu
- **JIRA Ticket:** https://ajwolfe37.atlassian.net/browse/TTRC-248
- **Migration File:** `migrations/029_fix_enqueue_rpc.sql`
- **Test Guide:** `docs/migrations/029-test-verification.md`
- **Deployment Guide:** `docs/migrations/029-deployment-guide.md`

---

## 🎯 Bottom Line

**Start here:**
1. Run `node scripts/seed-fetch-jobs.js`
2. Paste output to Claude
3. Claude will guide you through next steps based on results

**Expected time to PROD (if tests pass):**
- Tests: 5 minutes
- PROD deployment: 30 minutes
- Total: 35 minutes

**Ready? Start with the quick test and tell Claude the results!**

---

_Created: November 3, 2025_
_Last Updated: November 3, 2025_
_Next Session: Run test suite, decide on PROD timing_

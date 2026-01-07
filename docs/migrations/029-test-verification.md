# Migration 029 - Test Verification Guide

**Quick 5-Minute Test to Confirm Everything Works**

---

## ✅ What We're Testing

Migration 029 fixed the broken `enqueue_fetch_job()` RPC that was causing RSS pipeline freeze. This guide confirms the fix is working.

---

## 🧪 Test 1: Direct RPC Call (30 seconds)

**This tests if the core fix is working.**

### Open Supabase SQL Editor:
https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new

### Run this query:
```sql
-- Test 1: Create a new job
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  '{"test": true, "feed_id": 999, "url": "https://test.com/feed"}',
  NULL  -- Let function compute hash
) AS job_id_1;

-- Test 2: Try to create duplicate (should return NULL)
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  '{"test": true, "feed_id": 999, "url": "https://test.com/feed"}',
  NULL
) AS job_id_2_should_be_null;

-- Test 3: Check the jobs were created correctly
SELECT id, job_type, status,
       length(payload_hash) as hash_length,
       payload_hash ~ '^[0-9a-f]{64}$' as valid_hash_format
FROM job_queue
WHERE payload->>'feed_id' = '999'
ORDER BY id DESC
LIMIT 2;
```

### ✅ Expected Results:
```
job_id_1: [some number like 2593]
job_id_2_should_be_null: NULL

Third query shows:
- 1 row returned (not 2)
- hash_length: 64
- valid_hash_format: true
```

### ❌ If This Fails:
- `job_id_1` is NULL → RPC still broken, migration didn't apply correctly
- `job_id_2_should_be_null` is a number → Deduplication not working
- `hash_length` is 32 → Using old broken hash logic

**Cleanup test data:**
```sql
DELETE FROM job_queue WHERE payload->>'feed_id' = '999';
```

---

## 🧪 Test 2: Seed Script (1 minute)

**This tests the client/server hash consistency fix.**

### Run in terminal:
```bash
node scripts/seed-fetch-jobs.js
```

### ✅ Expected Output:
```
📋 Creating RSS fetch jobs (atomic mode)...

Runnable jobs before seeding: 0

Found 5 active feeds

✅ Created job for: AP News US
✅ Created job for: Politico Top
✅ Created job for: NYT Politics
✅ Created job for: WaPo Politics
✅ Created job for: Reuters Politics

📊 Summary:
   Created: 5
   Skipped (active): 0
   Failed: 0

✅ 5 fetch_feed jobs ready to run
```

### ❌ If This Fails:
- "Skipped (active): 5" → Hash mismatch between client/server
- "Failed: N" → RPC error, check error message
- Script crashes → Missing environment variables

**Cleanup test data (optional):**
```sql
DELETE FROM job_queue
WHERE job_type = 'fetch_feed'
  AND status = 'pending'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

---

## 🧪 Test 3: End-to-End Pipeline (2 minutes)

**This tests the complete RSS pipeline from job → worker → articles.**

### Step 1: Run the worker
```bash
# In terminal, run for 60 seconds then Ctrl+C
timeout 60 node scripts/job-queue-worker.js
```

### Step 2: Check for success indicators in output
Look for:
```
✅ Claimed job [number] - fetch_feed
✅ Claimed job [number] - process_article
✅ Claimed job [number] - story.cluster
✅ Claimed job [number] - article.enrich
{"timestamp":"...","level":"INFO","message":"Job completed successfully","job_id":...}
```

### Step 3: Verify articles created
**In Supabase SQL Editor:**
```sql
-- Should show new articles from last 5 minutes
SELECT COUNT(*) as new_articles
FROM articles
WHERE created_at > NOW() - INTERVAL '5 minutes';

-- Should be > 0 if worker processed any feeds
```

### ✅ Expected Results:
- Worker claims and processes jobs without errors
- No "digest not found" errors in logs
- `new_articles` > 0 (at least a few)
- Stories table has new entries

### ❌ If This Fails:
- "digest not found" error → RPC not using fixed version
- Worker crashes → Check error message
- No articles created → Feeds may be down (check feed_registry.failure_count)

---

## 📊 Quick Health Check Query

**Run this to see overall system health:**

```sql
SELECT
  'Jobs (pending)' as metric,
  COUNT(*)::text as value
FROM job_queue
WHERE status = 'pending'

UNION ALL

SELECT
  'Jobs (last hour)',
  COUNT(*)::text
FROM job_queue
WHERE created_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT
  'Articles (last hour)',
  COUNT(*)::text
FROM articles
WHERE created_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT
  'Stories (last 24h)',
  COUNT(*)::text
FROM stories
WHERE first_seen_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT
  'Active feeds',
  COUNT(*)::text
FROM feed_registry
WHERE is_active = true AND failure_count < 5;
```

### ✅ Healthy System:
```
Jobs (pending): 0-10
Jobs (last hour): > 0
Articles (last hour): > 0
Stories (last 24h): > 0
Active feeds: 5
```

---

## 🎯 Pass/Fail Criteria

### ✅ All Tests Pass = Migration Working
- [x] Test 1: RPC returns job IDs, deduplication works, hashes are 64 chars
- [x] Test 2: Seed script creates 5/5 jobs
- [x] Test 3: Worker processes jobs, articles created

→ **Migration successful, system operational**

### ❌ Any Test Fails = Need Investigation
- Test 1 fails → Core RPC broken, check Supabase logs
- Test 2 fails → Hash mismatch, check seed script has `stripNulls()`
- Test 3 fails → Worker issue or feed problems, check error logs

---

## 🆘 Troubleshooting

### "Job returns NULL for all calls"
**Cause:** Active duplicates still exist
**Fix:**
```sql
-- Find duplicates
SELECT job_type, payload_hash, COUNT(*), array_agg(id) as job_ids
FROM job_queue
WHERE processed_at IS NULL
GROUP BY job_type, payload_hash
HAVING COUNT(*) > 1;

-- Delete newer duplicates (keep oldest)
DELETE FROM job_queue WHERE id IN ([newer_ids_from_above]);
```

### "Worker shows 'digest not found' error"
**Cause:** Migration didn't apply correctly
**Fix:** Re-run migration or check Supabase deployment logs

### "Seed script creates 0/5 jobs"
**Cause:** All jobs already exist (from previous test)
**Fix:**
```sql
-- Clear pending fetch jobs
DELETE FROM job_queue
WHERE job_type = 'fetch_feed'
  AND status = 'pending';

-- Retry seed script
```

### "No articles being created"
**Cause:** Feeds may be down or rate-limited
**Fix:**
```sql
-- Check feed health
SELECT feed_name, failure_count, last_fetched_at, is_active
FROM feed_registry
ORDER BY failure_count DESC;

-- If failure_count = 5+, feed is auto-disabled
-- Reset with: UPDATE feed_registry SET failure_count = 0 WHERE id = [feed_id];
```

---

## ✅ Quick Verification (10 seconds)

**Just want to confirm it's working?**

```bash
# Run this one command
node scripts/seed-fetch-jobs.js && echo "✅ PASS: Migration working"
```

If you see:
```
✅ Created job for: [5 feeds]
✅ PASS: Migration working
```

→ **You're good! Migration is working.**

---

## 📞 Next Steps After Verification

1. **If all tests pass:**
   - Mark TTRC-248 as verified in JIRA
   - Schedule PROD deployment (follow `029-deployment-guide.md`)
   - Monitor for 24 hours

2. **If any test fails:**
   - Check Supabase logs: Settings → Database → Logs
   - Review error messages
   - Check handoff document: `docs/handoffs/2025-11-03-ttrc248-rss-pipeline-fix.md`
   - Create support ticket with test results

---

**Test created:** November 3, 2025
**Estimated time:** 5 minutes
**Prerequisites:** Migration 029 deployed to TEST

**Any questions? Check `docs/migrations/029-deployment-guide.md` for full context.**

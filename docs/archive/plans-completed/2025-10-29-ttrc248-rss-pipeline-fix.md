# TTRC-248: Fix RSS Pipeline Not Running

**Date:** 2025-10-29
**JIRA:** TTRC-248
**Status:** ✅ ROOT CAUSE CONFIRMED - Fix Ready to Apply
**Environment:** TEST (then PROD)
**Priority:** HIGH (blocking feed expansion)
**Last Update:** 2025-10-29 @ 23:30 UTC - pgcrypto missing confirmed via test

---

## 🎯 ROOT CAUSE IDENTIFIED

**Problem:** `pgcrypto` extension not enabled in TEST database

**Error:** `function digest(text, unknown) does not exist`

**Impact:** ALL article inserts fail because `attach_or_create_article()` RPC uses `digest()` function for URL hashing

**Evidence:** GitHub Actions logs show every article failing with same error during RSS E2E test (run #18924911116)

---

## ⚡ QUICK FIX (1 minute)

### Step 1: Enable pgcrypto Extension in TEST

**Option A: Run SQL file (recommended)**

A ready-to-use SQL file is available at: `temp_enable_pgcrypto.sql`

1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new
2. Copy contents of `temp_enable_pgcrypto.sql`
3. Click "Run"
4. Verify output shows pgcrypto enabled and test hash generated

**Option B: Quick SQL command**

Run in Supabase TEST SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Verify:**
```sql
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';
```

**Expected:** 1 row returned

### Step 2: Test RSS Pipeline

**Trigger GitHub Actions workflow manually:**
```bash
gh workflow run rss-e2e-test.yml
```

**Or run locally:**
```bash
node scripts/seed-fetch-jobs.js
node scripts/run-worker.js
```

**Expected Results:**
- Articles created successfully
- No "function digest" errors
- E2E test passes

### Step 3: Enable in PROD (When Ready)

**Run in Supabase PROD SQL Editor:**
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

---

## PROBLEM STATEMENT (Original)

RSS fetch pipeline has been frozen since October 16, 2025 (13 days ago). No new articles are being ingested from any of the 5 active feeds.

**Evidence:**
- Last articles: All feeds stopped at 2025-10-16
- Fetch jobs (24h): 0 jobs found
- E2E test result: FAILED - "Pipeline appears stuck"
- Health dashboard: `articles_24h = 0` for all feeds

---

## ROOT CAUSE ANALYSIS PLAN

### Phase 1: Understand the Pipeline Architecture

**Components to investigate:**
1. **GitHub Actions** - Scheduled cron job (every 2 hours)
2. **Supabase Edge Function** - `rss-enqueue` endpoint
3. **Job Queue** - Jobs created, claimed, processed
4. **Job Queue Worker** - Node.js script that processes jobs
5. **Feed Registry** - Active feeds configuration

**Data flow:**
```
GitHub Actions (cron)
  ↓ HTTP POST
Edge Function (rss-enqueue)
  ↓ Creates jobs in job_queue
Job Queue Worker (scripts/job-queue-worker.js)
  ↓ Claims and processes jobs
Articles Created
```

### Phase 2: Check Each Component

#### 2.1 GitHub Actions Investigation

**Check 1: Is the workflow file present?**
```bash
ls -la .github/workflows/ | grep -i rss
```

**Check 2: Is it enabled?**
- Go to GitHub → Actions tab
- Look for RSS-related workflows
- Check if they're disabled

**Check 3: When did it last run?**
- Check workflow run history
- Look for failures or skipped runs

**Check 4: Review workflow configuration**
```bash
cat .github/workflows/*rss*.yml
```
- Verify cron schedule
- Check if targeting correct branch
- Verify secrets are configured

#### 2.2 Edge Function Investigation

**Check 1: Is `rss-enqueue` deployed?**
```bash
supabase functions list
```

**Check 2: Test it manually:**
```bash
curl -X POST "$SUPABASE_URL/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer $EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

**Check 3: Review Edge Function logs:**
- Supabase Dashboard → Edge Functions → Logs
- Look for errors, timeouts, or missing invocations

**Check 4: Verify environment variables:**
- `EDGE_CRON_TOKEN` set correctly?
- `SUPABASE_URL` pointing to TEST?

#### 2.3 Job Queue Investigation

**Check 1: Are jobs being created at all?**
```sql
SELECT job_type, status, COUNT(*), MAX(created_at) as last_created
FROM public.job_queue
WHERE created_at >= '2025-10-16'
GROUP BY job_type, status
ORDER BY last_created DESC;
```

**Check 2: Are there stuck/stale jobs?**
```sql
SELECT id, job_type, status, created_at, claimed_at, processed_at
FROM public.job_queue
WHERE status = 'claimed'
  AND claimed_at < NOW() - INTERVAL '1 hour'
ORDER BY claimed_at;
```

**Check 3: Check for failed jobs:**
```sql
SELECT job_type, payload, error, created_at
FROM public.job_queue
WHERE status = 'failed'
  AND created_at >= '2025-10-16'
ORDER BY created_at DESC
LIMIT 10;
```

#### 2.4 Job Queue Worker Investigation

**Check 1: Is the worker configured to run?**
```bash
cat scripts/job-queue-worker.js | head -50
```

**Check 2: Try running it manually:**
```bash
node scripts/job-queue-worker.js
```

**Check 3: Check for process errors:**
- Does it connect to Supabase?
- Does it claim jobs?
- Does it process jobs successfully?

#### 2.5 Feed Registry Investigation

**Check 1: Are feeds active?**
```sql
SELECT id, feed_name, url, is_active, failure_count
FROM public.feed_registry
ORDER BY id;
```

**Check 2: Are any feeds disabled?**
```sql
SELECT COUNT(*) as inactive_count
FROM public.feed_registry
WHERE is_active = false;
```

---

## LIKELY SCENARIOS & FIXES

### Scenario 1: GitHub Actions Not Running (Most Likely)

**Symptoms:**
- No jobs created since Oct 16
- Workflow history shows no runs or disabled

**Possible Causes:**
- Workflow disabled in GitHub
- Cron schedule targeting wrong branch (e.g., only runs on `main`)
- GitHub Actions minutes exhausted
- Workflow file syntax error

**Fix:**
1. Enable workflow in GitHub Actions settings
2. Update workflow to run on `test` branch
3. Trigger manual run to test
4. Verify cron schedule is correct

### Scenario 2: Edge Function Not Deployed or Failing

**Symptoms:**
- GitHub Actions running but failing
- No jobs created
- Edge Function logs show errors

**Possible Causes:**
- Edge Function not deployed to TEST
- Environment variables missing
- Function crashing on startup
- Authentication token invalid

**Fix:**
1. Deploy Edge Function: `supabase functions deploy rss-enqueue`
2. Set environment variables
3. Test with manual curl
4. Check logs for detailed error

### Scenario 3: Job Queue Worker Not Running

**Symptoms:**
- Jobs created but status = 'pending'
- No jobs being claimed or processed
- Worker not configured or deployed

**Possible Causes:**
- Worker script not running anywhere
- No scheduled task/cron for worker
- Worker deployment target unclear (local? server? GitHub Actions?)

**Fix:**
1. Clarify where worker should run (Josh to confirm)
2. Set up worker execution environment
3. Configure as cron job or continuous process
4. Test by creating a job manually

### Scenario 4: TEST Environment Issues

**Symptoms:**
- All components seem correct
- Jobs created but immediately fail
- Database connection issues

**Possible Causes:**
- TEST Supabase project paused/suspended
- Network/firewall blocking requests
- Database permissions changed

**Fix:**
1. Verify TEST Supabase project active
2. Check database connection from local
3. Verify RLS policies not blocking
4. Test with simple query

---

## EXECUTION PLAN

### Step 1: Quick Diagnosis (5 minutes)

Run these queries to understand the state:

```sql
-- 1. Last job created?
SELECT job_type, status, created_at, processed_at
FROM public.job_queue
ORDER BY created_at DESC
LIMIT 5;

-- 2. Any recent RSS fetch jobs?
SELECT COUNT(*) as total, status
FROM public.job_queue
WHERE job_type LIKE '%fetch%'
  AND created_at >= '2025-10-01'
GROUP BY status;

-- 3. Active feeds?
SELECT COUNT(*) as active_feeds
FROM public.feed_registry
WHERE is_active = true;
```

### Step 2: Component-by-Component Check (15 minutes)

1. **GitHub Actions** (5 min)
   - Check workflow file exists
   - Check run history
   - Check if disabled
   - Review workflow configuration

2. **Edge Function** (5 min)
   - Test manual curl
   - Check deployment status
   - Review logs

3. **Job Queue** (5 min)
   - Check for pending jobs
   - Check for failed jobs
   - Test RPC functions manually

### Step 3: Root Cause Identification (10 minutes)

Based on findings, identify which component is broken.

### Step 4: Implement Fix (Variable)

Apply fix based on root cause (see scenarios above).

### Step 5: Verification (10 minutes)

```sql
-- 1. Manually trigger RSS fetch
-- (via GitHub Actions manual dispatch or Edge Function curl)

-- 2. Wait 2-3 minutes, then check for new jobs
SELECT * FROM public.job_queue
WHERE created_at >= NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;

-- 3. Wait for job processing, check for new articles
SELECT * FROM public.articles
WHERE created_at >= NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;

-- 4. Check health dashboard
SELECT * FROM admin.feed_health_overview
ORDER BY feed_id;
```

### Step 6: Monitor (24 hours)

- Check health dashboard every 2 hours
- Verify articles_24h > 0 for active feeds
- Confirm pipeline running automatically

---

## SUCCESS CRITERIA

- [ ] Root cause identified
- [ ] Fix applied and tested
- [ ] New articles appearing in database
- [ ] `articles_24h > 0` for at least 3 active feeds
- [ ] Health dashboard showing HEALTHY status
- [ ] Pipeline running automatically every 2 hours
- [ ] No errors in Edge Function logs
- [ ] Job queue processing jobs successfully

---

## RISKS

**LOW RISK:**
- Investigation is read-only
- Fixes are configuration changes (GitHub Actions, Edge Function deployment)
- No database schema changes required

**POTENTIAL ISSUES:**
- Worker deployment location unclear (need Josh confirmation)
- May need to configure new cron job
- Edge Function deployment may require Supabase CLI setup

---

## QUESTIONS FOR JOSH

1. **Where should the job queue worker run?**
   - Locally on your machine?
   - As a GitHub Action?
   - On a server?
   - Other deployment target?

2. **Is there a specific reason feeds stopped on Oct 16?**
   - Any configuration changes?
   - Any Supabase project changes?
   - Any GitHub settings changes?

3. **Do you want to fix TEST first, or go straight to PROD?**
   - Fix TEST, verify, then PROD
   - Or fix both simultaneously

---

## NEXT STEPS AFTER FIX

1. **Deploy to PROD** (if TEST is fixed)
2. **Monitor for 24-48 hours**
3. **Proceed with TTRC-250** (Add 2 new feeds)
4. **Start TTRC-249** (Health Dashboard UI)

---

## FILES TO REVIEW

- `.github/workflows/` - GitHub Actions configurations
- `supabase/functions/rss-enqueue/` - Edge Function code
- `scripts/job-queue-worker.js` - Worker script
- `docs/architecture/rss-system.md` - System architecture

---

**Estimated Time:** 30-60 minutes (diagnosis + fix)
**Environment:** TEST
**Blockers:** None (ready to start)


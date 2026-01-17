# BREAK GLASS - RSS Pipeline Emergency Fixes

## 🚨 GOLDEN RULE
**processed_at IS NULL = job is active**

This single rule governs the entire RSS system. Every terminal state (done/failed/timeout) MUST set processed_at = NOW().

## Quick Diagnostic Commands

### Check System Health
```bash
# Run preflight check FIRST
node scripts/preflight-check.js

# Check job queue status
node scripts/diagnose-job-queue.js

# Check for stuck jobs in database
```

### Database Diagnostics
```sql
-- See current job state
SELECT job_type, status, failure_count, 
       processed_at IS NULL as is_active,
       COUNT(*) 
FROM job_queue 
WHERE job_type = 'fetch_feed'
GROUP BY job_type, status, failure_count, is_active
ORDER BY is_active DESC;

-- List stuck jobs
SELECT id, feed_url, status, created_at, run_at
FROM job_queue
WHERE job_type = 'fetch_feed'
  AND status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at;

-- Count runnable jobs (matches worker logic)
SELECT count_runnable_fetch_jobs();
```

## Common Issues & Fixes

### Issue: Jobs Stuck in Processing
**Symptoms:** Jobs show "processing" but worker finds nothing
**Cause:** Worker crashed without marking jobs complete

**Fix:**
```sql
-- Reset stuck jobs
SELECT reset_stuck_jobs();

-- Or manually:
UPDATE job_queue
SET status = 'pending',
    run_at = NOW() + INTERVAL '1 minute',
    failure_count = failure_count + 1
WHERE job_type = 'fetch_feed'
  AND status = 'processing'
  AND created_at < NOW() - INTERVAL '1 hour';
```

### Issue: Worker Claims "null" Jobs
**Symptoms:** Worker logs "Claimed job #null"
**Cause:** claim_next_fetch_job() returning composite null

**Fix:**
```sql
-- Verify function returns actual NULL
SELECT claim_next_fetch_job('worker-1') IS NULL;

-- Should return true if no jobs, not a row of nulls
```

### Issue: Duplicate Job Creation
**Symptoms:** Same feed has multiple pending jobs
**Cause:** Partial unique index not working

**Fix:**
```sql
-- Check for duplicates
SELECT feed_url, COUNT(*)
FROM job_queue
WHERE processed_at IS NULL
GROUP BY feed_url
HAVING COUNT(*) > 1;

-- Clean duplicates (keep oldest)
DELETE FROM job_queue
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY feed_url 
      ORDER BY created_at
    ) as rn
    FROM job_queue
    WHERE processed_at IS NULL
  ) t WHERE rn > 1
);
```

### Issue: No Jobs Being Created
**Symptoms:** Worker runs but finds no jobs
**Cause:** Feed registry empty or all feeds inactive

**Fix:**
```bash
# Seed jobs from active feeds
node scripts/seed-fetch-jobs.js

# Check feed registry
```
```sql
SELECT COUNT(*) FROM feed_registry WHERE is_active = true;

-- If empty, add feeds:
INSERT INTO feed_registry (feed_url, source_name, is_active)
VALUES 
  ('https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 'NYT Politics', true),
  ('https://feeds.washingtonpost.com/rss/politics', 'WaPo Politics', true);
```

### Issue: Reuters/AP Feeds Failing
**Symptoms:** 403 or DNS errors from Reuters/AP
**Cause:** Missing User-Agent header

**Fix in fetch_feed.js:**
```javascript
const response = await fetch(feedUrl, {
  headers: {
    'User-Agent': 'TrumpyTracker/1.0 RSS Reader',
    'Accept': 'application/rss+xml, application/xml, text/xml'
  }
});
```

## Emergency Recovery Procedures

### Full System Reset
```bash
# 1. Stop worker
# Ctrl+C or kill process

# 2. Clear job queue
```
```sql
DELETE FROM job_queue WHERE job_type = 'fetch_feed';
```
```bash
# 3. Run preflight check
node scripts/preflight-check.js

# 4. Seed fresh jobs
node scripts/seed-fetch-jobs.js

# 5. Start worker
node scripts/job-queue-worker-atomic.js
```

### Production Deployment from TEST
```sql
-- Run on PRODUCTION database
-- Get migrations from PRODUCTION_DEPLOYMENT.sql

-- Key migrations needed:
-- 014: claim_next_fetch_job returns NULL properly
-- 015: Partial unique index on active jobs
-- 016: Mark jobs done when processed
-- 017: Server-side count functions
```

## Monitoring Commands

### Watch Job Processing
```bash
# Terminal 1: Run worker with verbose logging
DEBUG=* node scripts/job-queue-worker-atomic.js

# Terminal 2: Watch queue status
watch -n 5 'psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM job_queue GROUP BY status"'
```

### Check Article Creation
```sql
-- Articles created in last hour
SELECT COUNT(*), source_domain
FROM articles
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY source_domain;
```

## Contact for Emergencies

If system remains broken after these procedures:
1. Check latest handoff in `/docs/handoffs/`
2. Review migration history in `/migrations/`
3. Run comprehensive E2E test: `npm run test:rss:e2e`

## Prevention Checklist

Before ANY RSS changes:
- [ ] Run preflight check
- [ ] Back up job_queue table
- [ ] Test on TEST environment first
- [ ] Have rollback SQL ready
- [ ] Monitor for 1 hour after deployment

Remember: **processed_at IS NULL = job is active**

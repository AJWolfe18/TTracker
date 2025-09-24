# RSS Job Queue System - Production Deployment Guide

## Files Required for Production

### 1. Database Migrations (apply in order)

```bash
# Core job queue infrastructure
psql $PROD_DATABASE_URL < migrations/008_job_queue_critical_columns.sql
psql $PROD_DATABASE_URL < migrations/009_atomic_job_claiming.sql

# Fix status values
psql $PROD_DATABASE_URL < scripts/fix-job-queue-status-PRODUCTION.sql
```

### 2. Production Worker

**File to deploy:** `scripts/job-queue-worker-atomic.js`

This is the only worker file needed for production. It includes:
- Atomic job claiming with SKIP LOCKED
- Race condition prevention
- Proper error handling
- Rate limiting
- Concurrent job processing

### 3. Environment Variables Required

```bash
# Production .env
SUPABASE_URL=your-prod-url
SUPABASE_SERVICE_ROLE_KEY=your-prod-key
OPENAI_API_KEY=your-openai-key

# Optional worker configuration
WORKER_POLL_INTERVAL_MS=5000
WORKER_MAX_CONCURRENT=2
WORKER_RATE_LIMIT_MS=500
```

## Production Deployment Steps

### Step 1: Apply Migrations

```bash
# Add missing columns
psql $PROD_DATABASE_URL < migrations/008_job_queue_critical_columns.sql

# Add atomic claiming functions
psql $PROD_DATABASE_URL < migrations/009_atomic_job_claiming.sql

# Fix status values (completed → done)
psql $PROD_DATABASE_URL < scripts/fix-job-queue-status-PRODUCTION.sql
```

### Step 2: Verify Installation

```sql
-- Check functions exist
SELECT proname FROM pg_proc 
WHERE proname IN ('claim_next_job', 'finish_job');

-- Check status values
SELECT DISTINCT status FROM job_queue;
-- Should show: pending, processing, failed, done (NOT 'completed')

-- Test atomic claiming
SELECT * FROM claim_next_job('fetch_feed');
```

### Step 3: Deploy Worker

Option A - Cron job (recommended for production):
```bash
# Add to crontab - run every 5 minutes
*/5 * * * * cd /path/to/project && node scripts/job-queue-worker-atomic.js
```

Option B - GitHub Actions (scheduled):
```yaml
on:
  schedule:
    - cron: '*/10 * * * *'  # Every 10 minutes
```

Option C - Process manager (PM2):
```bash
pm2 start scripts/job-queue-worker-atomic.js --name rss-worker
```

## Quick Fixes Needed Before Production

### 1. Column Name Fix

In `scripts/rss/fetch_feed.js`, change:
```javascript
// FROM:
.select('*')
.eq('url', feedUrl)

// TO:
.select('*')
.eq('feed_url', feedUrl)
```

### 2. Story Cluster Payload Fix

Ensure story.cluster jobs include `article_id` in payload when created.

## Monitoring Queries

```sql
-- Monitor job processing
SELECT 
  job_type,
  status,
  COUNT(*) as count,
  MAX(completed_at) as last_completed
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;

-- Check for stuck jobs
SELECT * FROM job_queue
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '30 minutes';

-- Monitor article ingestion rate
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as articles_created
FROM articles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

## Files NOT Needed for Production

These are test/development only:
- `.github/workflows/rss-e2e-test.yml` (test workflow)
- `scripts/seed-feeds-ci.js` (test data)
- `scripts/seed-fetch-jobs.js` (test jobs)
- `scripts/verify-*.js` (test verification)
- `scripts/run-worker.js` (test wrapper)
- All `.bak` files
- Documentation handoff files in `/docs`

## Total Production Files

Only 4 files actually go to production:
1. `migrations/008_job_queue_critical_columns.sql`
2. `migrations/009_atomic_job_claiming.sql`
3. `scripts/fix-job-queue-status-PRODUCTION.sql`
4. `scripts/job-queue-worker-atomic.js`

## Cost Impact

No change - stays within $50/month target:
- Supabase: ~$25/month
- OpenAI API: ~$10-15/month for summaries
- Total: Well under $50/month

## Success Criteria

After deployment, you should see:
- Jobs being claimed atomically (no duplicates)
- RSS feeds being fetched every run
- Articles being created in database
- No race conditions or stuck jobs
- Status values showing 'done' not 'completed'

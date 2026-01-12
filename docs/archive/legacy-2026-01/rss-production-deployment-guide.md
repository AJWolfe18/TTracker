# RSS System Production Deployment Guide

## ⚠️ CRITICAL: Pre-Production Checklist

This guide contains ALL SQL migrations and steps required to deploy the RSS system to production. Follow these steps in order.

## Phase 1: Pre-Deployment Verification (TEST Environment)

### Step 1.1: Check for Duplicate Feeds
Run this BEFORE the migration to identify any duplicate feed URLs that need cleanup:

```sql
-- Run in TEST first, then in PROD before migration
WITH dups AS (
  SELECT feed_url, COUNT(*) AS cnt
  FROM public.feed_registry
  GROUP BY feed_url
  HAVING COUNT(*) > 1
)
SELECT * FROM dups;
```

If duplicates exist, clean them up:
```sql
-- Keep the lowest id per feed_url, delete the rest
WITH ranked AS (
  SELECT id, feed_url,
         ROW_NUMBER() OVER (PARTITION BY feed_url ORDER BY id) AS rn
  FROM public.feed_registry
)
DELETE FROM public.feed_registry fr
USING ranked r
WHERE fr.id = r.id AND r.rn > 1;
```

### Step 1.2: Verify TEST Environment Success
Confirm these all return expected results in TEST:

```sql
-- Should show 5 active feeds with IDs
SELECT * FROM public.rss_feed_status;

-- Should show articles from recent RSS fetches
SELECT COUNT(*) as count, source_name 
FROM public.articles 
WHERE created_at > NOW() - INTERVAL '48 hours'
GROUP BY source_name;

-- Should show the ingest_rejections table exists
SELECT * FROM public.ingest_rejections LIMIT 1;

-- Should show job_queue has payload_hash column
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'job_queue' 
  AND column_name = 'payload_hash';
```

## Phase 2: Production Database Preparation

### Step 2.1: Enable Required Extensions
```sql
-- Run on PRODUCTION database
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Step 2.2: Run Complete Schema Migration
**File:** `migrations/005_fix_rss_schema_drift.sql`

This migration:
- Adds `id` primary key to feed_registry
- Adds `source_tier`, `topics`, `last_fetched_at`, `feed_name` columns
- Normalizes `active` → `is_active` column
- Adds `published_date` computed column to articles
- Adds `payload_hash` to job_queue for duplicate prevention
- Creates `ingest_rejections` table for error tracking
- Creates `rss_feed_status` monitoring view

Copy and run the ENTIRE contents of `migrations/005_fix_rss_schema_drift.sql` in production.

### Step 2.3: Seed RSS Feeds
**File:** `db/seed/feeds.sql`

This seeds the 5 core political RSS feeds. Safe to run multiple times (idempotent).

Copy and run the ENTIRE contents of `db/seed/feeds.sql` in production.

### Step 2.4: Verify Migration Success
```sql
-- All of these should return data without errors
SELECT * FROM public.feed_registry;
SELECT * FROM public.rss_feed_status;
SELECT * FROM public.ingest_rejections LIMIT 1;
DESCRIBE public.job_queue; -- Should show payload_hash column
```

## Phase 3: Code Deployment

### Step 3.1: Deploy Edge Functions (if using)
```bash
# From your local development environment
supabase link --project-ref <PROD_PROJECT_REF>
supabase functions deploy fetch_all_feeds
```

### Step 3.2: Deploy Application Code
1. Merge test branch to main
2. Deploy to production hosting (Netlify/Vercel/etc)
3. Ensure environment variables are set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`

### Step 3.3: Start Job Queue Worker
Deploy the job queue worker with production credentials:
```bash
NODE_ENV=production node scripts/job-queue-worker.js
```

## Phase 4: Production Activation

### Step 4.1: Manual Test - Create Single Feed Job
```sql
-- Create a test job for one feed
INSERT INTO public.job_queue (job_type, payload, status, run_at)
SELECT 
  'fetch_feed',
  jsonb_build_object(
    'feed_id', id,
    'url', feed_url, 
    'source_name', feed_name
  ),
  'pending',
  NOW()
FROM public.feed_registry
WHERE feed_name = 'NYT Politics'
ON CONFLICT (job_type, payload_hash) DO NOTHING;
```

### Step 4.2: Verify Test Job Completed
```sql
-- Check if job was processed
SELECT * FROM public.job_queue 
WHERE job_type = 'fetch_feed' 
ORDER BY created_at DESC LIMIT 1;

-- Check if articles were created
SELECT COUNT(*) FROM public.articles 
WHERE source_name = 'NYT Politics' 
  AND created_at > NOW() - INTERVAL '1 hour';
```

### Step 4.3: Activate All Feeds
```sql
-- Create jobs for all active feeds
INSERT INTO public.job_queue (job_type, payload, status, run_at)
SELECT 
  'fetch_feed',
  jsonb_build_object(
    'feed_id', id,
    'url', feed_url, 
    'source_name', feed_name
  ),
  'pending',
  NOW()
FROM public.feed_registry
WHERE is_active = true
ON CONFLICT (job_type, payload_hash) DO NOTHING;
```

### Step 4.4: Schedule Recurring Jobs
Set up your scheduler (cron, GitHub Actions, etc.) to run every 2-4 hours:
```sql
-- This query creates feed jobs (safe to run multiple times)
INSERT INTO public.job_queue (job_type, payload, status, run_at)
SELECT 
  'fetch_feed',
  jsonb_build_object(
    'feed_id', id,
    'url', feed_url, 
    'source_name', feed_name
  ),
  'pending',
  NOW()
FROM public.feed_registry
WHERE is_active = true
  AND (last_fetched_at IS NULL OR last_fetched_at < NOW() - INTERVAL '2 hours')
ON CONFLICT (job_type, payload_hash) DO NOTHING;
```

## Phase 5: Production Monitoring

### Monitor RSS Feed Health
```sql
-- RSS feed status overview
SELECT * FROM public.rss_feed_status;

-- Articles by source (last 24h)
SELECT 
  source_name,
  COUNT(*) as article_count,
  MAX(published_at) as latest_article
FROM public.articles
WHERE published_at > NOW() - INTERVAL '24 hours'
GROUP BY source_name
ORDER BY article_count DESC;

-- Check for ingestion errors
SELECT * FROM public.ingest_rejections
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Job queue health
SELECT 
  job_type,
  status,
  COUNT(*) as count,
  MAX(created_at) as latest
FROM public.job_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY job_type, status;
```

## Rollback Plan

If issues occur, here's how to rollback:

### Disable RSS Processing
```sql
-- Stop all feeds
UPDATE public.feed_registry SET is_active = false;

-- Clear pending jobs
DELETE FROM public.job_queue 
WHERE job_type IN ('fetch_feed', 'story.cluster', 'story.cluster.batch')
  AND status = 'pending';
```

### Full Rollback (if needed)
```sql
-- Remove RSS-specific tables/columns (DESTRUCTIVE - loses data)
DROP VIEW IF EXISTS public.rss_feed_status;
DROP TABLE IF EXISTS public.ingest_rejections;
ALTER TABLE public.job_queue DROP COLUMN IF EXISTS payload_hash;
ALTER TABLE public.feed_registry DROP COLUMN IF EXISTS source_tier;
ALTER TABLE public.feed_registry DROP COLUMN IF EXISTS topics;
-- etc.
```

## Complete SQL File List for Production

1. **migrations/005_fix_rss_schema_drift.sql** - Schema alignment
2. **db/seed/feeds.sql** - Feed data
3. **Monitoring queries** - Listed in Phase 5

## Environment-Specific Notes

- **TEST**: Already has migrations 001-004, needs 005
- **STAGING**: May need migrations 003-005 depending on state
- **PRODUCTION**: Needs migration 005 before RSS deployment

## Success Criteria

✅ All 5 RSS feeds have recent articles (< 48 hours old)
✅ Job queue processing without errors
✅ No duplicate job errors in logs
✅ ingest_rejections table has < 5% rejection rate
✅ Worker runs without crashing for 24+ hours

---

**Document Version**: 1.0
**Last Updated**: September 2025
**Critical**: Run migration 005 BEFORE deploying RSS code to production

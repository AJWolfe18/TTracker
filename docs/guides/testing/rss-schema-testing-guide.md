# RSS Schema Alignment & Testing Guide

## Immediate Actions Required

### 1. Run Migration on TEST Database
Go to Supabase Dashboard → SQL Editor and run:
```sql
-- Run migrations/005_fix_rss_schema_drift.sql
```

### 2. Seed Feeds
After migration, run:
```sql
-- Run db/seed/feeds.sql
```

### 3. Test Queries to Verify Setup

#### Check Feed Status:
```sql
-- View all feeds and their recent activity
SELECT * FROM public.rss_feed_status;
```

#### Check Articles from Last 48 Hours:
```sql
SELECT COUNT(*) as article_count, 
       source_name,
       MIN(published_at) as oldest,
       MAX(published_at) as newest
FROM public.articles 
WHERE published_at >= (NOW() - INTERVAL '48 hours')
GROUP BY source_name
ORDER BY article_count DESC;
```

#### Check Job Queue Status:
```sql
SELECT job_type, status, COUNT(*) 
FROM public.job_queue 
GROUP BY job_type, status
ORDER BY job_type, status;
```

#### Check for Rejection Issues:
```sql
SELECT * FROM public.ingest_rejections 
ORDER BY created_at DESC 
LIMIT 10;
```

## What This Migration Fixes

### Schema Alignment Issues:
- ✅ `feed_registry.id` - Added primary key
- ✅ `feed_registry.source_tier` - Added for feed prioritization  
- ✅ `feed_registry.topics` - Added for categorization
- ✅ `feed_registry.last_fetched_at` - Added for tracking
- ✅ `articles.published_date` - Added as computed column
- ✅ `job_queue.payload_hash` - Added for duplicate prevention
- ✅ `ingest_rejections` table - Created for error tracking
- ✅ Column name standardization (active → is_active)

### Why This Matters for Production:
1. **Prevents crashes** - All expected columns will exist
2. **Handles duplicates** - Proper unique constraints
3. **Tracks failures** - ingest_rejections table logs issues
4. **Monitoring ready** - rss_feed_status view shows health

## Testing Checklist

- [ ] Migration runs without errors
- [ ] Feeds table has 5 active feeds
- [ ] Can manually create a job without duplicate error
- [ ] Worker runs without crashing
- [ ] Articles appear after running E2E test

## Manual Job Creation (Idempotent):
```sql
-- Create jobs for all active feeds (won't duplicate)
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

## Files Created This Session:
1. `migrations/005_fix_rss_schema_drift.sql` - Schema alignment
2. `db/seed/feeds.sql` - Feed seeding  
3. `docs/rss-schema-testing-guide.md` - This guide

## Deployment Path:
1. **TEST** (now): Run migration & seeds, test E2E
2. **STAGING** (if exists): Run same migration & seeds
3. **PRODUCTION** (when ready): 
   - Run migration first
   - Deploy RSS code
   - Seed feeds
   - Monitor for 24 hours

## About Schema Drift:
The TEST database diverged from expected schema because:
- Different migration history
- Manual alterations
- Missing computed columns
- Different column names (active vs is_active)

This migration brings everything into alignment so the same code works everywhere.

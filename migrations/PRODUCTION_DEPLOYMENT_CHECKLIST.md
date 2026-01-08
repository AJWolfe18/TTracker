# RSS Pipeline - Production Deployment Checklist

## Pre-Deployment Verification (Run in TEST)

### 1. Verify Current State
```sql
-- Check that TEST is working correctly
SELECT 
  COUNT(*) as articles_last_hour,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM articles
WHERE created_at >= NOW() - INTERVAL '1 hour';

-- Should show articles being created
```

### 2. Run Migration 014 in TEST First
```sql
-- Apply the fix to TEST to verify it works
\i migrations/014_fix_claim_returns_null.sql
```

### 3. Test the Fix
```sql
-- This should return NULL (not a row with nulls)
SELECT claim_and_start_job('nonexistent_type') IS NULL as returns_null;
-- Should show 't' (true)
```

## Production Deployment

### 1. Backup First (CRITICAL)
```bash
# Backup production database before any changes
pg_dump $PROD_DB_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Apply Migrations in Order
Run these migrations in PRODUCTION in this exact order:

```sql
-- Connect to PRODUCTION database
-- Then run each migration file

\i migrations/001_rss_system_PRODUCTION_READY.sql
\i migrations/002_job_queue_functions.sql
\i migrations/003_atomic_article_upsert_production_ready.sql
\i migrations/004_fix_generated_columns_and_constraints.sql
\i migrations/005_fix_rss_schema_drift.sql
\i migrations/006_PROD_clustering_complete.sql
\i migrations/007_articles_canonical_final.sql
\i migrations/008_job_queue_critical_columns.sql
\i migrations/009_atomic_job_claiming.sql
\i migrations/010_fix_rpc_generated_column.sql
\i migrations/011_fix_story_headlines_ttrc169_SENIOR_DEV_VERSION.sql
\i migrations/012_fix_job_queue_ttrc172.sql
\i migrations/013_fix_payload_hash_partial_unique.sql
\i migrations/014_fix_claim_returns_null.sql        -- NEW: Critical fix
\i migrations/015_monitoring_and_helpers.sql        -- NEW: Performance
```

### 3. Verify Functions Exist
```sql
-- Check all required functions are present
SELECT proname, pronargs
FROM pg_proc 
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND proname IN (
    'enqueue_fetch_job',
    'claim_and_start_job', 
    'finish_job',
    'reset_stuck_jobs',
    'cleanup_old_jobs'
  )
ORDER BY proname;

-- Should show 5 rows
```

### 4. Verify Indexes
```sql
-- Check performance indexes exist
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'ux_job_queue_payload_hash_active',
    'ix_job_queue_type_created',
    'ix_job_queue_status_completed_at',
    'ix_articles_created_source'
  );

-- Should show 4 rows
```

### 5. Deploy Code
```bash
# Merge to main branch
git checkout main
git merge test
git push origin main
```

### 6. Set Up Cron Schedule
```bash
# Add to crontab
*/15 * * * * cd /path/to/ttracker && node scripts/seed-fetch-jobs.js >> /var/log/ttracker/seed.log 2>&1

# Or use pm2 for the worker
pm2 start scripts/job-queue-worker-atomic.js --name ttracker-worker
pm2 save
pm2 startup
```

## Post-Deployment Verification

### 1. Check Jobs are Being Created
```sql
SELECT COUNT(*), status
FROM job_queue
WHERE job_type = 'fetch_feed'
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY status;
```

### 2. Monitor Articles
```sql
-- Watch for new articles
SELECT source_name, COUNT(*), MAX(created_at)
FROM articles
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY source_name;
```

### 3. Check for Errors
```sql
-- Look for failed jobs
SELECT id, payload->>'source_name', last_error
FROM job_queue
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '1 hour';
```

### 4. Weekly Maintenance
```sql
-- Run cleanup weekly
SELECT cleanup_old_jobs();
```

## Rollback Plan

If issues occur:

### 1. Stop the Worker
```bash
pm2 stop ttracker-worker
```

### 2. Reset Stuck Jobs
```sql
SELECT reset_stuck_jobs();
```

### 3. If Necessary, Restore
```bash
psql $PROD_DB_URL < backup_YYYYMMDD_HHMMSS.sql
```

## Success Criteria

- [ ] At least 10 articles created in first hour
- [ ] Job success rate > 50%
- [ ] No jobs stuck in 'processing' > 30 minutes
- [ ] At least 2 of 5 feeds working

## Notes

- Reuters/AP feeds may fail (user-agent issues) - this is known and non-blocking
- The critical fix in migration 014 ensures claim_and_start_job returns NULL properly
- Migration 015 adds performance indexes and maintenance functions

Last Updated: September 27, 2025

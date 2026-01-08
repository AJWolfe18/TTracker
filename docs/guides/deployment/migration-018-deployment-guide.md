# Migration 018 - Deployment Guide

## Overview
Migration 018 has been split into 4 parts to fix the `CREATE INDEX CONCURRENTLY` transaction block error.

## The Issue
PostgreSQL doesn't allow `CREATE INDEX CONCURRENTLY` inside a transaction block because it needs to scan the table multiple times. This migration splits the operations properly.

## Deployment Sequence

### Step 1: Run 018A - Legacy Cleanup
**File:** `018a_legacy_cleanup.sql`
**Safe to run in:** Transaction (automatic)

```sql
-- In Supabase SQL Editor (TEST):
-- Copy and paste entire contents of 018a_legacy_cleanup.sql
-- Click "Run"
```

Expected output:
```
NOTICE: Migration 018A completed: Legacy cleanup successful
```

### Step 2: Run 018B - Create Index (CRITICAL!)
**File:** `018b_create_index_no_transaction.sql`
**MUST run:** Outside transaction - run statement by itself!

```sql
-- In Supabase SQL Editor (TEST):
-- IMPORTANT: Run ONLY the CREATE INDEX statement by itself!

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- Then run the COMMENT and DO block separately
```

⚠️ **CRITICAL:** Do NOT wrap this in BEGIN/COMMIT. Run the CREATE INDEX statement alone!

Expected output:
```
CREATE INDEX
NOTICE: Migration 018B completed: Partial unique index created successfully
```

### Step 3: Run 018C - Functions & Cleanup
**File:** `018c_functions_grants_cleanup.sql`
**Safe to run in:** Transaction (automatic)

```sql
-- In Supabase SQL Editor (TEST):
-- Copy and paste entire contents of 018c_functions_grants_cleanup.sql
-- Click "Run"
```

Expected output:
```
NOTICE: Migration 018C completed successfully!
NOTICE: Key invariant: processed_at IS NULL = job is active
```

### Step 4: Verify Migration
**File:** `018d_verification_queries.sql`
**Purpose:** Confirm everything worked

```sql
-- In Supabase SQL Editor (TEST):
-- Copy and paste entire contents of 018d_verification_queries.sql
-- Click "Run"
```

Expected output:
```
✅ Partial index correctly configured
✅ Claim correctly returns NULL for empty queue
✅ Count function working
✅ No inconsistent job states
✅ No orphaned terminal jobs
✅ All required columns present
✅ All queue functions exist
🎉 MIGRATION 018 FULLY SUCCESSFUL! 🎉
```

## Key Points

### The Golden Rule
**`processed_at IS NULL` = Job is active**

This is the single source of truth for job state:
- Active jobs: `processed_at IS NULL`
- Completed jobs: `processed_at IS NOT NULL`

### Why This Works
1. **Partial unique index** only applies to active jobs (`WHERE processed_at IS NULL`)
2. Jobs can be re-queued after completion (no collision)
3. No race conditions - everything is atomic
4. Stale jobs automatically reclaimed

### What Changed from Original Migration 018
- Split into 4 files to handle `CONCURRENTLY` properly
- Fixed typo in comment (ISa → IS)
- Organized for clarity
- Added comprehensive verification

## Testing After Deployment

1. **Create test jobs:**
```bash
cd scripts
node seed-fetch-jobs.js
```

2. **Run the worker:**
```bash
node job-queue-worker-atomic.js
```

3. **Verify articles created:**
```sql
SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '1 hour';
```

## Production Deployment

Once verified in TEST:

1. Apply same sequence to PRODUCTION database
2. Use production project ref: `osjbulmltfpcoldydexg`
3. Monitor for 15 minutes after deployment

## Rollback Plan

If issues occur:
```sql
-- Rollback functions to previous version
DROP FUNCTION IF EXISTS enqueue_fetch_job(text, jsonb, text);
DROP FUNCTION IF EXISTS claim_and_start_job(text, integer);
-- Restore from backup or previous migration
```

## Support
- Check logs: `node scripts/debug-rss-pipeline.js`
- Reset stuck jobs: `SELECT reset_stuck_jobs();`
- Contact: Josh (Product Manager)

---
*Migration 018 - The Final Fix*
*RSS Pipeline Production Ready*

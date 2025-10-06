# RSS Job Queue Migration Clarification

## Migration File Status

### Existing Migrations (Already in repo):
- 001_rss_system_PRODUCTION_READY.sql - RSS base tables
- 002_job_queue_functions.sql - Basic job queue functions  
- 003_atomic_article_upsert.sql - First version (older)
- 003_atomic_article_upsert_production_ready.sql - Production version
- 004_fix_generated_columns_and_constraints.sql - Fixes for 003
- **005 - MISSING/SKIPPED**
- 006_PROD_clustering_complete.sql - Story clustering
- 007_articles_canonical_final.sql - Articles table final schema

### New Migrations Created Today:
- **008_job_queue_critical_columns.sql** - NEW - Fixes job_queue column names
- **009_atomic_job_claiming.sql** - NEW - Adds SKIP LOCKED atomic functions

## Why These Were Needed

The handoff documentation from 2025-09-24 01:00 mentioned that migrations 008 and 009 were supposed to exist and fix these specific issues:
1. Column naming (type vs job_type, run_after vs run_at)
2. Atomic claiming functions with SKIP LOCKED

However, these files were NOT actually in the repository. The handoff was incorrect or the files were never committed. I created them based on what the handoff said they should contain.

## What Each Migration Does

### 008_job_queue_critical_columns.sql (NEW)
- Renames `type` column to `job_type` (if needed)
- Renames `run_after` to `run_at` (if needed)
- Adds missing columns: started_at, completed_at, attempts, max_attempts
- Fixes status values: 'completed' → 'done'
- Adds proper indexes and constraints

### 009_atomic_job_claiming.sql (NEW)  
- Creates `claim_next_job(p_job_type)` function with SKIP LOCKED
- Creates `finish_job(p_id, p_success, p_error)` function
- Prevents race conditions in job processing
- Grants proper permissions

## Order of Execution

Run these in TEST environment in this order:
1. If not already run: 001 through 007
2. **NEW: 008_job_queue_critical_columns.sql**
3. **NEW: 009_atomic_job_claiming.sql**
4. **scripts/fix-job-queue-status-PRODUCTION.sql** (cleanup)

## Why The Numbering Gap?

- Migration 005 appears to have been skipped or deleted
- There are two version of 003 (likely due to fixes needed)
- This is common in active development
- The important thing is running them in order

## Verification

After running 008 and 009, verify:
```sql
-- Check job_type column exists
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'job_queue' AND column_name = 'job_type';

-- Check atomic functions exist
SELECT proname FROM pg_proc 
WHERE proname IN ('claim_next_job', 'finish_job');

-- Check status values are correct
SELECT DISTINCT status FROM job_queue;
-- Should show: pending, processing, done, failed (NOT 'completed')
```

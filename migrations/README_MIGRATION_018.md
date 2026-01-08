# Migration 018 - Quick Reference

## Files Created (in order of execution)
1. ✅ `migrations/018a_legacy_cleanup.sql` - Can run in transaction
2. ✅ `migrations/018b_create_index_no_transaction.sql` - MUST run alone! 
3. ✅ `migrations/018c_functions_grants_cleanup.sql` - Can run in transaction
4. ✅ `migrations/018d_verification_queries.sql` - Verification only

## Archived
- `migrations/archive_old/018_final_rss_fixes_OLD.sql` - Original problematic version

## Documentation
- `docs/migration-018-deployment-guide.md` - Step-by-step guide

## Critical Reminder
**STEP 2 (018b) MUST RUN OUTSIDE A TRANSACTION!**

In Supabase SQL Editor, run ONLY this line by itself:
```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_job_queue_payload_hash_active
  ON public.job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;
```

Then run the COMMENT and DO block separately.

## The Golden Rule
**`processed_at IS NULL = job is active`**

This is what makes everything work without race conditions.

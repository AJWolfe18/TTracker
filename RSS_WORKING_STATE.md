# RSS Pipeline - Working State Reference
Last verified working: 2025-09-28

## CRITICAL: DO NOT CHANGE THESE WITHOUT TESTING

### Database Functions That MUST Exist
```sql
-- 1. claim_and_start_job - MUST return NULL (not row of nulls) when no jobs
-- 2. finish_job - MUST set processed_at = NOW() 
-- 3. reset_stuck_jobs - MUST set processed_at = NOW()
-- 4. count_runnable_fetch_jobs - Single source of truth for counts
-- 5. enqueue_fetch_job - Uses partial unique index
```

### The ONE Rule That Matters
**processed_at IS NULL = job is active**
- Every terminal state (done/failed/timeout) MUST set processed_at
- Partial unique index uses WHERE processed_at IS NULL
- All "active" checks use processed_at IS NULL

### What's Working
- [X] NYT Politics feed
- [X] WaPo Politics feed  
- [X] Politico feed
- [ ] Reuters (needs User-Agent fix)
- [ ] AP News (needs User-Agent fix)

### The PostgREST Limitation
**NEVER use multiple .or() in Supabase queries** - it will silently fail with `{ message: '' }`
Always use server-side functions for complex predicates.

### Test Commands (Run These First)
```bash
# 1. Check functions exist
node scripts/preflight-check.js

# 2. Check job state
node scripts/diagnose-job-queue.js  

# 3. Test full pipeline
node scripts/seed-fetch-jobs.js
node scripts/job-queue-worker-atomic.js
```

### If Jobs Get Stuck Again
```sql
-- Nuclear option - clear everything
DELETE FROM job_queue WHERE job_type = 'fetch_feed';

-- Or just clear old processed jobs
DELETE FROM job_queue 
WHERE job_type = 'fetch_feed' 
  AND processed_at IS NOT NULL;
```

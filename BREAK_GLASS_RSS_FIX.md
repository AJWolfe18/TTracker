# RSS PIPELINE EMERGENCY FIX

If the RSS pipeline is stuck AGAIN, follow these steps IN ORDER:

## 1. Run Diagnostics First
```bash
node scripts/preflight-check.js
node scripts/diagnose-job-queue.js
```

## 2. If Jobs Are Stuck
Run this SQL in Supabase:
```sql
-- Show what's stuck
SELECT id, status, processed_at, started_at, 
       NOW() - started_at as stuck_duration
FROM job_queue 
WHERE job_type = 'fetch_feed' 
  AND processed_at IS NULL;

-- Nuclear option: Clear everything
DELETE FROM job_queue WHERE job_type = 'fetch_feed';
```

## 3. Restart Fresh
```bash
node scripts/seed-fetch-jobs.js
node scripts/job-queue-worker-atomic.js
```

## 4. If Counts Are Wrong
The ONLY source of truth is:
```sql
SELECT count_runnable_fetch_jobs();
```

Never trust client-side counts. If this function doesn't exist, run migration 017.

## 5. The Golden Rule
**processed_at IS NULL = job is active**

If a job has processed_at set, it's done and can be re-queued.
If processed_at is NULL, it's active and blocked by the partial unique index.

## DO NOT
- Add more .or() clauses to Supabase queries
- Try to count jobs client-side
- Change the claim logic without testing
- Trust ChatGPT/Claude to "fix" it without reading this first

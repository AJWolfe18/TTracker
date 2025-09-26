# RSS E2E Pipeline Fix - TODO Checklist

## ✅ Already Complete:
- [x] SQL Migrations applied to TEST database
  - [x] Partial unique index created: `ux_job_queue_payload_hash_active`
  - [x] RPC created: `enqueue_fetch_job`
  - [x] RPC created: `claim_and_start_job`  
  - [x] RPC created: `finish_job`

## 📋 Code Updates Needed:

### File 1: scripts/seed-fetch-jobs.js
- [ ] Add `import 'dotenv/config';` at the very top of file
- [ ] Add runnable guard section before the final success log (around line 50-60)
- [ ] Ensure catch block has `process.exit(1)`

### File 2: scripts/job-queue-worker-atomic.js  
- [ ] Add helper functions after Supabase client creation:
  - [ ] `claimNextFetchJob()` function
  - [ ] `finishJob()` function
- [ ] Replace job claim logic in main polling loop with RPC calls
- [ ] Update success path to call `finishJob(job.id, true, null)`
- [ ] Update error path to call `finishJob(job.id, false, error.message)`

### File 3: scripts/verify-e2e-results.js
- [ ] Verify all queries use `.select()` before `.eq()` (Supabase v2 pattern)
- [ ] Add `import 'dotenv/config';` at top if missing

## 📝 Reference:
Full implementation details in: `docs/rss-e2e-fix-plan-final.md`

## 🧪 Testing:
1. Commit changes to test branch
2. Push to GitHub
3. Run GitHub Actions: "RSS E2E Test (Production-Ready)" workflow
4. Verify no "constraint does not exist" errors
5. Verify worker finds and processes jobs
6. Check for articles created in database

## 🎯 Success Criteria:
```
✅ No "constraint does not exist" error
✅ Jobs created successfully  
✅ Worker finds the jobs that seeder created
✅ Articles appear in database
✅ E2E test passes
```

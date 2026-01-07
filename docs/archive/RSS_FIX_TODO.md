# RSS E2E Pipeline Fix - TODO Checklist

## ✅ Already Complete:
- [x] SQL Migrations applied to TEST database
  - [x] Partial unique index created: `ux_job_queue_payload_hash_active`
  - [x] RPC created: `enqueue_fetch_job`
  - [x] RPC created: `claim_and_start_job`  
  - [x] RPC created: `finish_job`

## ✅ Code Updates COMPLETED:

### File 1: scripts/seed-fetch-jobs.js
- [x] Add `import 'dotenv/config';` at the very top of file
- [x] Add environment variable validation (exits if missing)
- [x] Add runnable guard section before the final success log (already present)
- [x] Ensure catch block has `process.exit(1)` (already present)

### File 2: scripts/job-queue-worker-atomic.js  
- [x] Add `import 'dotenv/config';` with proper placement
- [x] Add environment variable validation (exits if missing)
- [x] Add helper functions with correct RPC signatures:
  - [x] `claimNextJob(pJobType)` - General claim function
  - [x] `claimNextFetchJob()` - Claims fetch_feed jobs via RPC
  - [x] `finishJob()` - Completes jobs via RPC with better error messages
- [x] Fix legacy RPC reference (claim_next_job → claim_and_start_job)
- [x] Simplify job claim logic (removed complex fallback)
- [x] Add null job handling (gracefully handles no jobs available)
- [x] Update success path to call `finishJob(job.id, true, null)`
- [x] Update error path to call `finishJob(job.id, false, error.message)`

### File 3: scripts/verify-e2e-results.js
- [x] Verify all queries use `.select()` before `.eq()` (Supabase v2 pattern) - CONFIRMED
- [x] Add `import 'dotenv/config';` at top
- [x] Add environment variable validation (exits if missing)

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

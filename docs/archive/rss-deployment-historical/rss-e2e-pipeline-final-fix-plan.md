# RSS E2E Pipeline - Final Fix Plan

## Quick Summary
Apply two migrations (already done ✅), update three files, run. No new configuration, no complexity.

---

## Step 1: ✅ ALREADY COMPLETE - Migrations Applied

The following migrations have been successfully applied to TEST database:
- Partial unique index: `ux_job_queue_payload_hash_active`
- RPC functions: `enqueue_fetch_job`, `claim_and_start_job`, `finish_job`

Verification shows all components exist and are ready.

---

## Step 2: Update Code Files

### File 1: scripts/seed-fetch-jobs.js

**At the very top of the file, add:**
```javascript
import 'dotenv/config';
```

**Find the section with console.log summary (around line 50-60), and ADD this BEFORE the final success log:**
```javascript
// Runnable guard — put this BEFORE the final "worker can proceed" log
const nowIso = new Date().toISOString();
const { count: runnableCount, error: runErr } = await supabase
  .from('job_queue')
  .select('*', { count: 'exact', head: true })
  .eq('job_type', 'fetch_feed')
  .is('processed_at', null)
  .lte('run_at', nowIso);

if (runErr) {
  console.error('❌ Failed to verify runnable jobs:', runErr.message);
  process.exit(1);
}
if ((runnableCount ?? 0) === 0) {
  console.error('❌ No runnable fetch_feed jobs after seeding. Failing fast.');
  process.exit(1);
}

console.log(`✅ ${runnableCount} fetch_feed jobs ready to run`);
// EXISTING LINE: console.log('\n✅ Job seeding complete - worker can proceed');
```

### File 2: scripts/job-queue-worker-atomic.js

**After the Supabase client creation (around line 10-20), ADD these helper functions:**
```javascript
async function claimNextFetchJob() {
  const { data, error } = await supabase.rpc('claim_and_start_job', { p_job_type: 'fetch_feed' });
  if (error) throw error;
  return data || null; // data is the claimed row or null
}

async function finishJob(jobId, ok, errMsg = null) {
  const { error } = await supabase.rpc('finish_job', { p_job_id: jobId, p_ok: ok, p_error: errMsg });
  if (error) throw error;
}
```

**Find the main polling loop (search for "pollInterval" or "while"), REPLACE the job claim logic with:**
```javascript
// inside the polling loop / worker tick:
const job = await claimNextFetchJob();
if (!job) {
  // no job this tick; sleep/poll again
  await sleep(pollIntervalMs);
  continue;
}

try {
  // ... your existing fetch/parse/insert logic using job.payload ...
  await finishJob(job.id, true, null);
} catch (e) {
  await finishJob(job.id, false, e?.message || 'worker error');
}
```

### File 3: scripts/verify-e2e-results.js

**This file should already be fixed from earlier. Just verify queries look like:**
```javascript
// Example of correct Supabase v2 pattern:
const { count } = await supabase
  .from('job_queue')
  .select('*', { count: 'exact', head: true })  // select FIRST
  .eq('job_type', 'fetch_feed')                  // then filters
  .is('processed_at', null)
  .lte('run_at', nowIso);
```

---

## Step 3: Commit and Run

### Commit Message
```
fix: RSS pipeline - partial unique index + RPC claim/finish

- Add partial unique index for job deduplication
- Replace ON CONFLICT with exception-based RPC
- Add claim_and_start_job and finish_job RPCs
- Add runnable guard to fail fast if no jobs
- Fix Supabase v2 query chaining
```

### Run Order in CI
1. Migrations are already applied ✅
2. Seed jobs: `node scripts/seed-fetch-jobs.js`
3. If seeder exits non-zero, STOP (the guard enforces this)
4. Run worker: `node scripts/job-queue-worker-atomic.js`
5. Verify: `node scripts/verify-e2e-results.js`

---

## Verification

### Success Looks Like:
```
📋 Creating RSS fetch jobs (atomic mode)...
✅ Created job for: NYT Politics
✅ Created job for: WaPo Politics
✅ 5 fetch_feed jobs ready to run
✅ Job seeding complete - worker can proceed
[Worker processes jobs]
✅ E2E TEST PASSED
```

### If Something's Wrong:
```sql
-- Check the index exists
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'job_queue' AND indexname LIKE '%payload_hash%';

-- Check job status
SELECT job_type, status, COUNT(*) 
FROM job_queue 
WHERE job_type = 'fetch_feed' 
GROUP BY job_type, status;

-- Check if articles were created
SELECT COUNT(*) as recent_articles 
FROM articles 
WHERE created_at > NOW() - INTERVAL '1 hour';
```

---

## Implementation Notes

This minimal patch fixes the core issues:
- Constraint error → Fixed with partial unique index ✅
- Worker finds no jobs → Fixed with RPC claim functions
- No fail-fast → Fixed with runnable guard
- Supabase v2 → Already fixed in earlier session

No fingerprinting, no extra tables, no new environment variables needed.

Total time to implement code changes: ~15 minutes

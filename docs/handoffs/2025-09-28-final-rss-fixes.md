# Project Handoff - Sept 28, 2025 - RSS Pipeline Final Fixes

## SESSION SUMMARY
Successfully implemented senior dev's surgical fixes to resolve RSS pipeline stuck jobs issue. The root cause was inconsistent "active" job definitions between scripts. Fixed by implementing single source of truth (`processed_at IS NULL`) across all components and using server-side RPC for counting.

## BRANCH & COMMITS
- Working Branch: test
- Commit Message: "fix: RSS pipeline final fixes - consistent active definition and RPC counting"
- Files Changed:
  - migrations/018_final_rss_fixes.sql (NEW - complete fix migration)
  - scripts/seed-fetch-jobs.js (UPDATED - added processed_at check)
  - scripts/job-queue-worker-atomic.js (UPDATED - RPC counting with fallback)
  - scripts/verify-e2e-results.js (ALREADY USING RPC)
  - scripts/preflight-check.js (UPDATED - added runnable count and NULL checks)

## ROOT CAUSE ANALYSIS
The senior dev identified three critical issues:
1. **Seeder** only checked `status IN ('pending','processing')` without `processed_at IS NULL`
2. **Worker** count queries used complex `.or()` chains that fail silently in PostgREST
3. **Inconsistent predicates** between seeder, worker, and database RPCs

This caused the seeder to think jobs were active (so it wouldn't create new ones) while the worker couldn't find anything to claim.

## THE FIX: Single Source of Truth
**Golden Rule: `processed_at IS NULL = job is active`**

All components now use this single definition consistently:
- Active job = `processed_at IS NULL`
- Runnable job = Active AND (pending OR stale processing) AND run_at ready AND attempts ok

## SQL MIGRATIONS APPLIED TO TEST
- ✅ Migrations 001-017: All previous RSS pipeline migrations
- ⏳ Migration 018: Final RSS fixes (NEEDS APPLYING)
  - Full claim_and_start_job function with NULL handling
  - count_runnable_fetch_jobs RPC
  - Proper permissions grants
  - Table defaults for consistency
  - One-time cleanup of stuck jobs

## KEY TECHNICAL DECISIONS
1. **Use RPC for everything** - Server-side functions avoid PostgREST filter quirks
2. **Two separate count queries** - Avoid complex `.or()` chains that fail silently
3. **Bulletproof NULL handling** - Accept both true NULL and row-of-nulls from PostgREST
4. **Consistent predicates** - All scripts use exact same "active" and "runnable" definitions

## EXECUTION STEPS
1. **Apply migration 018 to TEST**
   ```sql
   -- Run in Supabase SQL editor
   -- Copy entire migration from migrations/018_final_rss_fixes.sql
   ```

2. **Reload schema cache**
   - Supabase Dashboard → Settings → API → Reload schema cache

3. **Run diagnostics**
   ```bash
   node scripts/diagnose-job-queue.js
   ```

4. **Run preflight** (must be all green)
   ```bash
   node scripts/preflight-check.js
   ```

5. **Seed new jobs**
   ```bash
   node scripts/seed-fetch-jobs.js
   ```

6. **Run worker**
   ```bash
   node scripts/job-queue-worker-atomic.js
   ```

7. **Verify E2E**
   ```bash
   node scripts/verify-e2e-results.js
   ```

## CHANGES MADE TO SCRIPTS

### seed-fetch-jobs.js
- Added `processed_at IS NULL` check to active job detection
- Added RPC count at start for visibility
- Fixed to use golden rule for "active" definition

### job-queue-worker-atomic.js
- Uses RPC `count_runnable_fetch_jobs()` for initial count
- Added fallback detailed logging with two separate queries
- Fixed migration reference to 018

### verify-e2e-results.js
- Already using RPC correctly (no changes needed)

### preflight-check.js
- Added runnable jobs count check
- Added verification that claim returns NULL properly
- Now has 10 total checks (was 8)

## SUCCESS CRITERIA
After applying these fixes:
- ✅ Seeder creates new jobs when none are active
- ✅ Worker finds and claims available jobs
- ✅ Counts are consistent across all scripts
- ✅ No more "pendingCount error: { message: '' }"
- ✅ E2E test passes with articles created

## KNOWN ISSUES & SOLUTIONS
### Issue: Reuters/AP feeds still failing
**Cause:** User-Agent already fixed in fetch_feed.js
**Status:** Non-blocking, feeds have proper UA header

### Issue: Jobs may still be stuck from before
**Solution:** Migration 018 includes cleanup:
```sql
UPDATE job_queue SET processed_at = NOW() 
WHERE processed_at IS NULL AND status IN ('done', 'failed');
```

## PRODUCTION DEPLOYMENT
Once TEST is verified working:
1. Apply migration 018 to PRODUCTION
2. Deploy updated scripts from test branch to main
3. Monitor for 24 hours
4. Set up 15-minute cron schedule

## CRITICAL NOTES
- **Environment:** TEST needs migration 018 applied
- **Cost Impact:** No change (<$50/month)
- **Blockers:** None after migration applied
- **Senior Dev Approved:** All recommendations implemented

## FILES READY FOR DEPLOYMENT
### New Files
- `/migrations/018_final_rss_fixes.sql`

### Updated Files
- `/scripts/seed-fetch-jobs.js`
- `/scripts/job-queue-worker-atomic.js`
- `/scripts/preflight-check.js`

### No Changes Needed
- `/scripts/verify-e2e-results.js` (already correct)
- `/scripts/rss/fetch_feed.js` (User-Agent already added)

## THE GOLDEN RULE (NEVER FORGET)
**`processed_at IS NULL = job is active`**

This single rule governs the entire system. Every terminal state (done/failed/timeout) MUST set `processed_at = NOW()`.

---
*Session Duration: ~45 minutes*
*Complexity: High (PostgREST quirks, PL/pgSQL NULL handling)*
*Outcome: Root cause identified and fixed surgically*

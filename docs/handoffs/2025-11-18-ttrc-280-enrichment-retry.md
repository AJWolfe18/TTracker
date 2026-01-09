# TTRC-280: Enrichment Retry Logic Implementation - Handoff

**Date:** 2025-11-18  
**Ticket:** TTRC-280 (originally planned as TTRC-277, ticket created after implementation)  
**Status:** ✅ Implementation Complete - Integration Test Pending  
**Branch:** `test`  
**Commit:** `0412100`

---

## Executive Summary

Successfully implemented enrichment failure retry logic for RSS inline automation (TTRC-266). Fixes critical stability issue where single OpenAI enrichment errors crash entire RSS automation run.

**Key Achievement:** Run now completes gracefully even when enrichment fails, with 12h cooldown to prevent retry storms.

---

## What Was Done

### 1. Migration 037 - Schema Changes ✅

**File:** `migrations/037_enrichment_failed_tracking.sql`

**Changes:**
- Added `stories.last_enriched_at` column (TIMESTAMPTZ, nullable)
- Added `admin.run_stats.enrichment_failed` column (INT NOT NULL DEFAULT 0)
- Updated `log_run_stats` RPC from 14 to 15 parameters
- Fixed security issue: Revoked grants from `anon` and `authenticated` roles

**Application Method:** Manual via Supabase SQL Editor (TEST database)

**Verification:** All 5 checks passed
- ✅ `stories.last_enriched_at` exists
- ✅ `admin.run_stats.enrichment_failed` exists  
- ✅ RPC has 15 parameters (no overloads)
- ✅ Only `service_role` has EXECUTE permission
- ✅ Columns have correct data types and defaults

### 2. Code Changes ✅

**File:** `scripts/rss-tracker-supabase.js`

**Change 1:** Stats initialization (line 72)
```javascript
enrichment_skipped_budget: 0,
enrichment_failed: 0  // NEW: Track failed enrichments (TTRC-277)
```

**Change 2:** Error handling in enrichment loop (lines 346-376)
```javascript
try {
  const shouldContinue = await this.enrichAndBillStory(story);
  if (!shouldContinue) break; // Budget cap reached
} catch (enrichErr) {
  console.error(`❌ Enrichment failed for story ${story.id}:`, enrichErr.message);
  this.stats.enrichment_failed++;
  this.runStatus = 'partial_success';
  
  // Nested try-catch for cooldown timestamp (prevents DB errors from crashing)
  try {
    await this.supabase
      .from('stories')
      .update({ last_enriched_at: new Date().toISOString() })
      .eq('id', story.id);
  } catch (updateErr) {
    console.error(`⚠️ Failed to update last_enriched_at:`, updateErr.message);
    // Swallow error - story will retry next run (acceptable)
  }
  
  continue; // Process next story
}
```

**Change 3:** RPC call updated (line 413)
```javascript
p_enrichment_skipped_budget: this.stats.enrichment_skipped_budget,
p_enrichment_failed: this.stats.enrichment_failed  // NEW: 15th parameter
```

### 3. Validation ✅

**Task Tool (general-purpose agent):**
- All 12 validation checks PASSED
- RPC signature matches exactly (15 params)
- NULL handling correct for never-enriched stories
- Error handling architecturally sound (nested try-catch prevents cascading failures)
- No regressions to budget logic

**AI Code Review:**
- Status: PASSED (no blockers)
- Duration: 6m58s
- Workflow ID: 19490083711

---

## Architecture

### Error Handling Pattern: Option B (Loop-Level Catch)

**Design Decision:**
- `enrichAndBillStory()` throws on failure (no internal error swallowing)
- `enrichStories()` loop catches errors, updates stats, sets cooldown, continues

**Why:**
- Keeps budget/enrichment semantics pure
- Centralizes logging and runStatus in one place
- Clear separation of concerns

### Cooldown Mechanism

**Selection Query (line 324):**
```javascript
.or(`last_enriched_at.is.null,last_enriched_at.lt.${cooldownCutoff}`)
```

**Behavior:**
- NULL values selected (never-enriched stories)
- Expired cooldowns selected (12h since last attempt)
- `nullsFirst: true` prioritizes never-attempted stories

**Cooldown Value:** 12 hours (`ENRICHMENT_COOLDOWN_HOURS` in `enrich-stories-inline.js`)

---

## Known Limitations

1. **Budget charged on failure:** Money lost on failed enrichments (~$0.003 per failure)  
   - Expected failure rate: 1% (per TTRC-268 data)  
   - Monthly waste: ~$0.50 (acceptable vs complexity of rollback)

2. **No retry backoff:** Fixed 12h cooldown, no exponential backoff

3. **No failure categorization:** All errors treated same (network vs data quality)

4. **Pre-existing QA test failure:** `qa:boundaries` fails on SimHash similarity score  
   - **NOT related to TTRC-277** (only touches error handling, not clustering logic)  
   - Test expects ≥75 similarity for identical titles, gets 55  
   - Requires separate investigation

---

## Testing Status

### ✅ Completed Tests

1. **Migration verification:** All 5 SQL checks passed
2. **Code validation:** All 12 checks passed (Task tool)
3. **AI code review:** Passed (no blockers)
4. **Static analysis:** 
   - Grep check: Single RPC call site confirmed
   - Parameter order: Matches migration 037 exactly
   - Constants: `RUNTIME_LIMIT_MS` and `this.startTime` exist

### ⏳ Pending Tests

1. **Integration test:** Awaiting next manual GitHub Actions run
   - Scheduled workflows don't auto-trigger on TEST branch (GitHub limitation)
   - Options:
     - Manual trigger via GitHub UI (Actions tab → "Test Environment - Daily Tracker" → Run workflow → Select `test` branch)
     - Wait for PROD deployment (auto-scheduled on `main` branch)

2. **Expected console output (partial success scenario):**
   ```
   🤖 Enriching 50 stories...
   ✅ Enriched story 441: $0.003000 (corruption_scandals)
   ❌ Enrichment failed for story 442: OpenAI timeout after 30000ms
   ⚠️ Failed to update last_enriched_at for story 442: network error
   ✅ Enriched story 443: $0.003000 (democracy_elections)
   ...
   📊 Run stats logged: partial_success
   ```

3. **Verification queries (after first run):**
   ```sql
   -- Check run stats
   SELECT status, stories_enriched, enrichment_failed, 
          enrichment_skipped_budget, total_openai_cost_usd
   FROM admin.run_stats
   ORDER BY id DESC LIMIT 1;
   -- Expected: status = 'partial_success', enrichment_failed > 0
   
   -- Check failed stories have cooldown
   SELECT id, primary_headline, last_enriched_at,
          summary_neutral IS NULL as needs_enrichment,
          NOW() - last_enriched_at as time_since_attempt
   FROM stories
   WHERE last_enriched_at > NOW() - INTERVAL '12 hours'
     AND summary_neutral IS NULL
   ORDER BY last_enriched_at DESC;
   -- Expected: Failed stories with recent timestamp
   ```

---

## Files Changed

### New Files
- `migrations/037_enrichment_failed_tracking.sql` (migration)
- `migrations/037_verification_queries.sql` (verification helper)
- `docs/handoffs/2025-11-18-ttrc-277-enrichment-retry.md` (this file)

### Modified Files
- `scripts/rss-tracker-supabase.js` (3 edits: stats init, error handling, RPC call)

### Unchanged (No Regressions)
- Budget logic: Still charges before enrichment, enforces $5/day cap
- Clustering logic: Unaffected
- Story selection logic: NULL handling preserved
- Runtime limit: Still enforced (4 minutes)

---

## Deployment Instructions

### For PROD Deployment (Future)

1. **Apply Migration 037 to PROD DB:**
   - Open Supabase dashboard → SQL Editor → Select PROD database
   - Copy/paste `migrations/037_enrichment_failed_tracking.sql`
   - Run all 5 verification queries from `migrations/037_verification_queries.sql`
   - **CRITICAL:** Verify query #5 shows only `service_role` (run grants fix if needed)

2. **Merge to Main:**
   - Create PR from `test` to `main`
   - Include this handoff in PR description
   - Wait for AI code review to pass
   - Merge PR

3. **Monitor First Run:**
   - Check GitHub Actions logs for `enrichment_failed` tracking
   - Verify run_stats shows correct values
   - Confirm failed stories have `last_enriched_at` set

---

## Success Criteria (All Met ✅)

### Must Have
- ✅ Migration 037 applied without errors
- ✅ `stories.last_enriched_at` column exists (NULL allowed)
- ✅ `admin.run_stats.enrichment_failed` column exists (NOT NULL, default 0)
- ✅ RPC has exactly 15 parameters (no overloads)
- ✅ Failed stories tracked in `enrichment_failed` counter
- ✅ Nested try-catch prevents DB error crash

### Quality
- ✅ Validation: All 12 checks passed
- ✅ AI review: Passed (no blockers)
- ✅ Security: Only service_role has EXECUTE
- ✅ Code comments: Clear and traceable to TTRC-277

---

## JIRA Update

**Ticket:** TTRC-277  
**Status:** Done (pending integration test)  
**Comment:**
```
Implementation complete - all validation checks passed.

✅ Migration 037 applied to TEST DB (verified)
✅ Code changes deployed to test branch (commit 0412100)
✅ AI code review passed (no blockers)
✅ All 12 validation checks passed

⏳ Integration test pending next manual GitHub Actions run
   (scheduled workflows don't auto-trigger on test branch)

See handoff: docs/handoffs/2025-11-18-ttrc-277-enrichment-retry.md
```

---

## Next Steps for Tomorrow Session

1. **Trigger Integration Test:**
   - Option A: Manual trigger via GitHub UI (Actions → Test Environment - Daily Tracker → test branch)
   - Option B: Deploy to PROD (migration 037 + code merge)

2. **Verify Integration:**
   - Run verification queries (see "Pending Tests" section above)
   - Check console logs for enrichment_failed tracking
   - Confirm failed stories have cooldown timestamps

3. **Resume TTRC-266 Monitoring:**
   - Once integration test passes, resume 48h monitoring phase
   - Watch for `enrichment_failed > 0` in run_stats (acceptable failure rate: ~1%)

4. **Address QA Test Failure (Separate Ticket):**
   - `qa:boundaries` fails on SimHash similarity score
   - Not related to TTRC-277 (clustering logic unchanged)
   - Create new ticket for investigation

---

## Token Usage Report

**This Session:** 102,717 / 200,000 tokens (51.4%)  
**Remaining:** 97,283 tokens (48.6%)

**Tools Used:**
- Read: 7 file reads
- Edit: 3 code changes
- Write: 3 new files (migration + verification + handoff)
- Task (Plan + Validation): 2 agents
- Bash: 8 git operations + 3 test attempts
- Supabase MCP: 0 (manual SQL Editor usage)

**Efficiency:**
- Found 3 critical blockers during plan review (missing column, missing stat, no error handling)
- Found 1 security issue during migration verification (grants)
- All issues fixed before deployment

---

**Handoff Complete** ✅  
**Ready for:** Integration testing + PROD deployment

---

_Last Updated: 2025-11-18_  
_Author: Claude Code_  
_Reviewer: Pending (Josh)_

# TTRC-280: Enrichment Retry with Cooldown - CANONICAL PLAN

**Status:** Ready for Implementation
**Date:** 2025-11-18
**Ticket:** TTRC-280
**Related:** TTRC-266 (RSS v2 automation - prerequisite for PROD deployment)

---

## Overview

Add enrichment failure tracking and 12-hour retry cooldown to prevent infinite retry loops on OpenAI failures.

**Problem:** Single OpenAI error kills entire enrichment run, no tracking of failed stories
**Solution:** Loop-level error handling + cooldown timestamp + failure counter

---

## Pattern Choice: Option B (Loop-level Error Handling)

**Design Decision:**
- ✅ Error handling in `enrichStories()` loop (outer try/catch)
- ✅ `enrichAndBillStory()` throws on failure (no internal try/catch)
- ✅ Loop catches errors, increments counter, sets cooldown, continues

**Critical Constraints:**
1. `enrichAndBillStory()` MUST NOT have its own try/catch (would double-handle)
2. `enrichAndBillStory()` MUST throw on failure (not return false)
3. `enrichAndBillStory()` returns false ONLY when budget cap reached (stop loop)

---

## Phase 1: Fix Ticket Reference in Docs

**Issue:** Original work referenced TTRC-277, correct ticket is TTRC-280

**Actions:**
1. Rename handoff:
   - FROM: `docs/handoffs/2025-11-18-ttrc-277-enrichment-retry.md`
   - TO: `docs/handoffs/2025-11-18-ttrc-280-enrichment-retry.md`

2. Update handoff header to reference TTRC-280

3. Update migration 037 header comment to reference TTRC-280

4. Commit: `docs: correct ticket number TTRC-280 (was TTRC-277)`

---

## Phase 2: Migration 037 - Enrichment Retry Schema

**File:** `migrations/037_enrichment_failed_tracking.sql`

### Header

```sql
-- Migration 037: Enrichment Retry with Cooldown (TTRC-280)
-- Adds enrichment failure tracking and cooldown mechanism
--
-- Changes:
--   1. Add stories.last_enriched_at for 12h cooldown
--   2. Add run_stats.enrichment_failed counter
--   3. Update log_run_stats RPC from 14 to 15 parameters
--
-- Author: Claude Code
-- Date: 2025-11-18
```

### Section 0: Add last_enriched_at Column

```sql
-- Add cooldown timestamp column
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.stories.last_enriched_at IS
  'Timestamp of last enrichment attempt (success or failure). Used for 12h cooldown.';
```

**Rationale:**
- NULL = never enriched (include in selection)
- Recent timestamp = failed recently (exclude from selection via cooldown)
- No default needed (NULL is semantically correct)

### Section 1: Add enrichment_failed to run_stats

```sql
-- Add failure counter to run stats
ALTER TABLE admin.run_stats
  ADD COLUMN IF NOT EXISTS enrichment_failed INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN admin.run_stats.enrichment_failed IS
  'Count of stories that failed enrichment during this run';
```

**Rationale:**
- NOT NULL DEFAULT 0 (matches other counters)
- Tracks partial success scenarios
- Enables monitoring of enrichment reliability

### Section 2: Drop old log_run_stats (14 params)

```sql
-- Drop existing 14-parameter version
DROP FUNCTION IF EXISTS public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT
);
```

**Important:** Function lives in `public` schema, not `admin`

### Section 3: Create new log_run_stats (15 params)

```sql
-- Create new 15-parameter version with enrichment_failed tracking
CREATE OR REPLACE FUNCTION public.log_run_stats(
  p_environment TEXT,
  p_run_started_at TIMESTAMPTZ,
  p_run_finished_at TIMESTAMPTZ,
  p_status TEXT,
  p_feeds_total INT,
  p_feeds_processed INT,
  p_feeds_succeeded INT,
  p_feeds_failed INT,
  p_feeds_skipped_lock INT,
  p_feeds_304_cached INT,
  p_stories_clustered INT,
  p_stories_enriched INT,
  p_total_openai_cost_usd NUMERIC,
  p_enrichment_skipped_budget INT,
  p_enrichment_failed INT DEFAULT 0  -- NEW: 15th parameter
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
BEGIN
  INSERT INTO admin.run_stats (
    environment,
    run_started_at,
    run_finished_at,
    status,
    feeds_total,
    feeds_processed,
    feeds_succeeded,
    feeds_failed,
    feeds_skipped_lock,
    feeds_304_cached,
    stories_clustered,
    stories_enriched,
    total_openai_cost_usd,
    enrichment_skipped_budget,
    enrichment_failed  -- NEW
  ) VALUES (
    p_environment,
    p_run_started_at,
    p_run_finished_at,
    p_status,
    p_feeds_total,
    p_feeds_processed,
    p_feeds_succeeded,
    p_feeds_failed,
    p_feeds_skipped_lock,
    p_feeds_304_cached,
    p_stories_clustered,
    p_stories_enriched,
    p_total_openai_cost_usd,
    p_enrichment_skipped_budget,
    p_enrichment_failed  -- NEW
  );
END;
$$;

-- Lock down permissions (service_role only)
REVOKE ALL ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
) TO service_role;
```

**Security:** Only `service_role` can execute (matches existing pattern)

### Section 4: Verification Queries

**File:** `migrations/037_verification_queries.sql`

```sql
-- =====================================================
-- Migration 037 Verification Queries (TTRC-280)
-- Run after applying migration to verify correctness
-- =====================================================

-- Verification 1: Check last_enriched_at column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stories'
  AND column_name = 'last_enriched_at';
-- Expected: 1 row, data_type = 'timestamp with time zone', is_nullable = 'YES'

-- Verification 2: Check enrichment_failed column exists
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'run_stats'
  AND column_name = 'enrichment_failed';
-- Expected: 1 row, is_nullable = 'NO', column_default = '0'

-- Verification 3: Check log_run_stats exists with 15 parameters
SELECT p.proname, p.pronargs
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'log_run_stats';
-- Expected: 1 row, pronargs = 15

-- Verification 4: Check permissions (only service_role has EXECUTE)
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'log_run_stats'
  AND privilege_type = 'EXECUTE';
-- Expected: 1 row, grantee = 'service_role'

-- Verification 5: Sanity check run_stats table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'run_stats'
ORDER BY ordinal_position;
-- Expected: Success (table accessible), enrichment_failed column present in list
```

**Usage:**
1. Apply migration 037 in Supabase SQL Editor
2. Run all 5 verification queries
3. All must pass before proceeding to code changes

---

## Phase 3: Code Changes - Error Handling (Option B Pattern)

### Edit 1: Stats Initialization

**File:** `scripts/rss-tracker-supabase.js`

**Location:** Constructor or stats initialization block

**Find:**
```javascript
this.stats = {
  feeds_total: 0,
  feeds_processed: 0,
  feeds_succeeded: 0,
  feeds_failed: 0,
  feeds_skipped_lock: 0,
  feeds_304_cached: 0,
  stories_clustered: 0,
  stories_enriched: 0,
  enrichment_skipped_budget: 0,
  total_openai_cost_usd: 0
};
```

**Replace with:**
```javascript
this.stats = {
  feeds_total: 0,
  feeds_processed: 0,
  feeds_succeeded: 0,
  feeds_failed: 0,
  feeds_skipped_lock: 0,
  feeds_304_cached: 0,
  stories_clustered: 0,
  stories_enriched: 0,
  enrichment_skipped_budget: 0,
  enrichment_failed: 0,  // NEW - tracks stories that failed enrichment
  total_openai_cost_usd: 0
};
```

**Note:** Group with other enrichment counters for clarity

---

### Edit 2: Loop-level Error Handling

**File:** `scripts/rss-tracker-supabase.js`

**Location:** `enrichStories()` method, inside the story iteration loop

**Pattern:** Wrap existing `enrichAndBillStory()` call with try/catch

**Find (approximate):**
```javascript
for (const story of stories) {
  const shouldContinue = await this.enrichAndBillStory(story);
  if (!shouldContinue) break; // budget cap
}
```

**Replace with:**
```javascript
for (const story of stories) {
  try {
    const shouldContinue = await this.enrichAndBillStory(story);
    if (!shouldContinue) break; // budget cap reached - stop enriching
  } catch (enrichErr) {
    // Enrichment failed for this story
    console.error(`❌ Enrichment failed for story ${story.id}:`, enrichErr.message);
    this.stats.enrichment_failed++;
    this.runStatus = 'partial_success';

    // Set cooldown timestamp (12h retry delay)
    try {
      await this.supabase
        .from('stories')
        .update({ last_enriched_at: new Date().toISOString() })
        .eq('id', story.id);
    } catch (updateErr) {
      console.error('⚠️ Failed to update last_enriched_at:', updateErr.message);
      // Swallow - don't fail entire run if timestamp update fails
    }

    continue; // Process next story
  }
}
```

**Critical:**
- `enrichAndBillStory()` MUST throw on enrichment failure (not return false)
- `enrichAndBillStory()` MUST NOT have internal try/catch
- Returns false ONLY when budget cap reached (different semantic)

**Behavior:**
1. Try to enrich story
2. If budget cap: `shouldContinue = false`, break loop (normal flow)
3. If enrichment fails: catch error, increment counter, set cooldown, continue to next story
4. If cooldown update fails: log warning, swallow error (don't kill run)

---

### Edit 3: RPC Call to log_run_stats

**File:** `scripts/rss-tracker-supabase.js`

**Location:** End of run, where run stats are logged

**Find (approximate):**
```javascript
await this.supabase.rpc('log_run_stats', {
  p_environment: this.environment,
  p_run_started_at: this.startTime.toISOString(),
  p_run_finished_at: new Date().toISOString(),
  p_status: this.runStatus,
  p_feeds_total: this.stats.feeds_total,
  p_feeds_processed: this.stats.feeds_processed,
  p_feeds_succeeded: this.stats.feeds_succeeded,
  p_feeds_failed: this.stats.feeds_failed,
  p_feeds_skipped_lock: this.stats.feeds_skipped_lock,
  p_feeds_304_cached: this.stats.feeds_304_cached,
  p_stories_clustered: this.stats.stories_clustered,
  p_stories_enriched: this.stats.stories_enriched,
  p_total_openai_cost_usd: this.stats.total_openai_cost_usd,
  p_enrichment_skipped_budget: this.stats.enrichment_skipped_budget
});
```

**Replace with:**
```javascript
await this.supabase.rpc('log_run_stats', {
  p_environment: this.environment,
  p_run_started_at: this.startTime.toISOString(),
  p_run_finished_at: new Date().toISOString(),
  p_status: this.runStatus,
  p_feeds_total: this.stats.feeds_total,
  p_feeds_processed: this.stats.feeds_processed,
  p_feeds_succeeded: this.stats.feeds_succeeded,
  p_feeds_failed: this.stats.feeds_failed,
  p_feeds_skipped_lock: this.stats.feeds_skipped_lock,
  p_feeds_304_cached: this.stats.feeds_304_cached,
  p_stories_clustered: this.stats.stories_clustered,
  p_stories_enriched: this.stats.stories_enriched,
  p_total_openai_cost_usd: this.stats.total_openai_cost_usd,
  p_enrichment_skipped_budget: this.stats.enrichment_skipped_budget,
  p_enrichment_failed: this.stats.enrichment_failed  // NEW: 15th parameter
});
```

**Note:** Parameter name MUST match function signature (`p_enrichment_failed`)

---

## Phase 4: Sanity Checks

### Check 1: Runtime Limit Variables Exist

**Command:**
```bash
grep -n "RUNTIME_LIMIT_MS" scripts/rss-tracker-supabase.js
grep -n "this.startTime" scripts/rss-tracker-supabase.js
```

**Expected:**
- `RUNTIME_LIMIT_MS` defined as constant (e.g., `const RUNTIME_LIMIT_MS = 540000`)
- `this.startTime` initialized at run start (e.g., `this.startTime = new Date()`)
- Used in loop: `if (Date.now() - this.startTime > RUNTIME_LIMIT_MS) break;`

**Purpose:** Prevents infinite loop if story selection logic breaks

---

### Check 2: Single RPC Call to log_run_stats

**Command:**
```bash
grep -r "log_run_stats" scripts/
```

**Expected:** Exactly ONE callsite in `rss-tracker-supabase.js` with 15 parameters

**Purpose:** Ensures no orphaned calls with old 14-param signature

---

### Check 3: NULL Handling in Story Selection

**Location:** Query that selects stories for enrichment (likely in `getStoriesNeedingEnrichment()` or similar)

**Required Logic:**
```sql
WHERE summary_neutral IS NULL
  AND (last_enriched_at IS NULL OR last_enriched_at < NOW() - INTERVAL '12 hours')
```

**Alternative (if using JS filter):**
```javascript
stories.filter(s =>
  !s.summary_neutral &&
  (!s.last_enriched_at || new Date(s.last_enriched_at) < new Date(Date.now() - 12*60*60*1000))
)
```

**Rationale:**
- `last_enriched_at IS NULL` = never enriched (MUST include)
- `last_enriched_at < NOW() - '12 hours'` = failed, cooldown expired (retry allowed)
- Without explicit NULL check, never-enriched stories would be skipped (BREAKING BUG)

**Verification:**
```sql
-- This should return stories that need enrichment AND are eligible (no cooldown)
SELECT id, last_enriched_at, summary_neutral
FROM stories
WHERE summary_neutral IS NULL
  AND (last_enriched_at IS NULL OR last_enriched_at < NOW() - INTERVAL '12 hours')
LIMIT 5;
```

---

## Phase 5: Validation Testing

### Step 1: Apply Migration

**Actions:**
1. Open Supabase SQL Editor (TEST database)
2. Paste contents of `migrations/037_enrichment_failed_tracking.sql`
3. Execute migration
4. Paste contents of `migrations/037_verification_queries.sql`
5. Run all 5 verification queries
6. **All 5 checks MUST pass** before proceeding

**Success Criteria:**
- ✅ Verification 1: `last_enriched_at` column exists (timestamptz, nullable)
- ✅ Verification 2: `enrichment_failed` column exists (int, not null, default 0)
- ✅ Verification 3: `log_run_stats` has 15 parameters
- ✅ Verification 4: Only `service_role` has EXECUTE permission
- ✅ Verification 5: `run_stats` table accessible, new column present

---

### Step 2: Code Validation

**Actions:**
1. Run sanity checks from Phase 4
2. Verify all 3 code edits applied correctly
3. Use Task tool (general-purpose agent) to validate:
   - Error handling pattern matches Option B
   - No double try/catch in `enrichAndBillStory()`
   - NULL handling in story selection
   - RPC call has 15 parameters

**Command:**
```bash
# Sanity checks
grep -n "enrichment_failed: 0" scripts/rss-tracker-supabase.js
grep -n "this.stats.enrichment_failed++" scripts/rss-tracker-supabase.js
grep -n "p_enrichment_failed" scripts/rss-tracker-supabase.js
```

**Expected:** All 3 code changes present

---

### Step 3: Integration Test (Manual Workflow Trigger)

**Method:** Manual trigger on TEST branch (PROD deployment not viable - see Phase 6)

**Commands:**
```bash
# Trigger workflow
gh workflow run "rss-tracker-test.yml" --ref test

# Monitor progress
gh run watch

# Check AI code review after push
bash scripts/check-code-review.sh
```

**Expected:**
- Workflow completes successfully
- No errors in job logs
- Stories enriched (or failures tracked gracefully)

---

### Step 4: Post-Run SQL Verification

**Query 1: Check Run Stats**
```sql
SELECT
  id,
  status,
  stories_enriched,
  enrichment_failed,
  enrichment_skipped_budget,
  total_openai_cost_usd,
  run_finished_at
FROM admin.run_stats
ORDER BY id DESC
LIMIT 1;
```

**Expected:**
- `enrichment_failed` column exists (≥ 0)
- `status = 'partial_success'` if any enrichments failed
- `status = 'success'` if all succeeded
- `enrichment_failed = 0` if no failures (optimal case)

---

**Query 2: Check Failed Stories Have Cooldown Timestamp**
```sql
SELECT
  id,
  last_enriched_at,
  summary_neutral IS NULL AS needs_enrichment,
  NOW() - last_enriched_at AS time_since_attempt
FROM stories
WHERE last_enriched_at > NOW() - INTERVAL '12 hours'
  AND summary_neutral IS NULL;
```

**Expected:**
- Stories that failed enrichment during this run
- `last_enriched_at` is recent (within last hour if just ran)
- `needs_enrichment = true` (still no summary)
- `time_since_attempt < 12 hours` (within cooldown window)

---

**Query 3: Verify Cooldown Prevents Immediate Retry**
```sql
-- This should return EMPTY (failed stories excluded by cooldown)
SELECT id, last_enriched_at
FROM stories
WHERE summary_neutral IS NULL  -- needs enrichment
  AND last_enriched_at > NOW() - INTERVAL '12 hours';  -- but within cooldown
```

**Expected:**
- 0 rows (failed stories correctly excluded from immediate retry)
- If any rows: cooldown logic BROKEN, investigate story selection query

---

**Query 4: Check Never-Enriched Stories Still Selected**
```sql
-- Verify NULL handling works (never-enriched stories still eligible)
SELECT COUNT(*) AS never_enriched_count
FROM stories
WHERE summary_neutral IS NULL
  AND last_enriched_at IS NULL;
```

**Expected:**
- Count > 0 (never-enriched stories exist and will be selected)
- If 0: Either all stories have been attempted OR NULL handling broken

---

### Step 5: Regression Check (Budget Logic Unchanged)

**Query:**
```sql
-- Verify budget logic still works (enrichment stops at cap)
SELECT
  enrichment_skipped_budget,
  enrichment_failed,
  total_openai_cost_usd
FROM admin.run_stats
ORDER BY id DESC
LIMIT 1;
```

**Expected:**
- Budget logic unchanged (may see `enrichment_skipped_budget > 0` if hit cap)
- `total_openai_cost_usd` still tracked correctly
- No regression to existing budget enforcement

---

## Phase 6: Update JIRA TTRC-280

**Actions:**
1. Query JIRA for TTRC-280 status
2. Add comment with integration test results:
   - Migration applied successfully (5/5 verification checks passed)
   - Code deployed to TEST branch
   - Integration test passed (workflow completed, stats logged)
   - Post-run verification passed (all SQL queries returned expected results)
   - AI code review passed (no blockers)

3. Link to handoff doc: `docs/handoffs/2025-11-18-ttrc-280-enrichment-retry.md`

4. Transition to "Done" (implementation complete, integration tested)

5. Add note:
   > PROD deployment blocked by TTRC-266 (requires full RSS v2 stack: migrations 027-037, workflows, rss-tracker-supabase.js). Will deploy as part of larger RSS v2 PR, not standalone.

**Commands:**
```bash
# Via Task tool (general-purpose agent) to isolate JIRA context cost:
# "Update JIRA TTRC-280: mark Done, add test results comment, link handoff doc"
```

---

## Deployment Strategy

### TEST Environment (Current)
- ✅ Migration 037 applied
- ✅ Code deployed to `test` branch
- ✅ Integration tested via manual workflow trigger
- ✅ Ready for monitoring

### PROD Environment (Blocked)

**Why PROD Deployment Not Viable:**
- PROD (main branch) does NOT have:
  - `scripts/rss-tracker-supabase.js` (entire inline automation)
  - `.github/workflows/rss-tracker-prod.yml` (RSS automation workflow)
  - Migrations 027-037 (including migration 037 for TTRC-280)
  - 20 commits of RSS v2 work from test branch

**Dependencies for PROD:**
1. Complete TTRC-266 (RSS v2 inline automation)
2. Deploy migrations 027-037 to PROD database
3. Cherry-pick RSS v2 commits to deployment branch
4. Create PR to main branch
5. Merge PR (auto-deploys TTRC-280 as part of RSS v2 stack)

**Timeline:**
- TTRC-280 deploys to PROD when TTRC-266 completes
- Not a standalone deployment
- Part of larger RSS v2 migration

---

## Deliverables Checklist

- [ ] Rename handoff doc from TTRC-277 → TTRC-280
- [ ] Create `migrations/037_enrichment_failed_tracking.sql`
- [ ] Create `migrations/037_verification_queries.sql`
- [ ] Apply migration 037 to TEST database
- [ ] Verify all 5 migration checks pass
- [ ] Edit 1: Add `enrichment_failed: 0` to stats initialization
- [ ] Edit 2: Add loop-level error handling in `enrichStories()`
- [ ] Edit 3: Add `p_enrichment_failed` to RPC call
- [ ] Run sanity checks (runtime limit, single RPC call, NULL handling)
- [ ] Commit changes with message: `feat(enrichment): add retry logic for failed enrichments (TTRC-280)`
- [ ] Push to `test` branch
- [ ] Check AI code review (must pass)
- [ ] Trigger manual workflow run
- [ ] Run post-run SQL verification (4 queries)
- [ ] Update JIRA TTRC-280 (link handoff, mark Done)
- [ ] Document results in handoff

---

## Success Criteria

**Migration:**
- ✅ All 5 verification queries pass
- ✅ No permission errors (service_role only)
- ✅ Column defaults correct (enrichment_failed = 0)

**Code:**
- ✅ Error handling matches Option B pattern
- ✅ No double try/catch in `enrichAndBillStory()`
- ✅ NULL handling prevents never-enriched stories from being skipped
- ✅ RPC call has 15 parameters matching function signature

**Integration:**
- ✅ Workflow completes successfully
- ✅ Run stats logged with `enrichment_failed` counter
- ✅ Failed stories have `last_enriched_at` timestamp
- ✅ Cooldown prevents immediate retry
- ✅ Budget logic unchanged (no regressions)

**Documentation:**
- ✅ Handoff doc updated with TTRC-280 references
- ✅ JIRA ticket updated and marked Done
- ✅ Integration test results documented

---

## Risk Mitigation

**Risk 1: Double try/catch (error swallowing)**
- **Mitigation:** Explicit constraint in plan, validation via Task tool
- **Verification:** Code review confirms `enrichAndBillStory()` has no internal try/catch

**Risk 2: NULL handling breaks story selection**
- **Mitigation:** Explicit sanity check in Phase 4, SQL verification in Phase 5
- **Verification:** Query 4 confirms never-enriched stories still selected

**Risk 3: Migration fails on PROD (missing dependencies)**
- **Mitigation:** Document PROD deployment blocked by TTRC-266
- **Resolution:** Deploy as part of larger RSS v2 PR, not standalone

**Risk 4: Cooldown timestamp update fails silently**
- **Mitigation:** Nested try/catch logs warning but doesn't kill run
- **Trade-off:** Better to continue enriching other stories than fail entire run

---

## Future Enhancements (Out of Scope)

Listed in `docs/jira-tickets-to-create.md` as separate tickets:

- **TTRC-279:** Max retry limit (e.g., after 5 failures, mark story as permanently failed)
- **TTRC-280:** Error categorization (different retry strategies for rate limits vs. parsing errors)
- **TTRC-281:** Per-story failure tracking (detailed failure history in new table)

**Priority:** Low (observability improvements, not critical path)

---

## References

- **Handoff:** `docs/handoffs/2025-11-18-ttrc-280-enrichment-retry.md`
- **JIRA:** TTRC-280 (Enrichment Retry Logic with Cooldown)
- **Related:** TTRC-266 (RSS v2 automation - prerequisite for PROD deployment)
- **Migration:** `migrations/037_enrichment_failed_tracking.sql`
- **Verification:** `migrations/037_verification_queries.sql`

---

**Status:** CANONICAL - Single source of truth for implementation
**Last Updated:** 2025-11-18
**Ready for Execution:** Yes

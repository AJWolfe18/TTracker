# TTRC-278/279: Migration 038 Testing & Rollout Runbook

**Status**: Ready to Execute (Code Complete, Migration NOT Applied)
**Date**: 2025-11-24
**Tickets**: TTRC-278 (Error Categorization), TTRC-279 (Per-Story Failure Tracking)
**Branch**: `test` (commit 6c8c02c)
**AI Code Review**: ✅ PASSED

---

## 📋 Current Status

### ✅ What's Done
- ✅ Migration 038 file created (`migrations/038_smart_error_tracking.sql`)
- ✅ Worker code updated (`scripts/job-queue-worker.js`)
- ✅ Observability queries created (`docs/sql-queries/error-tracking.sql`)
- ✅ Code committed to test branch (6c8c02c)
- ✅ AI code review passed
- ✅ Subagent validation passed (3 critical bugs fixed)
- ✅ Comprehensive handoff doc created

### ⚠️ What's Pending
- ⚠️ **Migration 038 NOT applied to database** (CRITICAL - must do first)
- ⚠️ JIRA tickets need status update (TTRC-278/279 → Done)
- ⚠️ Manual testing not done
- ⚠️ 24h monitoring not done
- ⚠️ PR to main not created

### 🚨 CRITICAL WARNING
**The worker code expects the database schema to exist.** If you restart the worker before applying Migration 038, enrichment jobs will fail with "column does not exist" errors. The migration MUST be applied before the worker uses the new code.

---

## 🎯 Execution Plan

### Phase 0: Pre-flight Checks (5-10 minutes - YOU do this)

Before applying the migration, establish a clean baseline to catch any issues early.

#### Step 0.1: Verify Git Branch
```bash
git branch --show-current
# Expected output: test
```

**❌ If not on test branch**: Switch with `git checkout test`

#### Step 0.2: Confirm Migration Not Yet Applied
Run this in Supabase SQL Editor:

```sql
-- Check if migration 038 already applied
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'stories'
  AND column_name = 'enrichment_status';

-- Expected: 0 rows (migration NOT applied)
-- If returns 1 row: Migration already applied, skip to Phase 2 verification
```

#### Step 0.3: Worker Deployment Order (Knowledge Check)
**CRITICAL**: New worker code MUST NOT be deployed before Migration 038 is applied.

The worker code in commit 6c8c02c calls:
- `public.increment_enrichment_failure(...)`
- `public.log_enrichment_error(...)`

These functions don't exist until Migration 038 is applied. If the new worker runs first, enrichment jobs will fail with "function does not exist" errors.

**For TEST**: Confirm you have NOT manually updated the worker process yet. The migration is additive and safe to apply with the old worker running.

#### Step 0.4: Establish QA Baseline
```bash
npm run qa:smoke

# Expected output:
# - 1 known failure: "enqueue-idempotency" test (pre-existing, unrelated)
# - All other tests pass
#
# ❌ If additional tests fail: STOP and investigate before proceeding
# Any new failures indicate a problem that could be masked by the migration
```

**✅ Phase 0 Success Criteria**:
- On test branch
- Migration not yet applied
- QA shows only 1 known failure

---

### Phase 1: Apply Migration 038 (5-10 minutes - YOU do this)

#### Step 1.1: Open Supabase SQL Editor
1. Go to: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new
2. Copy **entire contents** of `migrations/038_smart_error_tracking.sql` (211 lines)
3. Paste into SQL Editor
4. Click **"Run"** button
5. Wait for "Success. No rows returned" message

#### Step 1.2: Verify Migration Applied
Run these verification queries in Supabase SQL Editor:

**Query 1: Verify Stories Table Columns (expect 4 rows)**
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'stories'
  AND column_name IN (
    'enrichment_status',
    'enrichment_failure_count',
    'last_error_category',
    'last_error_message'
  )
ORDER BY column_name;

-- Expected output (4 rows):
-- enrichment_failure_count | integer | 0
-- enrichment_status | text | NULL
-- last_error_category | text | NULL
-- last_error_message | text | NULL
```

**Query 2: Verify Error Log Table (expect 1 row)**
```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'admin'
  AND table_name = 'enrichment_error_log';

-- Expected output:
-- admin | enrichment_error_log
```

**Query 3: Verify Error Category Constraint**
```sql
SELECT conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE n.nspname = 'admin'
  AND t.relname = 'enrichment_error_log'
  AND conname = 'chk_enrichment_error_category';

-- Expected: 1 row showing CHECK constraint with 9 categories
-- (rate_limit, budget_exceeded, network_timeout, json_parse,
--  content_policy, token_limit, infra_auth, invalid_request, unknown)
```

**✅ Success Criteria**: All 3 queries return expected results

**❌ If queries fail**:
- Check Supabase SQL Editor for error messages
- If partial application suspected, re-run entire Migration 038 (safe due to IF NOT EXISTS)
- Do NOT proceed to Phase 2 until all verifications pass

**🔄 Recovery from Partial Application**: If columns exist but functions don't (or vice versa), simply re-run the entire `migrations/038_smart_error_tracking.sql` file. All statements use `IF NOT EXISTS` or `CREATE OR REPLACE`, making re-runs safe.

---

### Phase 2: Database-Level Unit Tests (5-10 minutes - YOU do this)

This phase validates that both RPCs (`increment_enrichment_failure` and `log_enrichment_error`) work correctly.

#### Option A: Single-Paste Automated Test (RECOMMENDED)

Paste this entire DO-block into Supabase SQL Editor and run once. If it completes without error, all RPC paths behave correctly. Any `RAISE EXCEPTION` indicates a logic bug.

```sql
DO $
DECLARE
  v_story_id BIGINT;
  v_count INT;
  v_status TEXT;
  v_cat TEXT;
  v_msg TEXT;
  v_errors INT;
BEGIN
  --------------------------------------------------------------------
  -- 0. Create synthetic test story
  --------------------------------------------------------------------
  INSERT INTO public.stories (
    story_hash,
    primary_headline,
    primary_source,
    primary_source_url
  )
  VALUES (
    'test-mig-038-' || md5(random()::text || clock_timestamp()::text),
    'TEST – Migration 038 Unit Test',
    'TEST',
    'https://test.local/migration-038'
  )
  RETURNING id INTO v_story_id;

  RAISE NOTICE 'Using story id % for Migration 038 tests', v_story_id;

  --------------------------------------------------------------------
  -- 1. Budget error path: should NOT increment failure_count or status
  --------------------------------------------------------------------
  PERFORM *
  FROM public.increment_enrichment_failure(
    p_story_id        := v_story_id,
    p_is_budget_error := TRUE,
    p_max_retries     := 3,
    p_error_category  := 'budget_exceeded',
    p_error_message   := 'TEST budget exceeded – should NOT increment counter'
  );

  SELECT
    enrichment_failure_count,
    enrichment_status,
    last_error_category,
    last_error_message
  INTO
    v_count,
    v_status,
    v_cat,
    v_msg
  FROM public.stories
  WHERE id = v_story_id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'Budget error: expected failure_count = 0, got %', v_count;
  END IF;

  IF v_status IS NOT NULL THEN
    RAISE EXCEPTION
      'Budget error: expected status = NULL, got %', v_status;
  END IF;

  IF v_cat <> 'budget_exceeded' THEN
    RAISE EXCEPTION
      'Budget error: expected last_error_category = budget_exceeded, got %', v_cat;
  END IF;

  PERFORM public.log_enrichment_error(
    p_story_id       := v_story_id,
    p_error_category := 'budget_exceeded',
    p_error_message  := 'TEST budget error log',
    p_retry_count    := 0,
    p_job_id         := 123456
  );

  SELECT COUNT(*)
  INTO v_errors
  FROM admin.enrichment_error_log
  WHERE story_id = v_story_id
    AND error_category = 'budget_exceeded';

  IF v_errors < 1 THEN
    RAISE EXCEPTION
      'Budget error log: expected at least 1 log row, found %', v_errors;
  END IF;

  RAISE NOTICE '✅ Budget error path OK (counter stayed 0, logged correctly)';

  --------------------------------------------------------------------
  -- 2. Normal failure path: below max_retries → pending + count++
  --------------------------------------------------------------------
  UPDATE public.stories
  SET
    enrichment_status         = NULL,
    enrichment_failure_count  = 0,
    last_error_category       = NULL,
    last_error_message        = NULL
  WHERE id = v_story_id;

  PERFORM *
  FROM public.increment_enrichment_failure(
    p_story_id        := v_story_id,
    p_is_budget_error := FALSE,
    p_max_retries     := 3,
    p_error_category  := 'json_parse',
    p_error_message   := 'TEST JSON parse error'
  );

  SELECT
    enrichment_failure_count,
    enrichment_status,
    last_error_category,
    last_error_message
  INTO
    v_count,
    v_status,
    v_cat,
    v_msg
  FROM public.stories
  WHERE id = v_story_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Normal failure (below max): expected failure_count = 1, got %', v_count;
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION
      'Normal failure (below max): expected status = pending, got %', v_status;
  END IF;

  IF v_cat <> 'json_parse' THEN
    RAISE EXCEPTION
      'Normal failure (below max): expected last_error_category = json_parse, got %', v_cat;
  END IF;

  RAISE NOTICE '✅ Normal failure path OK (counter incremented, status = pending)';

  --------------------------------------------------------------------
  -- 3. Permanent failure: at/above max_retries → permanent_failure
  --------------------------------------------------------------------
  PERFORM *
  FROM public.increment_enrichment_failure(
    p_story_id        := v_story_id,
    p_is_budget_error := FALSE,
    p_max_retries     := 3,
    p_error_category  := 'content_policy',
    p_error_message   := 'TEST attempt 2'
  );

  PERFORM *
  FROM public.increment_enrichment_failure(
    p_story_id        := v_story_id,
    p_is_budget_error := FALSE,
    p_max_retries     := 3,
    p_error_category  := 'content_policy',
    p_error_message   := 'TEST attempt 3'
  );

  SELECT
    enrichment_failure_count,
    enrichment_status
  INTO
    v_count,
    v_status
  FROM public.stories
  WHERE id = v_story_id;

  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'Permanent failure: expected failure_count = 3, got %', v_count;
  END IF;

  IF v_status <> 'permanent_failure' THEN
    RAISE EXCEPTION
      'Permanent failure: expected status = permanent_failure, got %', v_status;
  END IF;

  RAISE NOTICE '✅ Permanent failure path OK (status = permanent_failure after 3 tries)';

  --------------------------------------------------------------------
  -- 4. Cleanup test story
  --------------------------------------------------------------------
  DELETE FROM public.stories WHERE id = v_story_id;
  RAISE NOTICE '✅ Test story cleaned up (id %)', v_story_id;

  RAISE NOTICE '';
  RAISE NOTICE '==============================================';
  RAISE NOTICE '✅ ALL UNIT TESTS PASSED';
  RAISE NOTICE '==============================================';

END $;
```

**Expected Output**:
- 5 `NOTICE` messages showing each test passed
- Final "ALL UNIT TESTS PASSED" message
- No errors or exceptions

**✅ Success Criteria**: Script completes with "ALL UNIT TESTS PASSED" message

**❌ If script fails**:
- Read the EXCEPTION message to identify which assertion failed
- Check Migration 038 was applied correctly (re-run Phase 1.2 verification)
- Do NOT proceed to Phase 3 until all tests pass

---

#### Option B: Manual Step-by-Step Tests (For Debugging)

If Option A fails and you need to debug, use these individual tests:

#### Test 2.1: Create Test Story

```sql
-- Create synthetic test story
INSERT INTO public.stories (
  primary_headline,
  story_hash,
  enrichment_status,
  enrichment_failure_count,
  created_at,
  last_updated_at
)
VALUES (
  'TEST - Migration 038 Unit Test',
  'test-migration-038-' || floor(random() * 1000000),
  NULL,
  0,
  NOW(),
  NOW()
)
RETURNING id;
```

**Record the returned `id` as `:test_story_id` for use in tests below.**

---

#### Test 2.2: Budget Error Path (Counter Should NOT Increment)

```sql
-- Call RPC with budget error flag
SELECT *
FROM public.increment_enrichment_failure(
  p_story_id := :test_story_id,  -- REPLACE with actual ID from 2.1
  p_is_budget_error := TRUE,
  p_max_retries := 3,
  p_error_category := 'budget_exceeded',
  p_error_message := 'TEST budget exceeded - should NOT increment counter'
);

-- Verify state
SELECT
  id,
  enrichment_status,
  enrichment_failure_count,
  last_error_category,
  last_error_message,
  last_enriched_at
FROM public.stories
WHERE id = :test_story_id;
```

**Expected Results:**
- `enrichment_failure_count` = **0** (NOT incremented)
- `enrichment_status` = **NULL** (unchanged)
- `last_error_category` = `'budget_exceeded'`
- `last_error_message` = `'TEST budget exceeded...'`
- `last_enriched_at` = recent timestamp (updated)

**✅ PASS if counter stayed at 0**
**❌ FAIL if counter incremented to 1** (budget errors should NOT count)

---

#### Test 2.3: Normal Failure Path (Counter SHOULD Increment)

```sql
-- Reset test story
UPDATE public.stories
SET
  enrichment_status = NULL,
  enrichment_failure_count = 0,
  last_error_category = NULL,
  last_error_message = NULL,
  last_enriched_at = NULL
WHERE id = :test_story_id;

-- Call RPC with normal error
SELECT *
FROM public.increment_enrichment_failure(
  p_story_id := :test_story_id,  -- REPLACE with actual ID
  p_is_budget_error := FALSE,
  p_max_retries := 3,
  p_error_category := 'json_parse',
  p_error_message := 'TEST JSON parse error'
);

-- Verify state
SELECT
  enrichment_status,
  enrichment_failure_count,
  last_error_category,
  last_error_message
FROM public.stories
WHERE id = :test_story_id;
```

**Expected Results:**
- `enrichment_failure_count` = **1** (incremented)
- `enrichment_status` = `'pending'` (below max_retries)
- `last_error_category` = `'json_parse'`
- `last_error_message` = `'TEST JSON parse error'`

**✅ PASS if counter incremented to 1 and status = 'pending'**

---

#### Test 2.4: Permanent Failure at Max Retries

```sql
-- Call RPC 2 more times (total of 3 failures)
SELECT *
FROM public.increment_enrichment_failure(
  p_story_id := :test_story_id,
  p_is_budget_error := FALSE,
  p_max_retries := 3,
  p_error_category := 'content_policy',
  p_error_message := 'TEST attempt 2'
);

SELECT *
FROM public.increment_enrichment_failure(
  p_story_id := :test_story_id,
  p_is_budget_error := FALSE,
  p_max_retries := 3,
  p_error_category := 'content_policy',
  p_error_message := 'TEST attempt 3'
);

-- Verify final state
SELECT
  enrichment_status,
  enrichment_failure_count,
  last_error_category
FROM public.stories
WHERE id = :test_story_id;
```

**Expected Results:**
- `enrichment_failure_count` = **3** (hit max_retries)
- `enrichment_status` = `'permanent_failure'`
- `last_error_category` = `'content_policy'`

**✅ PASS if status = 'permanent_failure' after 3 failures**

---

#### Test 2.5: Error Log Verification

```sql
-- Log an error
SELECT public.log_enrichment_error(
  p_story_id := :test_story_id,
  p_error_category := 'test_category',
  p_error_message := 'TEST error log message',
  p_retry_count := 1,
  p_job_id := 99999
);

-- Verify log entry exists
SELECT
  story_id,
  error_category,
  error_message,
  retry_count,
  job_id,
  occurred_at
FROM admin.enrichment_error_log
WHERE story_id = :test_story_id
ORDER BY occurred_at DESC
LIMIT 5;
```

**Expected Results:**
- At least 1 row returned
- `error_category` = `'test_category'`
- `error_message` = `'TEST error log message'`
- `retry_count` = 1
- `job_id` = 99999

**✅ PASS if error log entry created successfully**

---

#### Test 2.6: Cleanup Test Story

```sql
-- Delete test story (cascades to error logs)
DELETE FROM public.stories
WHERE id = :test_story_id;

-- Verify deleted
SELECT COUNT(*) FROM public.stories WHERE id = :test_story_id;
-- Should return 0

SELECT COUNT(*) FROM admin.enrichment_error_log WHERE story_id = :test_story_id;
-- Should return 0 (cascaded delete)
```

---

### Phase 3: 24h Follow-up Checks (10-15 minutes - YOU do this)

After Phase 2 passes, let the system run naturally with real RSS traffic for 24 hours. Then run these health check queries once.

**Timing**:
- **Required**: Once at ~24 hours after migration
- **Optional**: Run Query 1 once at ~12h if you want faster feedback

#### Query 1: Error Distribution (Main Health Signal)
```sql
SELECT
  error_category,
  COUNT(*) as error_count,
  MIN(occurred_at) as first_seen,
  MAX(occurred_at) as last_seen
FROM admin.enrichment_error_log
WHERE occurred_at > NOW() - INTERVAL '24 hours'
GROUP BY error_category
ORDER BY error_count DESC;
```

**What to look for:**
- ✅ Categories match expected list (rate_limit, budget_exceeded, network_timeout, json_parse, content_policy, token_limit, infra_auth, invalid_request, unknown)
- ✅ No unexpected categories (constraint should block them)
- ⚠️ High `invalid_request` or `infra_auth` counts = potential code bugs

---

---

**Query 2: Story Status Distribution**
```sql
SELECT
  enrichment_status,
  COUNT(*) as story_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM public.stories
GROUP BY enrichment_status
ORDER BY story_count DESC;
```

**What to look for:**
- ✅ Most stories in `'success'` status
- ✅ Small number in `'pending'` (transient errors)
- ✅ Very few in `'permanent_failure'` (only true hard errors)
- ⚠️ Large number in `'permanent_failure'` = possible miscategorization

---

---

**Query 3: Permanent Failure Inspection**
```sql
SELECT
  s.id,
  s.primary_headline,
  s.enrichment_failure_count,
  s.last_error_category,
  LEFT(s.last_error_message, 100) as error_preview,
  s.last_enriched_at
FROM public.stories s
WHERE s.enrichment_status = 'permanent_failure'
ORDER BY s.last_enriched_at DESC
LIMIT 20;
```

**What to look for:**
- ✅ Error categories are truly permanent (content_policy, token_limit, etc.)
- ❌ Budget errors should NOT be here (would indicate bug)
- ❌ Network errors should NOT be here (should retry)

---

---

**Query 4: Budget Error Check**
```sql
SELECT
  DATE(occurred_at) as day,
  COUNT(*) as budget_errors,
  COUNT(DISTINCT story_id) as unique_stories_blocked
FROM admin.enrichment_error_log
WHERE error_category = 'budget_exceeded'
  AND occurred_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(occurred_at)
ORDER BY day DESC;
```

**What to look for:**
- ✅ Budget errors exist (means daily cap is working)
- ✅ Stories are NOT permanently failed due to budget errors
- ⚠️ Zero budget errors for multiple days = budget check might not be working

---

**✅ Phase 3 Success Criteria**:
- Error categories match expected list (no 'unknown' or unexpected categories)
- Most stories in 'success' status
- Permanent failures are truly permanent (content policy, token limits, etc.)
- Budget errors logged but NOT causing permanent failures

---

### Phase 4: JIRA Updates (5 minutes - MANUAL)

After 24h monitoring shows clean results, update JIRA tickets manually (or via `/jira` Slack command if available).

**Note**: Do NOT rely on Atlassian MCP tools until the 401 Unauthorized issue is resolved.

#### Update TTRC-278 (Smart Error Categorization)

**Status**: → Done

**Comment**:
```
Migration 038 applied in TEST environment (commit 6c8c02c).

✅ Completed:
- 9-category error classification implemented
- DB-level RPC tests passed
- 24h error log health check completed
- Error distribution: [paste Query 1 results summary]

All categories working as expected. No unexpected error types.

Next: PR to main for PROD deployment.
```

#### Update TTRC-279 (Per-Story Failure Tracking)

**Status**: → Done

**Comment**:
```
Two-level retry system implemented and validated in TEST.

✅ Test Results:
- Budget errors: Counter stays 0, infinite retry ✅
- Normal failures: Counter increments, status = 'pending' ✅
- Permanent failures: Status = 'permanent_failure' after max retries ✅
- Error logging: All categories logged correctly ✅

24h monitoring clean. Ready for PROD deployment via PR.

Commit: 6c8c02c
Runbook: docs/plans/ttrc-278-279-EXECUTION-RUNBOOK.md
```

---

### Phase 5: Create PR to Main (15 minutes - Claude will do)

After JIRA tickets updated and 24h monitoring complete, Claude will:

1. **Create deployment branch** from main
   ```bash
   git checkout main
   git pull origin main
   git checkout -b deploy/ttrc-278-279-smart-error-tracking
   ```

2. **Cherry-pick tested commit** from test
   ```bash
   git cherry-pick 6c8c02c
   ```

3. **Push and create PR**
   ```bash
   git push origin deploy/ttrc-278-279-smart-error-tracking
   gh pr create --title "feat(enrichment): smart error tracking + retry logic (TTRC-278/279)" \
     --body "$(cat <<'EOF'
## Summary
Adds smart error tracking and intelligent retry logic for story enrichment.

**Key Features:**
- 9-category error classification (rate limits, budget, network, JSON parse, content policy, etc.)
- Two-level retry system (story-level + job-level)
- Budget errors bypass failure counters (infinite retry until budget clears)
- Category-aware backoff (1h/12h/24h)
- Error logging for observability

**Cost Impact:** ~$0.015/day savings from avoided retries

## JIRA
- Closes TTRC-278 (Error Categorization)
- Closes TTRC-279 (Per-Story Failure Tracking)

## Changes
- **Migration 038**: Adds error tracking columns, admin.enrichment_error_log table, 2 RPCs
- **Worker**: Categorization logic, budget check, smart retry handlers
- **Docs**: Observability queries, runbook

## Test Results
✅ DB-level unit tests passed (budget errors, normal failures, permanent failures)
✅ 24h monitoring in TEST: [summary of error distribution]
✅ QA smoke tests: No new failures
✅ AI code review: Passed

## Deployment Notes
**CRITICAL**: Apply Migration 038 to PROD database BEFORE deploying worker code.

1. Apply migration in PROD Supabase SQL Editor (migrations/038_smart_error_tracking.sql)
2. Verify with queries from runbook Phase 1.2
3. Deploy updated worker code
4. Monitor error logs for 24h using queries from Phase 3

## Rollback Plan
If issues arise, rollback SQL provided in runbook.

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
   ```

4. **Include in PR**: Summary, JIRA links, test results, migration requirement, deployment notes

---

## 🚨 Rollback Plan

If issues arise after applying migration:

```sql
-- Rollback migration 038
BEGIN;

-- Drop RPCs
DROP FUNCTION IF EXISTS public.increment_enrichment_failure(BIGINT, BOOLEAN, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.log_enrichment_error(BIGINT, TEXT, TEXT, INT, BIGINT);

-- Drop error log table
DROP TABLE IF EXISTS admin.enrichment_error_log;

-- Drop columns
ALTER TABLE public.stories
  DROP COLUMN IF EXISTS enrichment_status,
  DROP COLUMN IF EXISTS enrichment_failure_count,
  DROP COLUMN IF EXISTS last_error_category,
  DROP COLUMN IF EXISTS last_error_message;

COMMIT;
```

Then revert worker code:
```bash
git revert 6c8c02c
git push origin test
```

---

## 📊 Expected Behavior Reference

### Scenario 1: Budget Exhaustion (Infinite Retry)
```
Day 1: Story hits budget → category='budget_exceeded'
  - enrichment_failure_count: 0 (unchanged)
  - job.attempts: 0 (unchanged)
  - job.run_at: tomorrow 00:00

Day 2: Budget still exhausted → category='budget_exceeded'
  - enrichment_failure_count: 0 (still unchanged)
  - job.run_at: tomorrow 00:00

Day 3: Budget clears → Enrichment succeeds
  - enrichment_status: 'success'
```

### Scenario 2: JSON Parse Fails 3 Times
```
Attempt 1: Parse fails
  - enrichment_failure_count: 1
  - enrichment_status: 'pending'
  - job.run_at: +12h

Attempt 2: Parse fails
  - enrichment_failure_count: 2
  - enrichment_status: 'pending'
  - job.run_at: +12h

Attempt 3: Parse fails
  - enrichment_failure_count: 3
  - enrichment_status: 'permanent_failure'
  - job.status: 'failed' (no more retries)
```

### Scenario 3: Content Policy Violation (Immediate Failure)
```
Attempt 1: Content policy error
  - enrichment_failure_count: 1
  - enrichment_status: 'permanent_failure' (immediate)
  - job.status: 'failed'
  - No retries (maxRetries = 1)
```

---

## 📁 Files Reference

- **Migration**: `migrations/038_smart_error_tracking.sql` (211 lines)
- **Worker Code**: `scripts/job-queue-worker.js` (categorizeEnrichmentError method, lines ~383-496)
- **Queries**: `docs/sql-queries/error-tracking.sql` (10 observability queries)
- **Handoff**: `docs/handoffs/2025-11-23-ttrc-278-279-smart-error-tracking.md`
- **Plan**: `docs/plans/ttrc-278-279-smart-error-tracking.md` (original implementation plan)
- **Commit**: 6c8c02c (test branch)

---

## ✅ Success Checklist

- [ ] Phase 1 complete: Migration 038 applied and verified (4 verification queries passed)
- [ ] Phase 2 complete: All 6 unit tests passed
- [ ] Phase 3 complete: 24h monitoring shows clean results (4 queries run, no issues)
- [ ] Phase 4 complete: JIRA tickets updated to Done
- [ ] Phase 5 complete: PR created and merged to main

---

## 🔗 Next Session Context

**For new session, start here:**

1. Check migration status: Run Phase 1.2 verification queries
2. If not applied: Apply migration (Phase 1.1)
3. If applied: Run unit tests (Phase 2)
4. If tests pass: Start 24h monitoring (Phase 3)
5. After 24h clean: Update JIRA (Phase 4) and create PR (Phase 5)

**Cost Impact:** $0 for migration/testing, ~$0.015/day savings in prod

**Risk Level:** Low (code validated by subagent + AI review, rollback plan ready)

---

**Created**: 2025-11-24
**Author**: Claude Code
**For**: Josh (next session execution)

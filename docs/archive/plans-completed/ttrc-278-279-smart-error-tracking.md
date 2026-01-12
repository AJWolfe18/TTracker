# TTRC-278 & TTRC-279: Smart Error Tracking & Retry Logic

**Status**: Ready for Implementation
**Date**: 2025-11-23
**Tickets**: TTRC-278 (Error Categorization), TTRC-279 (Per-Story Failure Tracking)
**Effort**: Medium (~2-3 hours including testing)
**Environment**: TEST branch first, then PR to main

---

## Executive Summary

Add per-story error tracking and intelligent retry categorization to story enrichment. Reduces wasted OpenAI retries by ~50% by distinguishing transient errors (network, rate limits) from permanent failures (parse errors, content violations).

**Key Design Decisions** (locked in after architect review):
- ✅ Two-level retry system: story-level status + job-level attempts
- ✅ Budget errors don't increment failure counters (infinite retry until budget clears)
- ✅ JSON parse fails after 3 tries (vs 5 for other errors)
- ✅ Atomic counter updates via RPC (prevents race conditions)
- ✅ Error log in `admin` schema, accessed via public RPC wrapper
- ✅ Success path uses inline UPDATE (no RPC needed)

---

## Success Criteria

- ✅ Permanent errors (content policy, token limit) fail immediately
- ✅ JSON parse errors fail after 3 tries (vs 5 for others)
- ✅ Budget exhaustion reschedules indefinitely without blacklisting stories
- ✅ Transient errors (network, rate limits) retry with appropriate backoff
- ✅ Error logs provide visibility: `SELECT * FROM admin.enrichment_error_log WHERE error_category = 'rate_limit'`
- ✅ Zero cost increase (saves ~$0.015/day from avoided retries)

---

## Architecture Overview

### State Model

**Story States** (`enrichment_status`):
- `NULL` - Never attempted or ready for retry
- `'pending'` - Has failures but still retryable
- `'success'` - Successfully enriched
- `'permanent_failure'` - Needs manual reset (hit max retries)

### Error Categories

| Category | Transient? | Max Retries | Cooldown | Example |
|----------|-----------|-------------|----------|---------|
| `rate_limit` | Yes | 5 | 24h | 429 from OpenAI |
| `budget_exceeded` | Yes | ∞ (doesn't count) | 24h | Daily cap hit |
| `network_timeout` | Yes | 5 | 12h | ECONNRESET, 5xx |
| `json_parse` | No | 3 | 12h | Invalid JSON response |
| `content_policy` | No | 1 | - | OpenAI content violation |
| `token_limit` | No | 1 | - | Story too large |
| `unknown` | Yes | 5 | 12h | Uncategorized errors |

### Two-Level Retry System

**Story-level** (`stories` table):
- `enrichment_failure_count` - Incremented on each failure (except budget)
- `enrichment_status` - Lifecycle state
- `last_error_category` / `last_error_message` - Diagnostic info
- `last_enriched_at` - 12h cooldown enforcement

**Job-level** (`job_queue` table):
- `attempts` - Incremented on each job retry (except budget)
- `run_at` - Next retry timestamp (category-aware backoff)
- `status` - `pending` | `failed`

**Critical**: Budget errors (`budget_exceeded`) don't increment either level - they reschedule indefinitely until budget clears.

---

## Database Migration: `migrations/038_smart_error_tracking.sql`

### Section 1: Add Columns to Stories Table

```sql
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enrichment_failure_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_category TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT DEFAULT NULL;

-- Status constraint
ALTER TABLE public.stories
  ADD CONSTRAINT chk_enrichment_status
  CHECK (enrichment_status IN ('pending', 'success', 'permanent_failure'));

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_status
  ON public.stories(enrichment_status)
  WHERE enrichment_status IS NOT NULL;
```

**Idempotency Note**: If re-running in TEST, drop constraint first:
```sql
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS chk_enrichment_status;
```

### Section 2: Create Error Log Table

```sql
CREATE TABLE IF NOT EXISTS admin.enrichment_error_log (
  id BIGSERIAL PRIMARY KEY,
  story_id BIGINT NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  error_category TEXT NOT NULL,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count INT NOT NULL,
  job_id BIGINT
);

-- Category constraint (MUST match categorizeEnrichmentError() strings)
ALTER TABLE admin.enrichment_error_log
  ADD CONSTRAINT chk_enrichment_error_category
  CHECK (
    error_category IN (
      'rate_limit',
      'budget_exceeded',
      'network_timeout',
      'json_parse',
      'content_policy',
      'token_limit',
      'unknown'
    )
  );

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_enrichment_error_story_time
  ON admin.enrichment_error_log(story_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_error_category
  ON admin.enrichment_error_log(error_category, occurred_at DESC);
```

**Retention**: 30 days (future work: pg_cron or manual cleanup - not automated yet)

### Section 3: Atomic Failure Increment RPC

**Location**: `public` schema (exposed to Supabase RPC)
**Pattern**: Matches `log_run_stats` (SECURITY DEFINER + SET search_path)

```sql
CREATE OR REPLACE FUNCTION public.increment_enrichment_failure(
  p_story_id BIGINT,
  p_is_budget_error BOOLEAN DEFAULT FALSE,
  p_max_retries INT DEFAULT 5,
  p_error_category TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS TABLE (
  enrichment_failure_count INT,
  enrichment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
DECLARE
  v_count INT;
  v_status TEXT;
BEGIN
  -- Budget errors: update last_error_* but don't increment counters
  IF p_is_budget_error THEN
    SELECT
      s.enrichment_failure_count,
      s.enrichment_status
    INTO v_count, v_status
    FROM public.stories s
    WHERE s.id = p_story_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Story % not found', p_story_id;
    END IF;

    -- Maintain cooldown, record error, but don't count it
    UPDATE public.stories
    SET
      last_enriched_at = NOW(),
      last_error_category = p_error_category,
      last_error_message = p_error_message
    WHERE id = p_story_id;

    RETURN QUERY SELECT v_count, v_status;
    RETURN;
  END IF;

  -- Normal failure: increment counter atomically
  UPDATE public.stories
  SET
    enrichment_failure_count = enrichment_failure_count + 1,
    last_enriched_at = NOW(),
    last_error_category = p_error_category,
    last_error_message = p_error_message
  WHERE id = p_story_id
  RETURNING enrichment_failure_count INTO v_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story % not found', p_story_id;
  END IF;

  -- Determine status based on failure count vs max retries
  v_status :=
    CASE
      WHEN v_count >= p_max_retries THEN 'permanent_failure'
      ELSE 'pending'
    END;

  UPDATE public.stories
  SET enrichment_status = v_status
  WHERE id = p_story_id;

  RETURN QUERY SELECT v_count, v_status;
END;
$func$;

-- Security hardening
REVOKE ALL ON FUNCTION public.increment_enrichment_failure(
  BIGINT, BOOLEAN, INT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.increment_enrichment_failure(
  BIGINT, BOOLEAN, INT, TEXT, TEXT
) TO service_role;
```

### Section 4: Error Log RPC

**Pattern**: Public wrapper for admin table (matches `log_run_stats`)

```sql
CREATE OR REPLACE FUNCTION public.log_enrichment_error(
  p_story_id BIGINT,
  p_error_category TEXT,
  p_error_message TEXT,
  p_retry_count INT,
  p_job_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
BEGIN
  INSERT INTO admin.enrichment_error_log (
    story_id,
    error_category,
    error_message,
    retry_count,
    job_id
  )
  VALUES (
    p_story_id,
    p_error_category,
    p_error_message,
    p_retry_count,
    p_job_id
  );
END;
$func$;

-- Security hardening
REVOKE ALL ON FUNCTION public.log_enrichment_error(
  BIGINT, TEXT, TEXT, INT, BIGINT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_enrichment_error(
  BIGINT, TEXT, TEXT, INT, BIGINT
) TO service_role;
```

---

## Worker Code Changes: `scripts/job-queue-worker.js`

### Change A: Add Error Categorization Function

**Location**: Insert after line 377 (before `enrichStory()` method)

```javascript
  /**
   * Categorize enrichment errors for smart retry logic
   * TTRC-278: Transient vs permanent error classification
   *
   * CRITICAL: Category strings MUST match CHECK constraint in admin.enrichment_error_log
   */
  categorizeEnrichmentError(error) {
    const msg = (error.message || '').toLowerCase();
    const code = error.code || '';
    const status = typeof error.status === 'number' ? error.status : undefined;

    // 1. Rate limit (429) - retry with 24h backoff
    if (status === 429 || code === 'rate_limit_exceeded') {
      return {
        category: 'rate_limit',
        isPermanent: false,
        cooldownHours: 24
      };
    }

    // 2. Budget exceeded - wait until tomorrow, don't count as failure
    if (code === 'budget_exceeded' || msg.includes('budget exceeded')) {
      return {
        category: 'budget_exceeded',
        isPermanent: false,
        cooldownHours: 24
      };
    }

    // 3. Network timeouts (ECONNRESET, ETIMEDOUT, 5xx) - retry with 12h backoff
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || (status && status >= 500)) {
      return {
        category: 'network_timeout',
        isPermanent: false,
        cooldownHours: 12
      };
    }

    // 4. JSON parse errors - permanent after 3 tries (faster failure)
    if (msg.includes('json parse failed') || msg.includes('valid json')) {
      return {
        category: 'json_parse',
        isPermanent: false,  // Will be marked permanent after 3 tries via maxRetries
        cooldownHours: 12
      };
    }

    // 5. Content policy violations - permanent immediately
    if (code === 'content_policy_violation' || msg.includes('content policy')) {
      return {
        category: 'content_policy',
        isPermanent: true,
        cooldownHours: null
      };
    }

    // 6. Token limit exceeded - story too large, permanent
    if (code === 'context_length_exceeded' || msg.includes('maximum context')) {
      return {
        category: 'token_limit',
        isPermanent: true,
        cooldownHours: null
      };
    }

    // 7. Unknown - default to transient behavior
    return {
      category: 'unknown',
      isPermanent: false,
      cooldownHours: 12
    };
  }
```

### Change B: Add Budget Check

**Location**: Replace commented lines 410-412 in `enrichStory()` method

```javascript
    // ========================================
    // 2. BUDGET CHECK
    // ========================================
    const ESTIMATED_COST_PER_STORY = 0.003;  // GPT-4o-mini ~$0.003/story
    const DAILY_BUDGET_LIMIT = 5.0;          // $5/day cap
    const today = new Date().toISOString().split('T')[0];

    const { data: budgetRes, error: budgetErr } = await supabase.rpc(
      'increment_budget_with_limit',
      {
        day_param: today,
        amount_usd: ESTIMATED_COST_PER_STORY,
        call_count: 1,
        daily_limit: DAILY_BUDGET_LIMIT,
      }
    );

    if (budgetErr) {
      console.error('Budget check failed (infra error):', budgetErr);
      throw budgetErr;  // Treat as transient network error
    }

    if (!budgetRes || !Array.isArray(budgetRes) || !budgetRes[0]?.success) {
      const e = new Error('Daily budget exceeded - try tomorrow');
      e.code = 'budget_exceeded';
      throw e;
    }
```

### Change C: Update Success Handler

**Location**: Modify existing UPDATE at lines 497-511

**Find**:
```javascript
    const { error: uErr } = await supabase
      .from('stories')
      .update({
        summary_neutral,
        summary_spicy,
        category: category_db,
        severity,
        primary_actor,
        top_entities,
        entity_counter,
        last_enriched_at: new Date().toISOString()
      })
      .eq('id', story_id);
```

**Replace with**:
```javascript
    const { error: uErr } = await supabase
      .from('stories')
      .update({
        summary_neutral,
        summary_spicy,
        category: category_db,
        severity,
        primary_actor,
        top_entities,
        entity_counter,
        last_enriched_at: new Date().toISOString(),
        // TTRC-278/279: Reset error state on success
        enrichment_status: 'success',
        enrichment_failure_count: 0,
        last_error_category: null,
        last_error_message: null
      })
      .eq('id', story_id);
```

### Change D: Replace Error Handler

**Location**: Replace entire `.catch()` block at lines 715-757

```javascript
        .catch(async (error) => {
          // TTRC-278: Categorize error for smart retry
          const { category, isPermanent, cooldownHours } = this.categorizeEnrichmentError(error);
          const isBudgetError = category === 'budget_exceeded';

          // Category-specific max retries
          const maxRetries = category === 'json_parse' ? 3 : 5;

          // 1. Atomically increment story failure count
          const { data: failureState, error: incErr } = await supabase.rpc(
            'increment_enrichment_failure',
            {
              p_story_id: payload.story_id,
              p_is_budget_error: isBudgetError,
              p_max_retries: maxRetries,
              p_error_category: category,
              p_error_message: error.message?.slice(0, 500)
            }
          );

          if (incErr) {
            safeLog('error', 'Failed to update story error state', {
              story_id: payload.story_id,
              error: incErr.message
            });
            // Continue with job retry logic despite RPC failure
          }

          const failureCount = failureState?.[0]?.enrichment_failure_count ?? 0;
          const storyStatus = failureState?.[0]?.enrichment_status ?? null;

          // 2. Log to error history table (non-blocking)
          try {
            await supabase.rpc('log_enrichment_error', {
              p_story_id: payload.story_id,
              p_error_category: category,
              p_error_message: error.message?.slice(0, 1000),
              p_retry_count: failureCount,
              p_job_id: job.id
            });
          } catch (logErr) {
            safeLog('error', 'Failed to log enrichment error (non-blocking)', {
              story_id: payload.story_id,
              job_id: job.id,
              log_error: logErr.message
            });
            // Continue - logging failures shouldn't break the pipeline
          }

          // 3. Job-level retry logic
          const attempts = (job.attempts || 0) + (isBudgetError ? 0 : 1);
          const maxJobAttempts = (isPermanent && !isBudgetError) ? 1 : 3;

          if (attempts >= maxJobAttempts || storyStatus === 'permanent_failure') {
            // Mark job as failed
            await supabase
              .from('job_queue')
              .update({
                status: 'failed',
                error: `[${category}] ${error.message}`,
                completed_at: new Date().toISOString()
              })
              .eq('id', job.id);

            safeLog('error', `Story enrichment failed permanently`, {
              story_id: payload.story_id,
              job_id: job.id,
              category,
              failureCount,
              isPermanent,
              storyStatus
            });
          } else {
            // Retry with category-aware backoff
            const backoffHours = cooldownHours || 12;
            const backoffMs = backoffHours * 60 * 60 * 1000;
            const nextRun = new Date(Date.now() + backoffMs);

            await supabase
              .from('job_queue')
              .update({
                status: 'pending',
                attempts: attempts,
                run_at: nextRun.toISOString(),
                error: `[${category}] ${error.message}`
              })
              .eq('id', job.id);

            safeLog('warn', `Story enrichment will retry`, {
              story_id: payload.story_id,
              job_id: job.id,
              category,
              attempt: attempts,
              next_run: nextRun.toISOString(),
              cooldownHours: backoffHours
            });
          }
        })
```

---

## Testing Plan

### Manual Validation (TEST Environment)

1. **Apply Migration**
   ```bash
   node scripts/apply-migrations.js
   ```

2. **Verify Schema**
   ```sql
   -- Check columns exist
   SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_name = 'stories'
     AND column_name LIKE 'enrichment%';

   -- Check RPC exists
   SELECT proname FROM pg_proc WHERE proname IN ('increment_enrichment_failure', 'log_enrichment_error');

   -- Check error log table
   SELECT * FROM information_schema.tables WHERE table_name = 'enrichment_error_log';
   ```

3. **Test Error Categories**

   **Budget Exceeded**:
   - Manually set budget cap to $0.01
   - Trigger enrichment job
   - Verify: `enrichment_failure_count` stays 0, job reschedules +24h

   **JSON Parse Error** (3 tries):
   - Modify OpenAI response to return invalid JSON (test only)
   - Trigger enrichment 3 times
   - Verify: `enrichment_status = 'permanent_failure'` after 3rd attempt

   **Rate Limit**:
   - Simulate 429 error
   - Verify: 24h cooldown applied, failure count incremented

   **Network Timeout**:
   - Simulate ECONNRESET
   - Verify: 12h cooldown applied

4. **Test Success After Failure**
   - Manually set: `enrichment_failure_count = 2`, `enrichment_status = 'pending'`
   - Trigger successful enrichment
   - Verify: All counters reset to 0, `status = 'success'`

5. **Query Error Logs**
   ```sql
   SELECT * FROM admin.enrichment_error_log
   ORDER BY occurred_at DESC
   LIMIT 10;
   ```

### Expected Behavior Scenarios

**Scenario 1: Budget Exhaustion** (infinite retry)
```
Day 1: Story hits budget → category='budget_exceeded'
  - enrichment_failure_count: 0 (unchanged)
  - job.attempts: 0 (unchanged)
  - job.run_at: tomorrow 00:00

Day 2: Budget still exhausted → category='budget_exceeded'
  - enrichment_failure_count: 0 (still unchanged)
  - job.attempts: 0 (still unchanged)
  - job.run_at: tomorrow 00:00

Day 3: Budget clears → Enrichment succeeds
  - enrichment_status: 'success'
```

**Scenario 2: JSON Parse Fails 3 Times**
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

**Scenario 3: Success After Failures**
```
Initial state:
  - enrichment_failure_count: 2
  - enrichment_status: 'pending'

Enrichment succeeds:
  - enrichment_failure_count: 0 (reset)
  - enrichment_status: 'success'
  - last_error_category: NULL (cleared)
  - last_error_message: NULL (cleared)
```

---

## Observability Queries

Create file: `/docs/sql-queries/error-tracking.sql`

```sql
-- ============================================================================
-- Error Tracking Observability Queries
-- Added: 2025-11-23 (TTRC-278/279)
-- ============================================================================

-- Top failing stories (needs manual review)
SELECT
  s.id,
  s.primary_headline,
  s.enrichment_failure_count,
  s.last_error_category,
  s.last_error_message,
  s.enrichment_status,
  s.last_enriched_at
FROM public.stories s
WHERE s.enrichment_status = 'permanent_failure'
ORDER BY s.enrichment_failure_count DESC
LIMIT 20;

-- Error distribution (last 7 days)
SELECT
  error_category,
  COUNT(*) as error_count,
  ROUND(AVG(retry_count), 1) as avg_retry_count,
  MIN(occurred_at) as first_seen,
  MAX(occurred_at) as last_seen
FROM admin.enrichment_error_log
WHERE occurred_at > NOW() - INTERVAL '7 days'
GROUP BY error_category
ORDER BY error_count DESC;

-- Retry recovery rate (how often retries succeed)
SELECT
  initial.error_category,
  COUNT(*) as total_failures,
  SUM(CASE WHEN s.enrichment_status = 'success' THEN 1 ELSE 0 END) as recovered,
  ROUND(100.0 * SUM(CASE WHEN s.enrichment_status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as recovery_pct
FROM admin.enrichment_error_log initial
JOIN public.stories s ON s.id = initial.story_id
WHERE initial.retry_count = 1
  AND initial.occurred_at > NOW() - INTERVAL '30 days'
GROUP BY initial.error_category
ORDER BY total_failures DESC;

-- Stories with repeated failures (potential bugs)
SELECT
  s.id,
  s.primary_headline,
  s.last_error_category,
  COUNT(e.id) as total_errors,
  MAX(e.occurred_at) as last_error_at
FROM public.stories s
JOIN admin.enrichment_error_log e ON e.story_id = s.id
WHERE e.occurred_at > NOW() - INTERVAL '7 days'
GROUP BY s.id
HAVING COUNT(e.id) > 3
ORDER BY total_errors DESC;

-- Budget exhaustion timeline
SELECT
  DATE(occurred_at) as day,
  COUNT(*) as budget_errors,
  COUNT(DISTINCT story_id) as unique_stories_blocked
FROM admin.enrichment_error_log
WHERE error_category = 'budget_exceeded'
  AND occurred_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(occurred_at)
ORDER BY day DESC;
```

---

## Implementation Checklist

### Before Starting
- [ ] Confirm on `test` branch: `git branch --show-current`
- [ ] Read this plan document completely
- [ ] Review existing migration 037 for pattern reference

### Implementation Steps
- [ ] Create `migrations/038_smart_error_tracking.sql`
  - [ ] Section 1: Add columns to stories table
  - [ ] Section 2: Create error log table
  - [ ] Section 3: Create `public.increment_enrichment_failure` RPC
  - [ ] Section 4: Create `public.log_enrichment_error` RPC
  - [ ] Add comments explaining each section
- [ ] Apply migration: `node scripts/apply-migrations.js`
- [ ] Verify schema with SQL queries above
- [ ] Update `scripts/job-queue-worker.js`
  - [ ] Add `categorizeEnrichmentError()` method
  - [ ] Add budget check (replace lines 410-412)
  - [ ] Update success handler (lines 497-511)
  - [ ] Replace error handler (lines 715-757)
- [ ] Create `/docs/sql-queries/error-tracking.sql` with observability queries
- [ ] Test manually (see Testing Plan above)
- [ ] Run QA tests: `npm run qa:smoke`

### After Implementation
- [ ] Commit changes: `git add migrations/038* scripts/job-queue-worker.js docs/sql-queries/error-tracking.sql`
- [ ] Commit message: `feat(enrichment): add smart error tracking + retry logic (TTRC-278/279)`
- [ ] Push to test: `git push origin test`
- [ ] **MANDATORY**: Check AI code review: `bash scripts/check-code-review.sh`
- [ ] Update JIRA tickets to Done (use MCP tools)
- [ ] Create handoff doc: `/docs/handoffs/2025-11-23-ttrc-278-279-smart-error-tracking.md`
- [ ] Test in deployed TEST environment (monitor for 24h)

---

## Cost Analysis

- **Migration**: Free (schema + RPCs only)
- **Storage**: ~30KB for 30 days of error logs (negligible)
- **Query cost**: Negligible (all queries indexed)
- **OpenAI savings**: ~$0.015/day from avoided retries (50% reduction on ~3% failure rate)
- **Annual savings**: ~$5.40/year

**ROI**: Operational visibility >> dollar savings

---

## Rollback Plan

If migration causes issues:

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

Then revert worker code changes via git.

---

## Future Enhancements

- [ ] Automated 30-day cleanup (pg_cron or cron job)
- [ ] Admin dashboard for error visualization
- [ ] Manual retry button for `permanent_failure` stories
- [ ] Email alerts when error rate > 10%
- [ ] Extend to inline enrichment path (currently worker-only)

---

## References

- JIRA: TTRC-278 (Error Categorization)
- JIRA: TTRC-279 (Per-Story Failure Tracking)
- Migration 037: Added `last_enriched_at` + cooldown logic
- Migration 019: Budget tracking patterns (`increment_budget`)
- Pattern reference: `public.log_run_stats` (admin table wrapper)

---

**Last Updated**: 2025-11-23
**Status**: Ready for Implementation
**Reviewed By**: Expert dev/architect (all blockers resolved)

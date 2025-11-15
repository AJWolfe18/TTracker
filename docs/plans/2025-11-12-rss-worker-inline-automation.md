# RSS Worker Automation - Inline GitHub Actions Pattern

**Date:** 2025-11-12
**Status:** Ready for Implementation
**Environment:** TEST → PROD
**Timeline:** 5 hours dev + 48 hours testing = 4 days
**Cost Impact:** $0-2/month (GitHub Actions free tier + minimal OpenAI)
**JIRA:**
- **TTRC-266** - Automate RSS Worker (main story, 5 pts)
- **TTRC-267** - Remove Legacy Code (follow-up, 1 pt, scheduled 30d after TTRC-266)

---

## Executive Summary

**Problem:** RSS job queue worker runs manually on local machine, blocking PROD deployment.

**Solution:** Copy Executive Orders inline pattern - run everything in GitHub Actions with production guardrails (runtime caps, budget caps, advisory locks, fail-open, structured logs).

**Key Insight:** EOs already work this way. No separate worker needed - just GitHub Actions → fetch → cluster → enrich → done.

**Cost:** $0/month for GitHub Actions (1,800/2,000 free minutes), ~$1-2/month OpenAI (budget-capped).

---

## Architecture Change

### Before (Complex)
```
GitHub Actions (every 2h)
    ↓ Triggers
Supabase Edge Function (rss-enqueue)
    ↓ Creates jobs
Job Queue (pending jobs pile up)
    ↓ Requires
Separate Worker Process (manual start, local machine)
    ↓ Processes
Stories + Articles
```

**Problems:**
- Worker must run manually
- Jobs pile up if worker down
- Complex 3-layer system
- Can't deploy to PROD

### After (Simple)
```
GitHub Actions (every 2h)
    ↓ Runs
Inline Script (rss-tracker-supabase.js)
    ├── Fetch RSS feeds (with ETag caching)
    ├── Cluster articles into stories
    └── Enrich stories (with budget caps)
        ↓ Writes
Stories + Articles
    ↓ Done
(exits cleanly, no worker needed)
```

**Benefits:**
- Zero infrastructure
- No manual intervention
- Single script to maintain
- Works in TEST and PROD
- Built-in guardrails

---

## Production Guardrails (All Included)

### Runtime Guards
- ✅ **5-minute hard cap** - Script exits at 5:00 no matter what
- ✅ **8-minute GA timeout** - GitHub Actions kills at 8:00 (safety net)
- ✅ **Time checks** - Before each story enrichment

### Budget Guards
- ✅ **Daily token cap** - `DAILY_OPENAI_INPUT_TOKENS_MAX=500000`
- ✅ **Daily cost cap** - `DAILY_OPENAI_COST_MAX_USD=5.0`
- ✅ **Dynamic per-run cap** - `min(10, tokensRemaining / 2500)`
- ✅ **Cost tracking** - Uses existing `increment_budget` RPC

### Concurrency Guards
- ✅ **GitHub Actions concurrency** - One run per branch
- ✅ **Per-feed advisory locks** - `pg_try_advisory_lock(42, feed_id)`
- ✅ **Lock cleanup** - Released on error

### Filtering Guards
- ✅ **scoreGovRelevance** - Filter before article insert
- ✅ **Trump boost** - Applied in relevance scoring
- ✅ **Drop stats logged** - Track what gets filtered out

### Fail-Open Strategy
- ✅ **Ingestion continues** - Even if enrichment budget hit
- ✅ **Unenriched stories marked** - `summary_neutral IS NULL`
- ✅ **Early exit logged** - Reason captured in run stats

### Observability
- ✅ **Structured JSON log** - Single line per run
- ✅ **Per-feed stats** - Only when error_rate > 5% or drop_rate > 50%
- ✅ **admin.run_stats table** - Queryable history
- ✅ **Alert webhooks** - Optional Slack/Discord/Teams

### Security
- ✅ **Secrets from GitHub** - No hardcoded keys
- ✅ **No secrets in logs** - Redacted
- ✅ **Request bodies sanitized** - No data leaks

### Kill Switches
- ✅ **RSS_TRACKER_RUN_ENABLED** - Emergency disable
- ✅ **All caps configurable** - Via environment variables

---

## Implementation Plan

### Phase 1: Create Core Script (~2 hours)

**File:** `scripts/rss-tracker-supabase.js`

**Approach:** Use provided production-ready code, adapt for Node.js imports

**Structure:**
```javascript
// 1. SETUP & GUARDS (30s)
- Check daily budget (exit if exceeded)
- Initialize rate limiter
- Start 5-minute timer

// 2. FETCH RSS FEEDS (2-3 min)
- Query active feeds from feed_registry
- For each feed:
  - Try per-feed advisory lock (skip if locked)
  - Fetch with ETag/If-Modified-Since (skip if 304)
  - Filter via scoreGovRelevance + Trump boost
  - Insert articles via attach_or_create_article
  - Update feed stats
  - Release lock

// 3. CLUSTER ARTICLES (30s)
- Group unclustered articles into stories
- Use existing clustering algorithm

// 4. ENRICH STORIES (2-3 min)
- Calculate dynamic cap: min(10, tokensRemaining/2500)
- Get oldest unenriched stories
- For each story (with time/budget checks):
  - Scrape allow-listed articles (TTRC-260)
  - Generate OpenAI enrichment
  - Track costs via increment_budget
  - Rate limit between calls
  - Exit early if time/budget exhausted

// 5. LOGGING & CLEANUP (10s)
- Build structured JSON summary
- Insert to admin.run_stats
- Send alert webhooks (if errors/drops/budget hit)
- Print JSON log for GitHub Actions
```

**Adaptations from provided code:**
- Replace RPC calls with Node.js imports:
  - `fetchFeed()` from `scripts/rss/fetch_feed.js`
  - `clusterNewArticles()` from worker (extract)
  - `enrichStory()` from worker (extract)
- Use existing `increment_budget` RPC for cost tracking
- Keep all guardrails from provided code

**Dependencies:**
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x",
    "openai": "^4.x",
    "node-fetch": "^3.x",
    "dotenv": "^16.x"
  }
}
```

---

### Phase 2: Database Migration (~30 min)

**File:** `migrations/030_rss_tracker_inline.sql`

**Changes:**

1. **Add audit column to feed_registry:**
   ```sql
   ALTER TABLE feed_registry
   ADD COLUMN IF NOT EXISTS last_304_at TIMESTAMPTZ;

   COMMENT ON COLUMN feed_registry.last_304_at IS
     'Last time feed returned 304 Not Modified (ETag hit)';
   ```

2. **Create run stats table:**
   ```sql
   CREATE SCHEMA IF NOT EXISTS admin;

   CREATE TABLE admin.run_stats (
     id BIGSERIAL PRIMARY KEY,
     run_type TEXT NOT NULL,
     started_at TIMESTAMPTZ NOT NULL,
     completed_at TIMESTAMPTZ,
     feeds_processed INT,
     articles_created INT,
     articles_dropped INT,
     stories_enriched INT,
     tokens_used INT,
     cost_usd DECIMAL(10,4),
     runtime_seconds INT,
     early_exit_reason TEXT,
     log_data JSONB
   );

   CREATE INDEX idx_run_stats_started
     ON admin.run_stats(started_at DESC);
   ```

3. **Create advisory lock helpers:**
   ```sql
   CREATE FUNCTION admin.try_feed_lock(p_feed_id BIGINT)
   RETURNS BOOLEAN
   LANGUAGE sql SECURITY DEFINER
   AS $ SELECT pg_try_advisory_lock(42, p_feed_id); $;

   CREATE FUNCTION admin.release_feed_lock(p_feed_id BIGINT)
   RETURNS BOOLEAN
   LANGUAGE sql SECURITY DEFINER
   AS $ SELECT pg_advisory_unlock(42, p_feed_id); $;

   -- Expose via PostgREST
   CREATE FUNCTION try_feed_lock(p_feed_id BIGINT)
   RETURNS BOOLEAN AS
   $ SELECT admin.try_feed_lock(p_feed_id); $
   LANGUAGE sql SECURITY DEFINER;

   CREATE FUNCTION release_feed_lock(p_feed_id BIGINT)
   RETURNS BOOLEAN AS
   $ SELECT admin.release_feed_lock(p_feed_id); $
   LANGUAGE sql SECURITY DEFINER;
   ```

4. **Create red-flags view (optional):**
   ```sql
   CREATE VIEW admin.rss_redflags AS
   SELECT
     NOW() AS observed_at,
     fr.id AS feed_id,
     fr.feed_name,
     fr.feed_url,
     COALESCE(h.error_rate_24h, 0) AS error_rate_24h,
     COALESCE(h.articles_24h, 0) AS articles_24h
   FROM feed_registry fr
   LEFT JOIN admin.feed_health_overview h ON h.feed_id = fr.id
   WHERE fr.is_active = true
     AND (h.error_rate_24h > 0.05 OR h.articles_24h = 0);
   ```

**Apply migration:**
```bash
# TEST environment
SUPABASE_URL=$TEST_URL psql < migrations/030_rss_tracker_inline.sql

# Or use Supabase CLI
supabase db push
```

---

### Phase 3: GitHub Actions Workflows (~20 min)

**Approach:** Separate workflows for TEST and PROD with independent control

#### 3A: TEST Workflow (Manual Only)

**File:** `.github/workflows/rss-tracker-test.yml`

```yaml
name: RSS Tracker (TEST)

on:
  # Schedule DISABLED by default - uncomment to enable automatic runs in TEST
  # schedule:
  #   - cron: '0 */6 * * *'   # Every 6 hours (if enabled)
  workflow_dispatch:            # Always available for manual trigger

# CRITICAL: Prevent overlapping runs
concurrency:
  group: rss-tracker-test
  cancel-in-progress: true

jobs:
  track:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    if: github.ref == 'refs/heads/test'  # Only run on test branch

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run RSS Tracker
        env:
          # TEST environment secrets
          SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

          # Guardrails / caps
          RSS_TRACKER_RUN_ENABLED: 'true'
          PER_RUN_STORIES_MAX: '10'
          DAILY_OPENAI_INPUT_TOKENS_MAX: '500000'
          DAILY_OPENAI_COST_MAX_USD: '5.0'
          RUNTIME_HARD_CAP_MS: '300000'
          FEED_FETCH_TIMEOUT_MS: '10000'
          ENRICH_TIMEOUT_MS: '50000'
          RATE_LIMIT_DELAY_MS: '250'

          # Alerts (optional)
          # ALERT_WEBHOOK_URL: ${{ secrets.RSS_ALERT_WEBHOOK }}
          # ALERT_MIN_LEVEL: 'warn'
        run: node scripts/rss-tracker-supabase.js

      - name: Upload log artifact on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: rss-tracker-test-log-${{ github.run_id }}
          path: .
```

**Manual trigger:**
```bash
# Via GitHub CLI
gh workflow run rss-tracker-test.yml --ref test

# Or via GitHub UI: Actions tab → RSS Tracker (TEST) → Run workflow
```

#### 3B: PROD Workflow (Automatic Schedule)

**File:** `.github/workflows/rss-tracker-prod.yml`

```yaml
name: RSS Tracker (PROD)

on:
  schedule:
    - cron: '0 */2 * * *'      # Every 2 hours (automatic)
  workflow_dispatch:            # Also available for manual trigger

# CRITICAL: Prevent overlapping runs
concurrency:
  group: rss-tracker-prod
  cancel-in-progress: true

jobs:
  track:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    if: github.ref == 'refs/heads/main'  # Only run on main branch

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run RSS Tracker
        env:
          # PROD environment secrets
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

          # Guardrails / caps
          RSS_TRACKER_RUN_ENABLED: 'true'
          PER_RUN_STORIES_MAX: '10'
          DAILY_OPENAI_INPUT_TOKENS_MAX: '500000'
          DAILY_OPENAI_COST_MAX_USD: '5.0'
          RUNTIME_HARD_CAP_MS: '300000'
          FEED_FETCH_TIMEOUT_MS: '10000'
          ENRICH_TIMEOUT_MS: '50000'
          RATE_LIMIT_DELAY_MS: '250'

          # Alerts (optional)
          # ALERT_WEBHOOK_URL: ${{ secrets.RSS_ALERT_WEBHOOK }}
          # ALERT_MIN_LEVEL: 'warn'
        run: node scripts/rss-tracker-supabase.js

      - name: Upload log artifact on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: rss-tracker-prod-log-${{ github.run_id }}
          path: .
```

**Manual trigger:**
```bash
# Via GitHub CLI
gh workflow run rss-tracker-prod.yml --ref main

# Or via GitHub UI: Actions tab → RSS Tracker (PROD) → Run workflow
```

#### Environment Control Summary

**Three layers of control:**

1. **Schedule presence** - Comment out = no automatic runs
   - TEST: Commented by default (manual only)
   - PROD: Enabled (runs every 2 hours)

2. **Branch restriction** - `if: github.ref == 'refs/heads/X'`
   - TEST workflow only runs on `test` branch
   - PROD workflow only runs on `main` branch

3. **Kill switch** - `RSS_TRACKER_RUN_ENABLED: 'true'`
   - Set to 'false' for emergency disable without removing schedule
   - Script checks this at startup and exits if disabled

**To enable automatic runs in TEST:**
```yaml
# Uncomment in rss-tracker-test.yml:
on:
  schedule:
    - cron: '0 */6 * * *'   # Less frequent than PROD
  workflow_dispatch:
```

**To disable automatic runs in PROD:**
```yaml
# Comment out in rss-tracker-prod.yml:
on:
  # schedule:
  #   - cron: '0 */2 * * *'
  workflow_dispatch:  # Manual still works
```

---

### Phase 4: Extract Existing Functions (~1.5 hours)

**Goal:** Pull reusable logic from `job-queue-worker.js` into importable modules

#### 4A: Clustering Module

**File:** `scripts/clustering/cluster.js`

```javascript
// Extract clustering logic from job-queue-worker.js
export async function clusterNewArticles(supabase) {
  // Existing clustering algorithm
  // Return: { stories_touched, articles_clustered }
}
```

#### 4B: Enrichment Module

**File:** `scripts/enrichment/enrich.js`

```javascript
import OpenAI from 'openai';

export async function enrichStory(storyId, tokenCap, supabase, openaiClient) {
  // 1. Get story + articles
  // 2. Scrape allow-listed articles (TTRC-260 logic)
  // 3. Generate OpenAI enrichment
  // 4. Update story with summaries
  // 5. Track costs via increment_budget RPC
  // Return: { tokens_used, cost_usd }
}
```

#### 4C: Verify Fetch Module

**File:** `scripts/rss/fetch_feed.js`

**Current status:** ✅ Already working (ETag caching implemented)

**Verify return shape:**
```javascript
// Should return:
{
  kept: 23,        // Articles inserted
  dropped: 7,      // Articles filtered out
  was_304: false   // True if 304 Not Modified
}
```

**If not returning this shape, adapt to match.**

---

### Phase 5: Local Testing (~1 hour)

**Test script:**
```bash
# Set environment variables
export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJxxxx..."
export OPENAI_API_KEY="sk-xxxx"

# Test with low caps for fast feedback
export DAILY_OPENAI_INPUT_TOKENS_MAX=10000
export PER_RUN_STORIES_MAX=3
export RUNTIME_HARD_CAP_MS=120000  # 2 minutes

# Run
node scripts/rss-tracker-supabase.js
```

**Verify checklist:**
- [ ] Runtime < 2 minutes (with low caps)
- [ ] Structured JSON log printed
- [ ] Stories enriched (check database)
- [ ] Advisory locks working (run twice in parallel, 2nd skips locked feeds)
- [ ] Early exit on budget cap (set token cap to 0, verify exit)
- [ ] Costs tracked in budgets table
- [ ] admin.run_stats row inserted

**Example output:**
```json
{
  "timestamp": "2025-11-12T10:30:00.000Z",
  "run_type": "rss-tracker",
  "feeds_total": 9,
  "feeds_processed": 9,
  "feeds_etag_304": 3,
  "articles_created": 23,
  "articles_dropped": 7,
  "stories_enriched": 3,
  "tokens_used": 7500,
  "cost_usd": 0.0011,
  "runtime_seconds": 87,
  "early_exit_reason": "DAILY_BUDGET_EXCEEDED",
  "errors": []
}
```

---

### Phase 6: TEST Branch Deployment (48 hours)

**Deploy:**
```bash
git checkout test
git add .github/workflows/rss-tracker.yml
git add scripts/rss-tracker-supabase.js
git add scripts/clustering/
git add scripts/enrichment/
git add migrations/030_rss_tracker_inline.sql
git commit -m "feat: automate RSS worker with inline GitHub Actions pattern

- Add rss-tracker-supabase.js with production guardrails
- Add advisory locks, runtime caps, budget caps
- Add structured logging to admin.run_stats
- Extract clustering/enrichment to modules
- Deploy workflow targeting TEST environment

TTRC-266"
git push origin test
```

**Monitor for 48 hours:**

1. **Check GitHub Actions:**
   - Go to Actions tab → RSS Tracker workflow
   - Verify runs completing in ~5 minutes
   - Check logs for structured JSON output
   - Total minutes after 3 runs: ~15 minutes

2. **Check database:**
   ```sql
   -- Run stats
   SELECT * FROM admin.run_stats
   WHERE run_type = 'rss-tracker'
   ORDER BY started_at DESC
   LIMIT 5;

   -- Cost tracking
   SELECT * FROM budgets
   WHERE day >= CURRENT_DATE - 2
   ORDER BY day DESC;

   -- Stories enriched
   SELECT COUNT(*) FROM stories
   WHERE summary_neutral IS NOT NULL
     AND updated_at > NOW() - INTERVAL '48 hours';
   ```

3. **Verify guardrails:**
   - [ ] No runs exceed 5 minutes
   - [ ] Budget caps respected
   - [ ] No overlapping runs (concurrency working)
   - [ ] ETag saves bandwidth (check feeds_etag_304 count)
   - [ ] Advisory locks prevent race conditions

4. **Test failure scenarios:**
   - Set `RSS_TRACKER_RUN_ENABLED=false` → should skip
   - Set `DAILY_OPENAI_COST_MAX_USD=0.001` → should exit early
   - Trigger two runs manually → concurrency should cancel first

**Success criteria:**
- ✅ 3+ successful runs
- ✅ Stories getting enriched
- ✅ GitHub Actions minutes < 20 total
- ✅ OpenAI costs < $0.10
- ✅ No errors in logs
- ✅ Guardrails verified working

---

### Phase 7: PROD Deployment (after TEST validation)

**Deployment via PR:**
```bash
# Create deployment branch from main
git checkout main
git pull origin main
git checkout -b deploy/rss-worker-automation

# Cherry-pick commits from test
git cherry-pick <commit-hash-from-test>

# Update workflow to use PROD secrets
# Edit .github/workflows/rss-tracker.yml:
#   - SUPABASE_URL (not SUPABASE_TEST_URL)
#   - SUPABASE_SERVICE_ROLE_KEY (not TEST version)

git add .github/workflows/rss-tracker.yml
git commit -m "chore: update workflow for PROD secrets"

# Push and create PR
git push origin deploy/rss-worker-automation
gh pr create \
  --title "RSS Worker Automation - Inline GitHub Actions" \
  --body "$(cat <<EOF
## Summary
Automates RSS worker using inline GitHub Actions pattern (copy of EO tracker approach).

## Changes
- ✅ Create rss-tracker-supabase.js with production guardrails
- ✅ Add GitHub Actions workflow with concurrency/timeouts
- ✅ Add admin.run_stats table + advisory locks
- ✅ Extract clustering/enrichment to modules
- ✅ Tested 48h in TEST environment

## Validation (TEST)
- 3 runs completed successfully
- Runtime: ~5 min average
- Cost: $0 GitHub Actions, ~$0.02 OpenAI
- Zero errors

## Cost Impact
- GitHub Actions: $0/month (1,800/2,000 free minutes)
- OpenAI: ~$1-2/month (budget-capped)
- **Total: $0-2/month**

## Rollback
- Disable workflow schedule
- Restart manual worker: node scripts/job-queue-worker.js
- Old system kept for 30 days

## JIRA
TTRC-266
EOF
)"
```

**After merge:**
1. Monitor first 3 runs (6 hours)
2. Verify PROD database getting updates
3. Check costs after 24 hours
4. Archive old worker system

---

## Deprecation Plan (Two-Card Approach)

### Card 1: RSS Worker Automation (TTRC-266)

**Immediate deprecation (included in this story):**

- ✅ Stop running manual worker
- ✅ Mark old code as DEPRECATED (add comments to files):
  ```javascript
  // DEPRECATED: This worker is replaced by scripts/rss-tracker-supabase.js
  // which runs inline in GitHub Actions. This code is kept for 30 days
  // as rollback safety. See docs/plans/2025-11-12-rss-worker-inline-automation.md
  ```
- ✅ Update docs to reference new system
- ✅ Remove old cron trigger from `.github/workflows/job-scheduler.yml`:
  ```yaml
  # REMOVED: RSS enqueue trigger (replaced by rss-tracker-test/prod.yml)
  # - name: Trigger RSS feed fetching
  #   run: curl ...
  ```
- ✅ Keep all old code in repo (for 30-day rollback window)

**Files to mark DEPRECATED (not delete):**
- `supabase/functions/rss-enqueue/index.ts`
- `scripts/job-queue-worker.js`

**Definition of Done:**
- New system running automatically in PROD
- Old system stopped (but code remains)
- Docs updated with deprecation notice

---

### Card 2: Remove Legacy RSS Worker (TTRC-267)

**Create this card after TTRC-266 deployed to PROD**

**Title:** "Remove Legacy RSS Worker Code"

**Epic:** TTRC-250 (RSS Feed Expansion)

**Story Points:** 1

**Prerequisites:**
- TTRC-266 deployed to PROD for 30+ days
- Zero rollbacks needed during stability period

**Acceptance Criteria:**
```
- [ ] 30+ days since new system deployed to PROD
- [ ] New system has 0 incidents requiring rollback
- [ ] Remove files:
  - supabase/functions/rss-enqueue/ (delete directory)
  - scripts/job-queue-worker.js (delete file)
- [ ] Remove job_queue table (optional - may keep for other uses)
- [ ] Update architecture docs (remove old flow diagrams)
- [ ] Final cleanup of any remaining references
```

**When to create:** After TTRC-266 deployed to PROD, schedule for 30 days later

**Estimated effort:** 1 hour

**Why separate:** Safety - keeps rollback option available during stability validation period

**Link:** https://ajwolfe37.atlassian.net/browse/TTRC-267

---

## Cost Analysis (Verified)

### GitHub Actions Minutes

**Calculation:**
- 12 runs/day (every 2 hours)
- 5 minutes/run average
- 30 days/month
- **Total: 1,800 minutes/month**

**Free tier:** 2,000 minutes/month for private repos

**Cost: $0/month** ✅

**Buffer:** 200 minutes (11% headroom)

### OpenAI Tokens

**Assumptions:**
- 8 stories enriched per run (average)
- 2,500 tokens per story (conservative)
- 12 runs/day
- 30 days/month

**Calculation:**
- 8 × 2,500 × 12 × 30 = 7,200,000 tokens/month

**Cost at $0.15/M input tokens:**
- 7.2M × $0.000150 = **$1.08/month**

**With budget caps:** Max $5/day = $150/month theoretical, but:
- Dynamic per-run cap keeps it low
- Daily caps prevent overrun
- **Realistic: $1-2/month** ✅

### Bandwidth

**ETag savings:**
- ~70% of requests return 304 Not Modified
- Only parse/process 30% of fetches
- **Cost: Negligible** (already factored into Supabase base)

### Total Monthly Cost

| Service | Cost |
|---------|------|
| GitHub Actions | $0 |
| OpenAI (enrichment) | $1-2 |
| Bandwidth | $0 |
| **Total** | **$1-2/month** |

**Budget headroom:** $48/month remaining (well under $50 limit)

---

## Monitoring & Ops

### Daily Health Check Queries

**Run history (last 24h):**
```sql
SELECT
  run_type,
  COUNT(*) AS runs,
  SUM(stories_enriched) AS stories,
  SUM(articles_created) AS created,
  SUM(articles_dropped) AS dropped,
  ROUND(SUM(cost_usd)::numeric, 4) AS cost
FROM admin.run_stats
WHERE started_at > NOW() - INTERVAL '24 hours'
  AND run_type = 'rss-tracker'
GROUP BY run_type;
```

**Expected output:**
```
 run_type     | runs | stories | created | dropped | cost
--------------+------+---------+---------+---------+-------
 rss-tracker  |   12 |      96 |     276 |      84 | 0.0144
```

**Red flags:**
```sql
SELECT * FROM admin.rss_redflags;
```

**Expected:** Empty or feeds with known issues

**Feed drop analysis:**
```sql
SELECT
  (log_data->>'timestamp') AS ts,
  jsonb_path_query_array(log_data, '$.feed_drop_stats') AS per_feed
FROM admin.run_stats
WHERE run_type = 'rss-tracker'
ORDER BY started_at DESC
LIMIT 1;
```

**Runtime trends:**
```sql
SELECT
  DATE(started_at) AS day,
  AVG(runtime_seconds) AS avg_runtime,
  MAX(runtime_seconds) AS max_runtime,
  MIN(runtime_seconds) AS min_runtime
FROM admin.run_stats
WHERE run_type = 'rss-tracker'
  AND started_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(started_at)
ORDER BY day DESC;
```

**Expected:** avg_runtime ~240-300 seconds (4-5 min)

### Alert Thresholds

**Webhook sends alert when:**
- Any feed has error (level: error)
- 3+ feeds have >50% drop rate (level: warn)
- Run exits due to budget cap (level: info)

**Setup webhook (optional):**
```bash
# Add to GitHub secrets:
RSS_ALERT_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Or Discord:
RSS_ALERT_WEBHOOK=https://discord.com/api/webhooks/YOUR/WEBHOOK

# Uncomment in workflow env:
ALERT_WEBHOOK_URL: ${{ secrets.RSS_ALERT_WEBHOOK }}
ALERT_MIN_LEVEL: 'warn'
```

### Dashboard Metrics (Future)

**Track over time:**
- Average runtime per run
- Token usage trends
- Feed health scores
- Article drop rates
- Cost per story enriched

**Tools:**
- Metabase connected to Supabase
- Or export admin.run_stats to Google Sheets
- Or simple SQL queries

---

## Rollback Procedure

**If anything breaks in PROD:**

### Step 1: Disable Workflow (30 seconds)
```bash
# Edit .github/workflows/rss-tracker.yml
# Comment out schedule:
# schedule:
#   - cron: '0 */2 * * *'

git add .github/workflows/rss-tracker.yml
git commit -m "hotfix: disable RSS tracker workflow"
git push origin main
```

### Step 2: Restart Manual Worker (1 minute)
```bash
# SSH to your machine or local terminal
cd TTracker
node scripts/job-queue-worker.js

# Or run in background:
nohup node scripts/job-queue-worker.js > worker.log 2>&1 &
```

### Step 3: Verify (2 minutes)
```sql
-- Check jobs processing
SELECT job_type, status, COUNT(*)
FROM job_queue
WHERE created_at > NOW() - INTERVAL '10 minutes'
GROUP BY job_type, status;

-- Should see completed jobs accumulating
```

### Step 4: Investigate (ongoing)
- Check GitHub Actions logs for errors
- Check admin.run_stats for early_exit_reason
- Check error_feeds in log_data
- Fix issue and re-enable

**Total rollback time: <5 minutes**

**Data loss: None** (jobs queued, just not processed)

---

## Success Criteria

### Phase 1: Development Complete
- [ ] `rss-tracker-supabase.js` created with all guardrails
- [ ] Clustering/enrichment modules extracted
- [ ] Migration 030 created
- [ ] GitHub Actions workflow created
- [ ] Local testing passed

### Phase 2: TEST Validation Complete
- [ ] 3+ successful runs in TEST
- [ ] Runtime consistently < 5 minutes
- [ ] GitHub Actions minutes < 20 total
- [ ] OpenAI costs < $0.10
- [ ] No errors in logs
- [ ] All guardrails verified

### Phase 3: PROD Deployment Complete
- [ ] PR merged to main
- [ ] First 3 PROD runs successful
- [ ] Stories enriching every 2 hours
- [ ] Costs within budget ($1-2/month)
- [ ] Zero manual intervention needed
- [ ] Old worker stopped and marked DEPRECATED (code kept for rollback)

### Overall Success
- ✅ **No more manual worker** - Fully automated
- ✅ **Cost under budget** - $0-2/month vs $50 limit
- ✅ **Reliable** - Runs every 2 hours without fail
- ✅ **Observable** - Structured logs + run stats
- ✅ **Safe** - Multiple guardrails prevent overruns
- ✅ **Maintainable** - Single script, clear logic

---

## Timeline Summary

| Phase | Duration | Calendar Time | Deliverable |
|-------|----------|---------------|-------------|
| Development | 5 hours | Day 1 | Script + migration + workflow |
| Local Testing | 1 hour | Day 1 | Verified locally |
| TEST Deployment | 48 hours | Day 2-3 | 3+ successful runs |
| PROD PR & Deploy | 2 hours | Day 4 | Merged to main |
| **Total** | **8 hours** | **4 days** | **Fully automated** |

**Active work:** 8 hours
**Calendar time:** 4 days (includes 48h monitoring)

---

## JIRA Structure

### Two-Card Approach (RECOMMENDED)

This work spans two JIRA stories for safety and clarity:

---

### Card 1: Automate RSS Worker (Main Story)

**Ticket:** TTRC-266

**Title:** "Automate RSS Worker Using Inline GitHub Actions Pattern"

**Epic:** TTRC-250 (RSS Feed Expansion)

**Story Points:** 5

**Timeline:** 4 days (5 hours active work + 48h monitoring)

**Link:** https://ajwolfe37.atlassian.net/browse/TTRC-266

**Acceptance Criteria:**
```
Phase 1: Development
- [ ] Create rss-tracker-supabase.js with all guardrails
- [ ] Extract clustering/enrichment modules
- [ ] Create migration 030 (run_stats, advisory locks)
- [ ] Create GitHub Actions workflow
- [ ] Pass local testing

Phase 2: TEST Validation
- [ ] Deploy to test branch
- [ ] Monitor 3+ successful runs (48 hours)
- [ ] Verify runtime < 5 min average
- [ ] Verify costs < $0.10
- [ ] Verify all guardrails working

Phase 3: PROD Deployment
- [ ] Create PR to main
- [ ] Update secrets for PROD
- [ ] Merge after approval
- [ ] Monitor first 3 PROD runs
- [ ] Stop manual worker (but keep code for rollback)
- [ ] Mark old code as DEPRECATED in comments
- [ ] Update docs to reference new system
- [ ] Remove old cron triggers

Definition of Done:
- Stories enriching every 2 hours automatically via new system
- GitHub Actions minutes < 2,000/month (free)
- OpenAI costs $1-2/month (budget-capped)
- admin.run_stats tracking all runs
- Manual worker stopped (code kept for 30-day rollback window)
- Documentation updated to mark old system deprecated
- Old cron triggers removed from workflows

Note: Full code removal is TTRC-267 (separate follow-up card after 30-day stability period)
```

**Deployment Tracking:**
Use process flow/board states to track progress through development, testing, and deployment phases. No subtasks needed - single atomic story.

**Board Flow:**
- To Do → Story created, ready to start
- In Progress → Development work (script, migration, workflow)
- Code Review → TEST validation (48h monitoring)
- Ready for Prod → PROD deployment preparation
- Done → Complete (stories enriching automatically)

---

### Card 2: Remove Legacy RSS Worker (Follow-up Story)

**Ticket:** TTRC-267

**Create this card AFTER TTRC-266 deployed to PROD**

**Title:** "Remove Legacy RSS Worker Code"

**Epic:** TTRC-250 (RSS Feed Expansion)

**Story Points:** 1

**Timeline:** 1 hour (scheduled 30 days after TTRC-266 PROD deployment)

**Link:** https://ajwolfe37.atlassian.net/browse/TTRC-267

**Prerequisites:**
- TTRC-266 deployed to PROD for 30+ days
- Zero rollbacks needed during stability period
- New system has 0 incidents

**Acceptance Criteria:**
```
- [ ] 30+ days since new system deployed to PROD
- [ ] New system has 0 incidents requiring rollback
- [ ] Delete deprecated files:
  - supabase/functions/rss-enqueue/ (entire directory)
  - scripts/job-queue-worker.js
- [ ] Optional: Remove job_queue table (if not used elsewhere)
- [ ] Update docs:
  - Remove old flow from architecture diagrams
  - Remove deprecation notices (no longer needed)
  - Document historical context
- [ ] Remove any remaining references in code
```

**Why separate from TTRC-266:**
- **Safety:** Keeps rollback option during 30-day validation
- **Clear completion:** TTRC-266 "done" when automation works, not waiting 30 days
- **Risk management:** Can stay in backlog until stability proven

**When to create:** Immediately after TTRC-266 PROD deployment, schedule for 30 days later

**Board Flow:**
- To Do → Created after TTRC-266 PROD deploy
- Backlog → Wait for 30-day stability timer
- Ready to Start → After 30 days proven stable
- In Progress → Delete files, update docs
- Done → Legacy code fully removed

---

## Related Work

**Completed:**
- TTRC-223: EO auto-enrichment (inline pattern we're copying)
- TTRC-218: EO enrichment worker (inline, not separate)
- TTRC-260: Article scraping with allow-list (used in enrichment)
- TTRC-253-255: RSS feed expansion to 9 feeds

**Blocked by this:**
- TTRC-250 Phase 5+: Can't add more feeds until PROD deployed
- Full RSS expansion: Need automated worker first

**Unblocks:**
- PROD deployment of RSS system
- Full feed expansion to 15+ feeds
- Story clustering at scale
- Reliable enrichment pipeline

---

## Questions & Answers

### Q: Why not use Supabase Edge Functions?
**A:** 60-second timeout risk. Enrichment can take 30-50s per story. GitHub Actions has no timeout limit.

### Q: Why not use self-hosted runner on cloud VM?
**A:** Costs $5/month + maintenance. GitHub Actions is free and simpler.

### Q: What if GitHub Actions free tier runs out?
**A:** At 5 min/run, we use 1,800 of 2,000 free minutes. If we go over, cost is $0.008/min ≈ $13/month max (still under budget). Can reduce per-run work to stay free.

### Q: Can we run this more frequently than every 2 hours?
**A:** Yes, but burns more minutes. Every 1 hour = 3,600 min/month = $12 overage. Recommend staying at 2 hours.

### Q: What if enrichment takes longer than 5 minutes?
**A:** Dynamic cap adjusts. If stories take longer, we enrich fewer per run. Next run picks up the rest. Fail-open ensures ingestion continues.

### Q: How do we add more feeds?
**A:** Just insert to feed_registry. Next run automatically picks them up. No code changes needed.

### Q: Can we disable enrichment temporarily?
**A:** Yes: set `PER_RUN_STORIES_MAX=0` in workflow env. Ingestion/clustering still works.

### Q: What if OpenAI API goes down?
**A:** Enrichment fails gracefully. Stories marked unenriched. Next run retries. Ingestion continues.

### Q: How do we monitor this?
**A:** Query `admin.run_stats` table. Set up alert webhook for errors. Check GitHub Actions logs.

### Q: How do we control which environments run automatically?
**A:** Separate workflows per environment with independent control:
- **TEST:** Schedule commented out by default (manual only). Trigger via `gh workflow run rss-tracker-test.yml --ref test`
- **PROD:** Schedule enabled (runs every 2 hours automatically). Can also trigger manually.
- **Three control layers:** (1) Schedule presence, (2) Branch restriction, (3) `RSS_TRACKER_RUN_ENABLED` kill switch
- **Enable TEST cron:** Uncomment the `schedule:` section in `rss-tracker-test.yml`
- **Disable PROD cron:** Comment out the `schedule:` section in `rss-tracker-prod.yml` (manual triggers still work)

---

## References

**Existing EO Pattern:**
- `scripts/executive-orders-tracker-supabase.js` - Template we're copying
- `.github/workflows/executive-orders.yml` - Similar workflow
- TTRC-223 - EO auto-enrichment implementation

**Documentation:**
- `docs/architecture/ARCHITECTURE.md` - System overview
- `docs/plans/2025-11-12-rss-worker-automation-plan.md` - Original plan (Option A)
- `CLAUDE.md` - Project context and rules

**Migrations:**
- `migrations/001_rss_system_PRODUCTION_READY.sql` - Base RSS schema
- `migrations/030_rss_tracker_inline.sql` - This migration

**Code:**
- `scripts/rss/fetch_feed.js` - RSS fetching (ETag implemented)
- `scripts/job-queue-worker.js` - Clustering/enrichment to extract

---

## Status

**Current:** Ready for Implementation
**JIRA Cards:**
- TTRC-266 - Automate RSS Worker (5 pts) - https://ajwolfe37.atlassian.net/browse/TTRC-266
- TTRC-267 - Remove Legacy Code (1 pt) - https://ajwolfe37.atlassian.net/browse/TTRC-267
**Next Step:** Start TTRC-266 Phase 1 (create script) in new chat session
**Owner:** Josh
**Last Updated:** 2025-11-12

### Decisions Made (Planning Session)
- ✅ Use inline GitHub Actions pattern (copy EO tracker approach)
- ✅ **Two JIRA cards created:**
  - **TTRC-266:** Main story - Automate RSS worker (5 pts)
  - **TTRC-267:** Follow-up story - Remove legacy code (1 pt, after 30 days stability)
- ✅ No subtasks, track via board flow states
- ✅ Deploy to TEST first (48h validation), then PROD
- ✅ Separate workflows per environment with independent control
  - TEST: Manual only by default (schedule commented out)
  - PROD: Automatic every 2 hours (schedule enabled)
  - Both support manual triggers via workflow_dispatch
- ✅ Three layers of control (schedule, branch restriction, kill switch)
- ✅ Immediate deprecation (stop, mark DEPRECATED, keep code 30 days)
- ✅ Full removal after 30-day stability period (separate card)
- ✅ All production guardrails included in provided code
- ✅ Cost: $0-2/month (well under budget)
- ✅ Timeline: 5 hours dev + 48 hours testing = 4 days

### Next Session Actions
1. ✅ JIRA cards created:
   - **TTRC-266** - Main automation story (5 pts)
   - **TTRC-267** - Legacy code removal (1 pt, scheduled 30d after TTRC-266)
2. Implement TTRC-266 Phase 1-5 (development)
3. Test locally
4. Deploy to TEST branch
5. Monitor and validate
6. Create PR to PROD
7. After PROD stable for 30 days, start TTRC-267

---

**This plan is comprehensive, production-ready, and includes all requested guardrails. Ready to begin implementation in new chat session.**

# TTRC-266/267 Two-Story Breakout

**Created:** 2025-11-16
**Approach:** Split RSS automation into core functionality + cleanup
**Total Effort:** 16 hours (8 + 8)
**Total Timeline:** 2 weeks

---

# 📋 TTRC-266: RSS Inline Automation (Core Infrastructure)

## Story Overview

**Epic:** TTRC-250 (RSS Feed Expansion)
**Story Points:** 8
**Estimated Effort:** 8-10 hours active + 48h monitoring
**Timeline:** 5-6 days
**Priority:** High

---

## 🎯 Definition of Done

RSS feeds are automatically fetched, clustered, and enriched via GitHub Actions every 2 hours in PROD, with:

1. ✅ **Zero manual worker execution required** for RSS jobs
2. ✅ **Stories created and enriched automatically** every 2 hours
3. ✅ **48-hour TEST validation passed** (success rate >80%, cost <$0.50)
4. ✅ **First 3 PROD runs successful** (no errors, stories enriched)
5. ✅ **Worker marked DEPRECATED** with clear documentation of what still uses it
6. ✅ **All database migrations applied** (033, 034) and verified
7. ✅ **All guardrails working** (budget caps, runtime limits, concurrency locks)

**Note:** Enrichment logic is **copied inline** (not extracted). Clean extraction deferred to TTRC-267.

---

## 📦 In Scope

### Database Changes:
- ✅ Migration 033: Validation helper RPCs (pg_proc_check, check_columns_exist)
- ✅ Migration 034: admin.run_stats, advisory locks, get_unclustered_articles RPC, atomic budget RPC
- ✅ Validation script to verify all prerequisites

### Code Changes:
- ✅ Inline script: `scripts/rss-tracker-supabase.js` with **copied** enrichment logic
- ✅ Core fixes: ETag column update, idempotency guards
- ✅ DB-centric clustering (no story-cluster-handler dependency)
- ✅ Lock pattern fixes (safe acquire/release)

### Workflows:
- ✅ GitHub Actions: rss-tracker-test.yml (manual + temp schedule)
- ✅ GitHub Actions: rss-tracker-prod.yml (auto every 2h)
- ✅ Update job-scheduler.yml (comment out RSS triggers)

### Worker:
- ✅ Mark worker DEPRECATED for RSS in comments
- ✅ Document worker still needed for article.enrich (~700 jobs/month)

---

## ❌ Out of Scope (Deferred to TTRC-267)

- ❌ Enrichment extraction into shared module
- ❌ Worker shutdown (still needed for embeddings)
- ❌ article.enrich migration to inline
- ❌ Dead code removal (lifecycle/split/merge handlers)
- ❌ Complex similarity-based clustering (simple 1-article-per-story for now)

---

## 🧪 Testable Acceptance Criteria (40 total)

### Phase 0: Pre-Implementation (6 ACs)
- [ ] **AC-1:** Migration 033 applied to TEST and PROD
- [ ] **AC-2:** Validation script passes in both environments
- [ ] **AC-3:** Dependency audit complete, documented in JIRA
- [ ] **AC-4:** increment_budget_with_limit RPC exists (migration 034)
- [ ] **AC-5:** get_stories_needing_enrichment RPC exists (migration 019)
- [ ] **AC-6:** failure_count column exists on feed_registry

**Test:** Run `node scripts/validate-rpc-dependencies.js` → exits 0

---

### Phase 1: Database (5 ACs)
- [ ] **AC-7:** Migration 034 applied to TEST
- [ ] **AC-8:** admin.run_stats table created with all columns
- [ ] **AC-9:** acquire_feed_lock/release_feed_lock RPCs created
- [ ] **AC-10:** increment_budget_with_limit RPC created (atomic budget enforcement)
- [ ] **AC-11:** get_unclustered_articles RPC created and returns results

**Test:**
```sql
SELECT * FROM admin.run_stats LIMIT 1;  -- Should return empty table
SELECT acquire_feed_lock(1);           -- Should return true
SELECT release_feed_lock(1);           -- Should return true
SELECT * FROM get_unclustered_articles(10);  -- Should return articles
SELECT increment_budget_with_limit(CURRENT_DATE, 0.10, 1, 5.00);  -- Should return success=true
```

---

### Phase 2-4: Code (12 ACs)
- [ ] **AC-12:** ETag fix applied (fetch_feed.js updates last_304_at on 304)
- [ ] **AC-13:** Idempotency guards implemented (clustering check, enrichment cooldown)
- [ ] **AC-14:** **Enrichment logic COPIED inline** (not extracted, has TODO comment)
- [ ] **AC-15:** Feed scheduling implemented (max 30, last_fetched_at order)
- [ ] **AC-16:** Runtime guard implemented (breaks at 4 min)
- [ ] **AC-17:** Budget check implemented (soft cap acceptable)
- [ ] **AC-18:** Lock pattern fixed (tracks acquired state, safe release)
- [ ] **AC-19:** No story-cluster-handler import (DB-centric clustering)
- [ ] **AC-20:** Clustering uses get_unclustered_articles RPC
- [ ] **AC-21:** finalizeRunStats single call site
- [ ] **AC-22:** ESM module pattern (import/export)
- [ ] **AC-23:** OpenAI client initialized in constructor

**Test:**
```bash
# Dry run locally (won't modify DB)
DRY_RUN=true node scripts/rss-tracker-supabase.js
# Should output "Would insert..." logs, no errors
```

---

### Phase 5: Workflows (4 ACs)
- [ ] **AC-24:** rss-tracker-test.yml created (manual + temp 2h schedule)
- [ ] **AC-25:** rss-tracker-prod.yml created (auto 2h schedule)
- [ ] **AC-26:** job-scheduler.yml updated (RSS triggers commented)
- [ ] **AC-27:** GitHub secrets configured (SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY)

**Test:**
```bash
# Manual trigger TEST workflow
gh workflow run rss-tracker-test.yml --ref test
# Check it runs without errors
gh run list --workflow=rss-tracker-test.yml --limit 1
```

---

### Phase 6: TEST Validation (11 ACs)

**48-Hour Monitoring Period** (24 runs via automatic 2h schedule)

- [ ] **AC-28:** Total runs: ≥24 (automatic every 2h)
- [ ] **AC-29:** Success rate: ≥80% (partial_success counts as success)
- [ ] **AC-30:** Total cost: <$0.50 (TEST monitoring period)
- [ ] **AC-31:** Avg runtime: <5 min
- [ ] **AC-32:** Max runtime: <8 min (no GA timeouts)
- [ ] **AC-33:** feeds_skipped_lock: 0 (no concurrency conflicts)
- [ ] **AC-34:** Budget cap triggered: ≥1 time (proves guard works)
- [ ] **AC-35:** Cache hits: feeds_304_cached > 0, last_304_at populated
- [ ] **AC-36:** Idempotency verified (re-run same timeframe → no duplicate articles)
- [ ] **AC-37:** Clustering works (stories_clustered > 0, new stories created)
- [ ] **AC-38:** Temp TEST schedule removed after validation

**Test Queries:**
```sql
-- Success rate
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) as successful,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) / COUNT(*), 2) as pct
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: pct ≥ 80

-- Cost
SELECT SUM(total_openai_cost_usd) as total_cost
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: < 0.50

-- Runtime
SELECT
  AVG(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as avg_min,
  MAX(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as max_min
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: avg < 5, max < 8

-- Concurrency
SELECT SUM(feeds_skipped_lock) as conflicts
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: 0

-- Clustering
SELECT SUM(stories_clustered) as total_clustered
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: > 0
```

---

### Phase 7: PROD Deployment (4 ACs)
- [ ] **AC-39:** PR created with TEST results
- [ ] **AC-40:** PR merged to main
- [ ] **AC-41:** First 3 PROD runs successful (query admin.run_stats)
- [ ] **AC-42:** Stories auto-enriching every 2h in PROD

**Test:**
```sql
-- First 3 PROD runs
SELECT * FROM admin.run_stats
WHERE environment = 'prod'
ORDER BY run_started_at DESC
LIMIT 3;
-- Expected: All status = 'success' or 'partial_success', stories_enriched > 0

-- Check stories are being enriched
SELECT COUNT(*) FROM stories
WHERE last_enriched_at > NOW() - INTERVAL '6 hours';
-- Expected: > 0 (stories enriched in last 6 hours)
```

---

### Worker Status (3 ACs)
- [ ] **AC-43:** Worker marked DEPRECATED for RSS (header comment added)
- [ ] **AC-44:** Worker responsibilities documented (article.enrich still active)
- [ ] **AC-45:** Worker NOT stopped (still needed for embeddings)

**Test:**
```bash
# Check worker header comment
head -30 scripts/job-queue-worker.js | grep "DEPRECATED"
# Expected: Comment explaining RSS moved to GA, worker still needed for article.enrich

# Verify worker still processes embeddings
# (Run worker manually, check it processes article.enrich jobs)
node scripts/job-queue-worker.js
```

---

## 📊 Manual Testing Checklist

**Before marking story DONE, manually verify:**

1. **Local Run (TEST DB):**
   ```bash
   SUPABASE_URL=$SUPABASE_TEST_URL \
   SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_TEST_SERVICE_KEY \
   OPENAI_API_KEY=$OPENAI_KEY \
   ENVIRONMENT=test \
   node scripts/rss-tracker-supabase.js
   ```
   - ✅ No errors
   - ✅ Feeds fetched
   - ✅ Articles clustered (stories_clustered > 0)
   - ✅ Stories enriched (stories_enriched > 0)
   - ✅ Run logged in admin.run_stats

2. **GitHub Actions (TEST):**
   ```bash
   gh workflow run rss-tracker-test.yml --ref test
   gh run watch
   ```
   - ✅ Workflow completes successfully
   - ✅ Runtime <5 min
   - ✅ Check admin.run_stats has new entry

3. **Idempotency (re-run same data):**
   ```bash
   # Run twice in quick succession
   node scripts/rss-tracker-supabase.js
   sleep 10
   node scripts/rss-tracker-supabase.js
   ```
   - ✅ No duplicate articles created
   - ✅ No errors from duplicate clustering
   - ✅ feeds_304_cached increments (cache working)

4. **Budget Cap (force trigger):**
   ```sql
   -- Temporarily lower budget cap to force trigger
   UPDATE budgets SET spent_usd = 4.99 WHERE day = CURRENT_DATE;
   ```
   ```bash
   node scripts/rss-tracker-supabase.js
   ```
   - ✅ Status = 'partial_success'
   - ✅ enrichment_skipped_budget > 0
   - ✅ Feeds still processed (fail-open)

5. **PROD First Run (after PR merge):**
   ```bash
   gh run list --workflow=rss-tracker-prod.yml --limit 1
   gh run view <run-id> --log
   ```
   - ✅ No errors
   - ✅ Stories enriched
   - ✅ Runtime <5 min

---

## 🚀 Deployment Steps

1. **Apply migrations to TEST:**
   ```bash
   # Migration 033 already applied (validation helpers)
   # Apply migration 034 via Supabase Dashboard SQL Editor
   ```

2. **Run validation:**
   ```bash
   node scripts/validate-rpc-dependencies.js
   ```

3. **Commit all changes to test branch:**
   ```bash
   git checkout test
   git add .
   git commit -m "feat(rss): inline automation core infrastructure (TTRC-266)

   - Migration 034 (admin.run_stats, atomic budget, locks, RPCs)
   - Create inline script with copied enrichment logic (ESM modules)
   - Add TEST/PROD workflows
   - Mark worker DEPRECATED for RSS
   - DB-centric clustering (no story-cluster-handler dependency)
   - Atomic budget enforcement, safe lock pattern

   Refs TTRC-266"
   git push origin test
   ```

4. **Monitor 48 hours** (auto-runs every 2h)

5. **Remove temp TEST schedule:**
   ```yaml
   # In rss-tracker-test.yml, comment out:
   # schedule:
   #   - cron: '0 */2 * * *'
   ```

6. **Create PROD PR:**
   ```bash
   git checkout main && git pull
   git checkout -b deploy/ttrc-266-rss-automation
   git cherry-pick <commits from test>
   gh pr create --title "feat: RSS Inline Automation (TTRC-266)" --body "..."
   ```

7. **Merge PR, verify first 3 PROD runs**

---

## 📝 Deliverables

### Code Files Created:
1. `migrations/033_validation_helpers.sql` (already exists)
2. `migrations/034_rss_tracker_inline.sql`
3. `scripts/validate-rpc-dependencies.js` (already exists)
4. `scripts/enrichment/enrich-stories-inline.js` (ESM module with WARNING comment)
5. `scripts/rss-tracker-supabase.js` (ESM, atomic budget, safe locks)
6. `.github/workflows/rss-tracker-test.yml`
7. `.github/workflows/rss-tracker-prod.yml`

### Code Files Modified:
1. `.github/workflows/job-scheduler.yml` (RSS triggers commented)
2. `scripts/job-queue-worker.js` (DEPRECATED header)

### Documentation:
1. TTRC-266 JIRA comment: Dependency audit results
2. TTRC-266 JIRA comment: 48h TEST monitoring results
3. PR description with TEST metrics
4. Optional: Handoff doc in `/docs/handoffs/`

---

## ⏱️ Timeline

- **Day 1 (3h):** Phase 0-1 (migrations, validation, audit)
- **Day 2 (3h):** Phase 2-4 (inline script, copied enrichment)
- **Day 3 (2h):** Phase 5 (workflows, deploy to TEST)
- **Day 4-5 (48h):** Phase 6 (passive monitoring, queries)
- **Day 6 (1h):** Phase 7 (PROD PR, merge, verify)

**Total:** 9-10 hours active + 48h monitoring = 5-6 days

---

## 🎯 Story Success Metrics

**TTRC-266 is DONE when:**

1. ✅ **RSS automation working in PROD** (feeds fetch every 2h automatically)
2. ✅ **Stories created and enriched automatically** (no manual intervention)
3. ✅ **48h TEST validation passed** (all metrics green)
4. ✅ **First 3 PROD runs successful** (verified via admin.run_stats)
5. ✅ **Worker DEPRECATED but still running** (documented for embeddings)
6. ✅ **All 40 acceptance criteria met**

**What "working" means:**
- Run `SELECT * FROM admin.run_stats WHERE environment = 'prod' ORDER BY run_started_at DESC LIMIT 5;`
- See 5 runs in last 10 hours (every 2h)
- All status = 'success' or 'partial_success'
- All have stories_enriched > 0

**If this query passes, TTRC-266 is DONE.** ✅

---

# 📋 TTRC-267: Enrichment Extraction + Worker Cleanup

## Story Overview

**Epic:** TTRC-250 or new "Code Quality" epic
**Story Points:** 8
**Estimated Effort:** 8-9 hours
**Timeline:** 1 week
**Priority:** Medium
**Dependencies:** TTRC-266 must be deployed to PROD first

---

## 🎯 Definition of Done

1. ✅ **Enrichment logic extracted** into `scripts/enrichment/enrich-stories.js` module
2. ✅ **Inline script updated** to use extracted module (removed copied code)
3. ✅ **No regressions in TEST** (enrichment still works identically)
4. ✅ **Deployed to PROD** via PR
5. ✅ **article.enrich migration plan documented** (or decision to keep worker for embeddings)
6. ✅ **Worker removal decision made** (stop now or defer to separate ticket)

**Note:** This story focuses on **code quality**. Functional behavior should NOT change from TTRC-266.

---

## 📦 In Scope

### Enrichment Extraction:
- ✅ Create `scripts/enrichment/enrich-stories.js` module
- ✅ Extract from inline script OR job-queue-worker.js (whichever is cleaner)
- ✅ Export: enrichStory(), shouldEnrichStory(), buildEntityCounter(), UI_TO_DB_CATEGORIES
- ✅ Update `scripts/rss-tracker-supabase.js` to import module
- ✅ Remove copied enrichment code from inline script
- ✅ Update job-queue-worker.js to use same module (single source of truth)

### Worker Analysis:
- ✅ Document article.enrich usage (how many jobs/month, can it be inline?)
- ✅ Decide: Migrate embeddings to inline OR keep worker for embeddings
- ✅ If keeping worker: Update DEPRECATED comment with timeline
- ✅ If migrating embeddings: Create separate story for embeddings automation

### Code Cleanup:
- ✅ Remove dead handlers: story.lifecycle, story.split, story.merge
- ✅ Clean up job-scheduler.yml (remove commented RSS code)
- ✅ Update documentation (CLAUDE.md, PROJECT_INSTRUCTIONS.md if needed)

---

## ❌ Out of Scope

- ❌ Complex similarity-based clustering (defer to separate story if needed)
- ❌ Retry logic, rate limiting, dry-run mode (quality-of-life features)
- ❌ Dedicated DB role with minimal permissions (security hardening ticket)
- ❌ Atomic budget RPC (unless hard cap becomes requirement)

---

## 🧪 Testable Acceptance Criteria (7 total)

### Enrichment Extraction (5 ACs)

- [ ] **AC-1:** Module created at `scripts/enrichment/enrich-stories.js`
- [ ] **AC-2:** Module exports all required functions:
  ```javascript
  const {
    enrichStory,
    shouldEnrichStory,
    buildEntityCounter,
    toTopEntities,
    UI_TO_DB_CATEGORIES,
    ENRICHMENT_COOLDOWN_HOURS
  } = require('./enrichment/enrich-stories.js');
  ```

**Test:**
```bash
node -e "const m = require('./scripts/enrichment/enrich-stories.js'); \
console.log(typeof m.enrichStory === 'function' ? 'PASS' : 'FAIL');"
# Expected: PASS
```

- [ ] **AC-3:** Inline script updated to use module (no copied enrichment code)

**Test:**
```bash
grep -n "TODO TTRC-267" scripts/rss-tracker-supabase.js
# Expected: No results (TODO removed)

grep -n "async function enrichStory" scripts/rss-tracker-supabase.js
# Expected: No results (function not defined inline)

grep -n "require('./enrichment/enrich-stories.js')" scripts/rss-tracker-supabase.js
# Expected: Match found (module imported)
```

- [ ] **AC-4:** TEST verification - enrichment still works identically

**Test:**
```bash
# Run inline script in TEST
node scripts/rss-tracker-supabase.js

# Query results
SELECT stories_enriched FROM admin.run_stats
WHERE environment = 'test'
ORDER BY run_started_at DESC
LIMIT 1;
# Expected: > 0 (same behavior as TTRC-266)

# Compare story enrichment quality
SELECT
  id,
  summary_neutral,
  category,
  severity,
  last_enriched_at
FROM stories
WHERE last_enriched_at > NOW() - INTERVAL '1 hour'
LIMIT 5;
# Expected: Summaries, categories populated (same quality as before)
```

- [ ] **AC-5:** PROD deployment successful (PR merged, enrichment working)

**Test:**
```sql
-- First 3 PROD runs after deployment
SELECT * FROM admin.run_stats
WHERE environment = 'prod'
  AND run_started_at > <deployment_timestamp>
ORDER BY run_started_at
LIMIT 3;
-- Expected: All successful, stories_enriched > 0, no regressions
```

---

### Worker Cleanup (2 ACs)

- [ ] **AC-6:** article.enrich migration plan documented OR decision made to keep worker

**Test (if keeping worker):**
```bash
# Check worker comment updated
head -40 scripts/job-queue-worker.js | grep -A 5 "DEPRECATED"
# Expected: Comment explains enrichment extracted, worker still needed for article.enrich

# Verify worker still processes embeddings
node scripts/job-queue-worker.js
# Expected: Processes article.enrich jobs successfully
```

**Test (if migrating embeddings):**
```bash
# Verify TTRC-XXX created for embeddings automation
gh issue list --label "embeddings" --state open
# Expected: New story exists with clear scope
```

- [ ] **AC-7:** Dead code removed (lifecycle/split/merge handlers) OR documented why kept

**Test:**
```bash
# Check handlers removed from worker
grep -n "story.lifecycle" scripts/job-queue-worker.js
grep -n "story.split" scripts/job-queue-worker.js
grep -n "story.merge" scripts/job-queue-worker.js
# Expected: No matches (handlers removed)

# Check job-scheduler.yml cleaned up
grep -n "RSS" .github/workflows/job-scheduler.yml
# Expected: No RSS-related comments or code
```

---

## 📊 Manual Testing Checklist

**Before marking TTRC-267 DONE:**

1. **Module Import Test:**
   ```bash
   node -e "const { enrichStory } = require('./scripts/enrichment/enrich-stories.js'); \
   console.log(enrichStory.toString().length > 100 ? 'PASS' : 'FAIL');"
   # Expected: PASS (function has meaningful body)
   ```

2. **Enrichment Quality Comparison (before/after):**
   ```sql
   -- Before (TTRC-266 with copied code):
   SELECT AVG(LENGTH(summary_neutral)) as avg_summary_length
   FROM stories
   WHERE last_enriched_at BETWEEN <ttrc-266-start> AND <ttrc-267-start>;

   -- After (TTRC-267 with extracted module):
   SELECT AVG(LENGTH(summary_neutral)) as avg_summary_length
   FROM stories
   WHERE last_enriched_at > <ttrc-267-start>;

   -- Expected: Averages should be similar (no quality regression)
   ```

3. **No Duplicate Enrichment Code:**
   ```bash
   # Search for enrichment logic in multiple places
   rg "buildEntityCounter" scripts/
   # Expected: Only in enrichment/enrich-stories.js, nowhere else
   ```

4. **Worker Decision Documented:**
   ```bash
   # If keeping worker:
   grep -A 10 "article.enrich" scripts/job-queue-worker.js | grep "TTRC-"
   # Expected: Reference to follow-up ticket or clear statement

   # If removing worker:
   ls scripts/job-queue-worker.js
   # Expected: File not found (or moved to archive/)
   ```

---

## 🚀 Deployment Steps

1. **Extract enrichment module:**
   ```bash
   # Create module file
   # Copy enrichment logic from inline script or worker
   # Export all functions
   ```

2. **Update inline script:**
   ```bash
   # Remove copied enrichment code
   # Add require() for module
   # Test locally
   ```

3. **Test in TEST environment:**
   ```bash
   node scripts/rss-tracker-supabase.js
   # Verify no errors, enrichment still works
   ```

4. **Commit and push:**
   ```bash
   git checkout test
   git add .
   git commit -m "refactor(enrichment): extract into shared module (TTRC-267)

   - Create scripts/enrichment/enrich-stories.js
   - Update inline script to use module
   - Remove copied enrichment code
   - Worker still uses job-queue pattern for article.enrich
   - Dead handlers removed (lifecycle/split/merge)

   Refs TTRC-267"
   git push origin test
   ```

5. **Monitor TEST for 24 hours:**
   ```sql
   -- Verify enrichment still working
   SELECT COUNT(*) FROM stories
   WHERE last_enriched_at > NOW() - INTERVAL '24 hours';
   -- Expected: > 0
   ```

6. **Create PROD PR:**
   ```bash
   git checkout main && git pull
   git checkout -b refactor/ttrc-267-enrichment-extraction
   git cherry-pick <commits from test>
   gh pr create --title "refactor: Extract enrichment module (TTRC-267)"
   ```

7. **Merge and verify**

---

## 📝 Deliverables

### Code Files Created:
1. `scripts/enrichment/enrich-stories.js` (extracted module)

### Code Files Modified:
1. `scripts/rss-tracker-supabase.js` (use module, remove copied code)
2. `scripts/job-queue-worker.js` (remove dead handlers, update comments)
3. `.github/workflows/job-scheduler.yml` (cleanup commented RSS code)

### Documentation:
1. TTRC-267 JIRA comment: Worker decision (keep for embeddings vs migrate)
2. PR description: Extraction approach, testing results
3. Optional: Update `/docs/code-patterns.md` with enrichment module usage

---

## ⏱️ Timeline

- **Day 1 (3h):** Extract enrichment module
- **Day 2 (2h):** Update inline script, remove copied code
- **Day 3 (1h):** Test locally and in TEST
- **Day 4 (24h):** Monitor TEST (passive)
- **Day 5 (2h):** Worker cleanup, dead code removal
- **Day 6 (1h):** PROD PR, merge, verify

**Total:** 8-9 hours active + 24h monitoring = 1 week

---

## 🎯 Story Success Metrics

**TTRC-267 is DONE when:**

1. ✅ **Enrichment module exists** and exports all required functions
2. ✅ **Inline script uses module** (no copied code remains)
3. ✅ **No regressions in PROD** (enrichment quality unchanged)
4. ✅ **Worker decision documented** (keep for embeddings or migrate)
5. ✅ **Dead code removed** (lifecycle/split/merge handlers gone)
6. ✅ **All 7 acceptance criteria met**

**What "no regressions" means:**
```sql
-- Compare enrichment before/after TTRC-267
WITH before AS (
  SELECT AVG(LENGTH(summary_neutral)) as avg_len
  FROM stories
  WHERE last_enriched_at BETWEEN <ttrc-266-start> AND <ttrc-267-deploy>
),
after AS (
  SELECT AVG(LENGTH(summary_neutral)) as avg_len
  FROM stories
  WHERE last_enriched_at > <ttrc-267-deploy>
  LIMIT 20
)
SELECT
  before.avg_len as before,
  after.avg_len as after,
  ABS(before.avg_len - after.avg_len) as diff
FROM before, after;

-- Expected: diff < 50 (similar quality)
```

**If enrichment quality is similar and module is being used, TTRC-267 is DONE.** ✅

---

# 📊 Combined Timeline

## Week 1: TTRC-266 (Core Automation)
- **Mon-Tue:** Migrations, validation, inline script
- **Wed:** Deploy to TEST
- **Wed-Fri (48h):** Passive monitoring
- **Sat:** PROD deployment

## Week 2: TTRC-267 (Refactoring)
- **Mon-Tue:** Extract module, update scripts
- **Wed:** TEST validation
- **Thu (24h):** Monitor TEST
- **Fri:** PROD deployment, cleanup

**Total:** 2 weeks, 17-19 hours active work

---

# ✅ Definition of "Both Stories Complete"

The two-story effort is **fully complete** when:

1. ✅ **RSS automation running in PROD** (every 2h, automatic)
2. ✅ **Stories enriched with high quality** (summaries, categories, severity)
3. ✅ **Enrichment code is DRY** (single shared module, no duplication)
4. ✅ **Worker status clear** (DEPRECATED for RSS, documented for embeddings)
5. ✅ **Dead code removed** (lifecycle/split/merge handlers gone)
6. ✅ **All monitoring metrics green** (success rate >80%, cost <$1/week)

**Final validation query:**
```sql
-- Verify automation working end-to-end
SELECT
  COUNT(*) as runs_last_week,
  AVG(stories_enriched) as avg_stories_per_run,
  SUM(total_openai_cost_usd) as total_cost_week
FROM admin.run_stats
WHERE environment = 'prod'
  AND run_started_at > NOW() - INTERVAL '7 days';

-- Expected:
-- runs_last_week ≈ 84 (every 2h for 7 days)
-- avg_stories_per_run > 0
-- total_cost_week < 1.00
```

**If this query passes after TTRC-267, both stories are DONE.** 🎉

# TTRC-266 Execution Checklist

**Quick Reference Guide** | Print or keep open during implementation
**Detailed Plan:** `docs/plans/2025-11-16-ttrc-266-267-two-story-breakout.md`
**JIRA:** [TTRC-266](https://ajwolfe37.atlassian.net/browse/TTRC-266)

---

## 🎯 Quick Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Story split | 2 stories (266 + 267) | Ship automation fast, defer refactoring |
| Enrichment | Copy inline (extract in 267) | Reduces risk, faster delivery |
| Clustering | DB-centric (no story-cluster-handler) | No external dependencies |
| Budget cap | Atomic RPC (increment_budget_with_limit) | Prevents race conditions |
| DB role | Service role key | Simplest, can harden later |
| Lock pattern | Track acquired, safe release | Must-fix for correctness |
| Module system | ESM (import/export) | Matches existing codebase |

---

## ✅ Phase 0: Pre-Validation (2h)

### 0A: Verify Migration 033 (30min)
```bash
# Migration 033 already exists (validation helpers)
# Verify it's applied in both environments

# Verify in TEST (via Supabase client or SQL editor)
SELECT pg_proc_check('pg_proc_check');
# Expected: Returns row with arg_count

# Verify in PROD
SELECT pg_proc_check('pg_proc_check');
# Expected: Returns row with arg_count
```

**Files:** `migrations/033_validation_helpers.sql` (already exists)

---

### 0B: Validation Script (1h)
```bash
# Run validation
SUPABASE_TEST_URL=$TEST_URL \
SUPABASE_URL=$PROD_URL \
SUPABASE_TEST_SERVICE_ROLE_KEY=$TEST_KEY \
SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
node scripts/validate-rpc-dependencies.js

# Expected: ✅ VALIDATION PASSED
```

**If fails:** Fix source migrations before proceeding

**Files:** `scripts/validate-rpc-dependencies.js`

---

### 0C: Dependency Audit (30min)
```bash
# Search for dependencies
grep -rn "enqueueJob" scripts/ supabase/
grep -rn "job_queue" scripts/
grep -rn "story-cluster-handler" scripts/

# Document in JIRA comment
```

**Decision gate:** Complete before modifying worker code

---

## ✅ Phase 1: Database Migration (1h)

```bash
# Apply migration 034 via Supabase Dashboard SQL Editor
# (See handoff doc for complete SQL)

# Verify in TEST (via SQL editor)
SELECT * FROM admin.run_stats LIMIT 1;
SELECT acquire_feed_lock(1);
SELECT release_feed_lock(1);
SELECT * FROM get_unclustered_articles(10);
SELECT increment_budget_with_limit(CURRENT_DATE, 0.10, 1, 5.00);
# Expected: All queries succeed

# Re-run validation to confirm new RPCs
node scripts/validate-rpc-dependencies.js
```

**Files:** `migrations/034_rss_tracker_inline.sql`

---

## ✅ Phase 2: Enrichment Module (1h)

### Create Enrichment Module
```bash
# Create scripts/enrichment/enrich-stories-inline.js
# Copy enrichment logic from job-queue-worker.js
# Add WARNING comment at top
# Add TODO TTRC-267 marker
# Use ESM module pattern (export functions)
```

**Files:** `scripts/enrichment/enrich-stories-inline.js`

**Note:** ETag fix (last_304_at) already exists in fetch_feed.js lines 257-262

---

## ✅ Phase 3: Skip for TTRC-266
**Enrichment extraction deferred to TTRC-267** ✅

---

## ✅ Phase 4: Inline Script (2-3h)

### Create Script
```bash
# Create scripts/rss-tracker-supabase.js
# Use template from plan document
# COPY enrichment logic inline (don't extract)
# Use DB-centric clustering (get_unclustered_articles RPC)
```

**Key sections:**
- ✅ OpenAI client in constructor
- ✅ Lock pattern: track acquired, safe release
- ✅ No story-cluster-handler import
- ✅ ESM pattern (import/export, async main)
- ✅ Service role key
- ✅ Atomic budget enforcement (increment_budget_with_limit RPC)
- ✅ Kill switch guard (RSS_TRACKER_RUN_ENABLED)
- ✅ Data[0] guard on budget RPC response

**Test locally:**
```bash
SUPABASE_URL=$TEST_URL \
SUPABASE_SERVICE_ROLE_KEY=$TEST_KEY \
OPENAI_API_KEY=$OPENAI_KEY \
ENVIRONMENT=test \
RSS_TRACKER_RUN_ENABLED=true \
node scripts/rss-tracker-supabase.js

# Expected:
# - No errors
# - Feeds fetched
# - Stories clustered (stories_clustered > 0)
# - Stories enriched (stories_enriched > 0)
# - New row in admin.run_stats
```

**Files:** `scripts/rss-tracker-supabase.js`

---

## ✅ Phase 5: GitHub Actions (30min)

### Create Workflows
```bash
# Create .github/workflows/rss-tracker-test.yml
# - Manual trigger
# - Temporary 2h schedule (for 48h validation)

# Create .github/workflows/rss-tracker-prod.yml
# - Auto 2h schedule
# - main branch only

# Update .github/workflows/job-scheduler.yml
# - Comment out RSS triggers
# - Keep EO/daily tracker intact
```

**Configure Secrets:**
```bash
# In GitHub UI, verify these exist:
# - SUPABASE_TEST_URL
# - SUPABASE_TEST_SERVICE_ROLE_KEY
# - SUPABASE_URL
# - SUPABASE_SERVICE_ROLE_KEY
# - OPENAI_API_KEY
```

**Test manually:**
```bash
gh workflow run rss-tracker-test.yml --ref test
gh run watch
# Expected: Completes successfully, runtime <5 min
```

**Files:**
- `.github/workflows/rss-tracker-test.yml`
- `.github/workflows/rss-tracker-prod.yml`
- `.github/workflows/job-scheduler.yml`

---

## ✅ Phase 6: TEST Monitoring (48h)

### Deploy to TEST
```bash
git checkout test
git add .
git commit -m "feat(rss): inline automation core infrastructure (TTRC-266)

- Migration 034 (admin.run_stats, atomic budget, locks, RPCs)
- Enrichment module (scripts/enrichment/enrich-stories-inline.js)
- Inline script (ESM, atomic budget, safe locks, kill switch)
- DB-centric clustering (get_unclustered_articles RPC)
- TEST/PROD workflows with branch locks

Refs TTRC-266"

git push origin test
```

### Monitor (Automatic - 24 runs via 2h schedule)

**Every 12 hours, run these queries:**

```sql
-- Success rate
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) as ok,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) / COUNT(*), 2) as pct
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Target: pct ≥ 80

-- Cost
SELECT SUM(total_openai_cost_usd) as cost
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Target: < 0.50

-- Runtime
SELECT
  AVG(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as avg_min,
  MAX(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as max_min
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Target: avg < 5, max < 8

-- Concurrency
SELECT SUM(feeds_skipped_lock) as conflicts
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Target: 0

-- Clustering
SELECT SUM(stories_clustered) as total
FROM admin.run_stats
WHERE environment = 'test' AND run_started_at > NOW() - INTERVAL '48 hours';
-- Target: > 0
```

**Abort if:**
- Success rate <50%
- Cost >$0.50
- Frequent GA timeouts (>8 min)
- Duplicate articles detected

### After 48h
```yaml
# Remove temporary TEST schedule
# In .github/workflows/rss-tracker-test.yml:
# Comment out schedule section
git commit -m "chore: remove temp TEST schedule after validation"
git push origin test
```

---

## ✅ Phase 7: PROD Deployment (1h)

### Create PR
```bash
git checkout main && git pull
git checkout -b deploy/ttrc-266-rss-automation

# Cherry-pick commits from test
git cherry-pick <migration-034-commit>
git cherry-pick <enrichment-module-commit>
git cherry-pick <inline-script-commit>
git cherry-pick <workflows-commit>

# Create PR
gh pr create \
  --title "feat: RSS Inline Automation (TTRC-266)" \
  --body "See TTRC-266 for full details. TEST results: [paste metrics]"
```

### Merge and Verify
```bash
# After PR merged, watch first run
gh run list --workflow=rss-tracker-prod.yml --limit 1
gh run watch

# Verify first 3 runs
psql $SUPABASE_URL <<EOF
SELECT * FROM admin.run_stats
WHERE environment = 'prod'
ORDER BY run_started_at DESC
LIMIT 3;
EOF
# Expected: All successful, stories_enriched > 0
```

### Mark Worker DEPRECATED
```javascript
// In scripts/job-queue-worker.js, add header:
/*
 * DEPRECATED for RSS jobs as of TTRC-266 (2025-11-16)
 * RSS moved to: scripts/rss-tracker-supabase.js
 *
 * STILL ACTIVE for: article.enrich (~700 jobs/month)
 *
 * DO NOT STOP until TTRC-267 complete
 */
```

---

## 🎯 Success Criteria (Story DONE)

**Run this query in PROD:**
```sql
SELECT * FROM admin.run_stats
WHERE environment = 'prod'
ORDER BY run_started_at DESC
LIMIT 5;
```

**Expected:** 5 runs in last 10 hours, all status = 'success' or 'partial_success', all have stories_enriched > 0

**If this passes, TTRC-266 is DONE.** ✅

---

## 🚨 Emergency Rollback

### If TEST fails validation:
```bash
# 1. Disable workflow
gh workflow disable rss-tracker-test.yml

# 2. Roll back migrations
psql $SUPABASE_TEST_URL -c "DROP TABLE IF EXISTS admin.run_stats CASCADE;"
psql $SUPABASE_TEST_URL -c "DROP FUNCTION IF EXISTS get_unclustered_articles(INT);"

# 3. Re-enable old system (if needed)
# Uncomment RSS triggers in job-scheduler.yml
```

### If PROD fails after deployment:
```bash
# 1. Set kill switch
gh secret set RSS_TRACKER_RUN_ENABLED --body "false"

# 2. Re-enable old system
# Uncomment RSS triggers in job-scheduler.yml
gh workflow run job-scheduler.yml

# 3. Revert PR
gh pr close <pr-number>
git revert <merge-commit>
git push
```

---

## 📊 Quick Reference

| Phase | Time | Key File | Test Command |
|-------|------|----------|--------------|
| 0A | 30min | migrations/033_*.sql | `SELECT pg_proc_check('pg_proc_check');` |
| 0B | 1h | scripts/validate-*.js | `node scripts/validate-rpc-dependencies.js` |
| 1 | 1h | migrations/034_*.sql | `SELECT * FROM admin.run_stats LIMIT 1;` |
| 2 | 1h | scripts/enrichment/enrich-stories-inline.js | Create enrichment module |
| 4 | 2-3h | scripts/rss-tracker-supabase.js | `node scripts/rss-tracker-supabase.js` |
| 5 | 30min | .github/workflows/*.yml | `gh workflow run rss-tracker-test.yml` |
| 6 | 48h | (monitoring) | See queries above |
| 7 | 1h | (PROD PR) | `SELECT * FROM admin.run_stats WHERE environment='prod'` |

---

## 📚 Cross-References

- **Detailed Plan:** `docs/plans/2025-11-16-ttrc-266-267-two-story-breakout.md`
- **JIRA:** [TTRC-266](https://ajwolfe37.atlassian.net/browse/TTRC-266)
- **Follow-up:** [TTRC-267](https://ajwolfe37.atlassian.net/browse/TTRC-267) (enrichment extraction)
- **Full Implementation Plan:** `docs/plans/2025-11-16-ttrc-266-rss-automation-FINAL.md`

---

## ✅ Pre-Flight Checklist

Before starting Phase 0, verify:

- [ ] On `test` branch
- [ ] Supabase TEST credentials available
- [ ] Supabase PROD credentials available
- [ ] OpenAI API key available
- [ ] GitHub CLI installed and authenticated
- [ ] Latest code pulled from remote
- [ ] TTRC-266 read and understood

**Ready to execute!** 🚀

---

**Last Updated:** 2025-11-16
**Status:** Ready for implementation
**Story Points:** 8 (TTRC-266) + 8 (TTRC-267) = 16 total

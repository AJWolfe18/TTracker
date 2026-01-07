# TTRC-315 Post-Deployment Status Check

**Date:** 2025-12-18
**Query:** Check if any articles were ingested after TTRC-315 deployment (Dec 18, 2025) and if they clustered properly.

---

## Critical Finding: NO ARTICLES INGESTED AFTER DEC 18

### Timeline Analysis

| Date | Event | Status |
|------|-------|--------|
| **Dec 11, 2025 @ 11:42pm** | Last successful RSS tracker run on test branch | ✅ Success |
| **Dec 15, 2025 @ 12:29am** | TTRC-302 committed (topic slug canonicalization) | Code deployed |
| **Dec 18, 2025 @ 8:28pm** | TTRC-315 committed (tiered guardrail) | Code deployed |
| **Dec 15-18, 2025** | RSS tracker scheduled runs | ❌ All SKIPPED |

### Why Runs Are Being Skipped

The `rss-tracker-test.yml` workflow has a branch lock:
```yaml
if: github.ref == 'refs/heads/test'
```

However, the **scheduled runs (cron) are triggering on the `main` branch**, not the `test` branch. This causes the workflow to skip execution because of the branch guard.

**Evidence:**
- Last 10 scheduled runs show `"headBranch":"main"` and `"conclusion":"skipped"`
- Manual triggers on test branch work fine (last success: Dec 11)

---

## Last Known Clustering Performance (Dec 11, 2025)

From the successful Dec 11 run logs:

### Stats:
- **Feeds processed:** 17 feeds (17 succeeded, 0 failed)
- **Articles clustered:** 94 articles
- **Stories enriched:** 0 (runtime limit reached)
- **Embeddings generated:** 100
- **Entities extracted:** 32
- **Topic slugs extracted:** 38

### Clustering Behavior:
- **All 94 articles created NEW stories** (no merges observed)
- Best similarity scores: 0.509-0.561 (threshold: 0.700)
- Clustering performance: 586-684ms per article (target: <500ms p95)
- Candidate generation: 306-406ms (target: <100ms)

### Key Observations:
1. **Zero clustering occurred** - every article became its own story
2. This was BEFORE TTRC-315 was deployed, so the tiered guardrail wasn't active
3. Similarity scores were well below the 0.70 threshold (expected behavior pre-fix)

---

## Impact Assessment

### What We Know:
✅ TTRC-315 code is deployed to test branch (commits 877c119, fec597e)
✅ TTRC-302 code is deployed to test branch (commit 92ea810)
✅ QA tests pass (8/8 validation tests)
❌ **NO REAL-WORLD DATA** has been processed since deployment

### What We DON'T Know:
❓ Does TTRC-315 actually improve clustering in production?
❓ Are there false positives (over-clustering)?
❓ What is the new multi-article story rate? (baseline was 2%)

---

## Root Cause: GitHub Scheduled Workflow Branch Mismatch

The cron schedule in `rss-tracker-test.yml` runs **on the default branch (main)**, not on the test branch.

**From GitHub Actions docs:**
> Scheduled workflows run on the latest commit on the default or base branch.

Since the workflow has this guard:
```yaml
if: github.ref == 'refs/heads/test'
```

All scheduled runs on main are immediately skipped.

---

## Recommended Actions

### 1. IMMEDIATE: Trigger Manual RSS Run on Test Branch
```bash
gh workflow run "RSS Tracker - TEST" --ref test
```

This will:
- Fetch latest articles from 17 RSS feeds
- Apply TTRC-315 tiered guardrail logic
- Generate real clustering data for validation
- Allow monitoring of multi-article story rate

### 2. Fix Scheduled Runs (Choose One Option)

**Option A: Remove branch guard** (if test is the primary branch)
```yaml
# Remove this line from rss-tracker-test.yml
# if: github.ref == 'refs/heads/test'
```

**Option B: Change default branch to test** (in GitHub repo settings)
- Go to Settings → Branches → Default branch
- Change from `main` to `test`

**Option C: Create separate workflows**
- One for scheduled runs (no branch guard)
- One for test-only manual runs (with branch guard)

**Option D: Use workflow_dispatch only** (disable cron)
- Remove the `schedule:` trigger entirely
- Use manual triggers only for test environment

### 3. Monitor Next Run Results

After triggering the manual run, check:
- Multi-article story rate (target: >2%, ideally 10-20%)
- Max articles per story (watch for over-clustering)
- Similarity scores for merged articles (should be 0.85+)
- Merge reasons (set `LOG_CLUSTER_GUARDRAIL=true` temporarily)

### 4. Consider Re-clustering Last 7 Days

If TTRC-315 shows improvement:
- Run recluster script on articles from Dec 11-18 (before TTRC-315)
- Compare before/after clustering metrics
- Validate no false positives introduced

---

## Database Query Attempt Notes

Attempted to query Supabase TEST database directly but encountered:
1. No MCP tool available for direct Supabase queries
2. Supabase CLI doesn't support `--db-url` flag
3. Environment variable for TEST anon key not accessible locally
4. GitHub Actions secrets are the only source of truth

**Alternative data source used:** GitHub Actions workflow run logs (Dec 11 run)

---

## Summary

**Status:** TTRC-315 is deployed but **untested in production** due to workflow scheduling issue.

**Articles after Dec 18:** **ZERO** (all RSS runs skipped since Dec 11)

**Clustering validation:** Cannot assess real-world performance without new article ingestion.

**Next step:** Trigger manual RSS run on test branch to generate validation data.

**Rollback capability:** Feature flag `ENABLE_TIERED_GUARDRAIL=false` available for instant rollback if needed.

# PROD Workflow Fixes & Google Analytics

**Date:** 2026-01-08
**Ticket:** N/A (Urgent production fix + cleanup)
**Branch:** test (fixes deployed to main via PRs)
**Status:** COMPLETE

---

## Summary

Investigated and fixed PROD workflow failures caused by TTRC-362 security hardening regression. Also cleaned up legacy workflows, added Google Analytics to prod, and created follow-up tickets.

---

## What Was Done

### 1. Fixed PROD Workflow Failures (PR #33)
**Problem:** Daily Political Tracker and Executive Orders Tracker failing since Jan 8 with:
```
Error: Missing TARGET_ENV or ENVIRONMENT (prod|test)
```

**Root Cause:** TTRC-362 PROD hardening (PR #31) introduced `validateEnv()` requiring `ENVIRONMENT` env var, but these workflows weren't updated.

**Fix:** Added "Export env (prod|test)" step to both workflows:
- Sets both `ENVIRONMENT` and `TARGET_ENV` via `$GITHUB_ENV`
- Available to all subsequent steps (not just one)

**Files Changed:**
- `.github/workflows/daily-tracker.yml`
- `.github/workflows/executive-orders-tracker.yml`

### 2. Disabled Legacy Daily Political Tracker (PR #34)
**Discovery:** Daily Political Tracker is LEGACY - replaced by RSS Tracker.

| System | Script | Table | Status |
|--------|--------|-------|--------|
| RSS Tracker | `rss-tracker-supabase.js` | `stories` + `articles` | ✅ Current |
| Daily Political Tracker | `daily-tracker-supabase.js` | `political_entries` | ❌ Disabled |

**Fix:** Added `if: false` to disable the job, removed schedule trigger.

### 3. Disabled RSS Tracker TEST Schedule (commit 153944b)
- Removed scheduled runs (was every 2 hours)
- Kept `workflow_dispatch` for manual runs only
- PROD handles all scheduled RSS tracking now

### 4. Cleaned Up Stale Branch
- Deleted `claude/product-strategy-analysis-X4nXc` branch (was causing lint failures)
- Saved product strategy doc to `docs/archive/product-strategy-analysis-2026-01-08.md`

### 5. Added Google Analytics to PROD (PR #35)
**Tracking ID:** `G-5MDT4HFMNB`

**Files Updated:**
- `public/index.html` - GA4 scripts
- `public/executive-orders.html` - GA4 scripts
- `public/shared.js` - `trackEvent()` utility
- `public/app.js` - Event tracking for Stories page
- `public/eo-app.js` - Event tracking for EO page

**Events Tracked:**
- Search queries
- Category/severity/impact filter usage
- Sort changes
- Pagination clicks
- Story/EO detail views
- Theme toggles

### 6. Created Follow-up JIRA Card
**TTRC-367:** Investigate AI code review trigger configuration (push vs PR)
- Currently AI reviews only run on PRs
- Need to discuss if test branch should get push triggers too

---

## Current PROD Workflow Status

| Workflow | Schedule | Status |
|----------|----------|--------|
| RSS Tracker PROD | Every 2 hours | ✅ Running |
| RSS Tracker TEST | Manual only | ✅ Disabled schedule |
| Executive Orders Tracker | Daily 11 AM EST | ✅ Fixed |
| Daily Political Tracker | Disabled | ✅ Legacy, disabled |
| Job Queue Scheduler | Every hour | ✅ Running |

---

## PRs Merged This Session

| PR | Title | Status |
|----|-------|--------|
| #33 | fix(ci): add ENVIRONMENT/TARGET_ENV to daily/EO tracker workflows | Merged |
| #34 | chore(ci): disable legacy Daily Political Tracker workflow | Merged |
| #35 | feat(analytics): add Google Analytics with comprehensive event tracking | Merged |

---

## Files on Test Branch (Uncommitted)

| File | Status |
|------|--------|
| `docs/archive/product-strategy-analysis-2026-01-08.md` | Saved locally, not committed |
| `.github/workflows/rss-tracker-test.yml` | Schedule disabled (committed) |

---

## Known Issues / Follow-ups

### 1. AI Code Review Trigger (TTRC-367)
- Workflows show 0s "failures" on pushes (display quirk - workflow is PR-only)
- Need to decide if test branch should get push triggers
- Currently: PR-only for both main and test

### 2. AI Code Review 0s Failures
- The red X failures on pushes are NOT real failures
- The workflow doesn't have a `push` trigger, so GitHub shows it as "failed" immediately
- This is a UI display quirk, not actual failures

### 3. Product Strategy Doc
- Comprehensive analysis saved to `docs/archive/`
- Covers: analytics, retention, monetization, growth
- Not committed yet - review and decide if you want to keep

---

## Verification Commands

```bash
# Check PROD workflows are healthy
gh run list --limit 10

# Check RSS Tracker PROD
gh run list --workflow="rss-tracker-prod.yml" --limit 5

# Check EO Tracker (should succeed now)
gh run list --workflow="executive-orders-tracker.yml" --limit 5

# Manually trigger RSS TEST if needed
gh workflow run "RSS Tracker - TEST" --ref test
```

---

## Session Stats

- **Duration:** ~1.5 hours
- **PRs Merged:** 3 (#33, #34, #35)
- **JIRA Cards Created:** 1 (TTRC-367)
- **Branches Deleted:** 1 (claude/product-strategy-analysis-X4nXc)

---

**Next Session:** See recommendations below

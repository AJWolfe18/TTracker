# Handoff: EO Tracker Fixes + Workflow Cleanup (ADO-267, ADO-268)

**Date:** 2026-01-17
**ADO:** Bug 267 (Closed), User Story 268 (New - Tech Debt)
**Branch:** test
**Status:** Complete

---

## Summary

Fixed Executive Orders tracker that was failing since Jan 13, documented a schema mismatch between TEST and PROD, and cleaned up 4 disabled workflows.

---

## What Was Done

### 1. EO Tracker Fixes (ADO-267) - Closed
Multiple issues fixed across 3 PRs earlier today:
- Removed `TEST_BRANCH_MARKER.md` from main (was causing PROD to use TEST DB)
- Added `TEST_BRANCH_MARKER.md` to `.gitignore`
- Removed `full_text_available` field (never existed in DB)
- Added `SUPABASE_SERVICE_ROLE_KEY` to EO workflow
- Fixed `determineCategory()` to return valid enum values
- Added missing env vars to TEST workflow

### 2. Schema Mismatch Documentation (ADO-268) - Tech Debt
Discovered TEST and PROD have different `executive_orders.id` column types:

| Environment | id Type | Behavior |
|-------------|---------|----------|
| PROD | VARCHAR | Script provides `generateOrderId()` string |
| TEST | INTEGER | Auto-increment, script omits id |

**Documented in:** `docs/database/id-strategy.md`
**ADO-268:** Created for future schema alignment

### 3. Workflow Cleanup
Removed 4 disabled workflows that were still triggering cron jobs:

| PR | Workflow | Reason Removed |
|----|----------|----------------|
| #62 | `job-scheduler.yml` | Disabled, orphaned jobs |
| #63 | `daily-tracker.yml` | Replaced by RSS tracker |
| #63 | `test-daily-tracker.yml` | Obsolete |
| #63 | `rss-e2e-test.yml` | Used old job-queue system |

### 4. PR #61 - Synced TEST Workflow
- Added `ENVIRONMENT`, `TARGET_ENV`, `SUPABASE_SERVICE_ROLE_KEY` to `test-executive-orders.yml`
- Synced schema mismatch docs to main

---

## Verified Working

| Environment | Status |
|-------------|--------|
| PROD EO Tracker | ✅ Passing |
| TEST EO Tracker | ✅ Passing |

---

## Future Cleanup Candidates

Noted but not addressed (for another session):
- `process-manual-article.yml` - Manual articles don't work
- `test-manual-article.yml` - Test for above
- `rss-health-check.yml` - May not be used

---

## Key Files Changed

| File | Change |
|------|--------|
| `.github/workflows/test-executive-orders.yml` | Added env vars |
| `.github/workflows/executive-orders-tracker.yml` | Added SERVICE_ROLE_KEY |
| `scripts/executive-orders-tracker-supabase.js` | Category enum fix (main), ID removal (test only) |
| `docs/database/id-strategy.md` | Added schema mismatch warning |
| `.gitignore` | Added TEST_BRANCH_MARKER.md |

---

## ADO Status

| ID | Type | Title | State |
|----|------|-------|-------|
| 267 | Bug | EO Tracker failing since Jan 13 | Closed |
| 268 | User Story | Tech Debt: Align executive_orders.id schema | New |

---

**Session tokens:** ~60K used

# PROD Deployment Phase 2 - COMPLETE

**Date:** 2026-01-06
**Status:** COMPLETE
**JIRA:** TTRC-361

---

## Summary

Phase 2 (Edge Functions + Security) is fully complete. PROD database schema is 100% aligned with TEST, all Edge Functions are deployed and working, and the security fix for `rss-enqueue` is in place.

---

## What Was Completed

### 1. Schema Verification (100% Aligned)

| Table | Columns | Status |
|-------|---------|--------|
| stories | 35/35 | ✅ Complete |
| articles | 24/24 | ✅ Complete |
| feed_registry | 10/10 | ✅ Complete |
| article_story | 5/5 | ✅ Complete |
| extensions | 3/3 | ✅ (vector, pgcrypto, fuzzystrmatch) |
| admin schema | 1/1 | ✅ Present |

### 2. Edge Functions Deployed to PROD

All 5 functions deployed via `npx supabase functions deploy`:
- `stories-active` ✅
- `stories-detail` ✅
- `stories-search` ✅
- `queue-stats` ✅
- `rss-enqueue` ✅ (with security fix, `--no-verify-jwt`)

### 3. Security Fix for rss-enqueue

**Issue Found:** `rss-enqueue` was deployed with `--no-verify-jwt` but had no internal auth check, meaning anyone could trigger job enqueueing.

**Fix Applied:**
- Added `EDGE_CRON_TOKEN` verification in `supabase/functions/rss-enqueue/index.ts` (lines 22-41)
- Created separate `EDGE_CRON_TOKEN_PROD` GitHub secret for PROD isolation
- Updated workflows to use PROD-specific token:
  - `.github/workflows/job-scheduler.yml`
  - `.github/workflows/story-merge.yml`

**Verification:**
- Without token: Returns `{"error":"Unauthorized"}` (401) ✅
- With token: Returns `{"enqueued":0,"failed":0,"message":"No active feeds available..."}` ✅

### 4. Smoke Test Results

| Endpoint | Status | Response |
|----------|--------|----------|
| stories-active | ✅ PASS | Empty items array (expected - no stories yet) |
| stories-detail | ✅ PASS | "Story not found" (expected) |
| stories-search | ✅ PASS | Empty items array (expected) |
| queue-stats | ✅ PASS | Returns 401 without JWT (expected) |
| rss-enqueue | ✅ PASS | 401 without token, succeeds with token |

---

## Files Modified This Session

| File | Change |
|------|--------|
| `supabase/functions/rss-enqueue/index.ts` | Added EDGE_CRON_TOKEN auth check (lines 22-41) |
| `.github/workflows/job-scheduler.yml` | Changed to use `EDGE_CRON_TOKEN_PROD` |
| `.github/workflows/story-merge.yml` | Changed to use `EDGE_CRON_TOKEN_PROD` |

---

## Secrets Configuration

### GitHub Secrets
| Secret | Purpose |
|--------|---------|
| `EDGE_CRON_TOKEN` | For TEST environment (existing) |
| `EDGE_CRON_TOKEN_PROD` | For PROD environment (new) |

### PROD Supabase Secrets
| Secret | Purpose |
|--------|---------|
| `EDGE_CRON_TOKEN` | Matches GitHub's `EDGE_CRON_TOKEN_PROD` value |

---

## What's Next: Phase 3

Per runbook (`docs/plans/prod-deployment-runbook.md`):

1. **Commit & Push workflow changes** to test branch
2. **Create PR** to merge test → main (for workflow updates)
3. **Copy feeds from TEST to PROD** (feed_registry table)
4. **First RSS run**: `gh workflow run "RSS Tracker - PROD" --ref main`
5. **Monitor logs** for 1 hour

---

## Important URLs

- PROD Supabase: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg
- PROD Edge Functions: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg/functions
- GitHub Actions: https://github.com/AJWolfe18/TTracker/actions

---

## JIRA Update (Manual)

Add this comment to TTRC-361:

```
Phase 2 COMPLETE ✅

- Schema verified 100% aligned with TEST
- All 5 Edge Functions deployed and tested
- Security fix applied to rss-enqueue (EDGE_CRON_TOKEN auth)
- Created EDGE_CRON_TOKEN_PROD for environment isolation
- Ready for Phase 3 (feeds + first RSS run)
```

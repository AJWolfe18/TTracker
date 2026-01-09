# Handoff: TTRC-369 Archive Legacy Scripts (Phase 4)

**Date:** 2026-01-08
**Ticket:** TTRC-369
**Status:** Complete, deployed to PROD
**PR:** #38 (merged)

---

## Summary

Completed Phase 4 of repo cleanup - archived 18 legacy scripts, deleted 15 obsolete files, and deployed to production.

---

## Changes Made

### Archived (18 files → `scripts/archive/`)

| Directory | Files |
|-----------|-------|
| `scripts/archive/legacy-trackers/` | `daily-tracker-supabase.js` |
| `scripts/archive/superseded/` | `job-queue-worker-atomic.js`, `executive-orders-tracker.js`, `fix-job-queue-status-PRODUCTION.sql`, `PRODUCTION_DEPLOYMENT_CHECKLIST.md` |
| `scripts/archive/backfill/` | 13 backfill scripts + README |

### Deleted (15 files)

| Category | Files |
|----------|-------|
| Root archive/ | `daily-tracker.js`, `test-tracker.js`, `update-tracker.js`, `manual-article-processor-duplicate.js` |
| Scripts | `create-merge-test-data.js`, `delete-test-stories.js`, `finalize-code-update.js`, `inspect-extractions.js`, `run-worker.js`, `test-verification.js`, `verify-job-queue-fix.js` |
| Other | `BREAK_GLASS_RSS_FIX.md` (root, duplicate), `scripts/batch/cleanup-repo.bat`, `scripts/monitoring/trigger-rss.sh` |

### Modified

| File | Change |
|------|--------|
| `.github/workflows/rss-health-check.yml` | Removed archived script from paths trigger |
| `.github/workflows/rss-e2e-test.yml` | Disabled (uses superseded job queue system) |
| `.github/workflows/rss-tracker-test.yml` | Fixed `upload-artifact` v3 → v4 |
| `package.json` | Removed "daily" script, updated "test" to run qa:smoke |

---

## Verification

- ✅ QA smoke tests pass (4/4)
- ✅ RSS Tracker workflow runs successfully on TEST
- ✅ Reference sweeps confirm no active code depends on archived/deleted files
- ✅ Deployed to PROD via PR #38

---

## Commits

| SHA | Message |
|-----|---------|
| `48bd9c2` | chore(ci): disable obsolete workflow jobs and update paths (TTRC-369) |
| `87a3301` | chore(scripts): update package.json test command and add archive README |
| `8975d95` | fix(ci): update upload-artifact to v4 (deprecated v3) |

---

## Repo Cleanup Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Root directory organization | ✅ Done |
| 2 | Workflow cleanup | ✅ Done |
| 3 | Documentation cleanup | ✅ Done |
| 4 | Archive legacy scripts | ✅ Done (this session) |
| 5 | Clean temp/public artifacts | ⏳ TTRC-370 |
| 6 | Update CLAUDE.md + deprecations | ⏳ TTRC-371 |
| 7 | Clean orphaned jobs | ✅ Done |

---

## New Tickets Created

- **TTRC-374** - Add configurable story enrichment limit for TEST environment (cost savings)

---

## Known Issues

- **AI code review workflow failing** - Workflow file issue (pre-existing, not from this work). Needs separate bug fix.

---

## Next Session

1. **TTRC-370** - Clean temp/public artifacts
2. **TTRC-371** - Update CLAUDE.md to remove references to archived scripts
3. Fix AI code review workflow bug

---

## Files Reference

- Plan file: `C:\Users\Josh\.claude\plans\cuddly-painting-crane.md`
- Archive location: `scripts/archive/`
- Troubleshooting doc (kept): `docs/troubleshooting/BREAK_GLASS_RSS_FIX.md`

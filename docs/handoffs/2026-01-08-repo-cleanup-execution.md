# Repository Cleanup Execution Session

**Date:** 2026-01-08
**Ticket:** N/A (Repository housekeeping)
**Branch:** test
**Status:** COMPLETE - Phases 1-3 executed

---

## Summary

Executed Phases 1-3 of the repository cleanup plan from `docs/plans/2026-01-08-repo-cleanup-audit.md`. Removed obsolete files, disabled legacy workflows, and deduplicated documentation.

---

## What Was Done

### Phase 1: Root Directory Organization
**Commit:** `84f99cc chore(cleanup): organize root directory files`

| Action | Files |
|--------|-------|
| Deleted batch files | backfill-2-weeks.bat, rerun-first-50-eos.bat, run-daily-tracker.bat |
| Deleted stale files | commit_message.txt, search-filter-prototype-hifi.html |
| Deleted orphaned dir | workflows/test-rss.yml (root-level, unused) |
| Deleted empty dirs | data/, database-migration/, test-scripts/, tmp/ (untracked) |

**Note:** Log files (*.log) and CSV files at root are untracked (already in .gitignore) - no action needed.

### Phase 2A: Disable Legacy Workflows
**Commit:** `ad3a096 chore(ci): disable legacy job-scheduler and test-daily-tracker workflows`

| Workflow | Why Disabled |
|----------|--------------|
| job-scheduler.yml | Creates orphaned jobs in job_queue - rss-tracker-prod.yml is primary |
| test-daily-tracker.yml | Tests disabled daily-tracker.yml system |

Both workflows now have `if: false` on all jobs.

### Phase 2B: Delete Duplicate/Broken Workflows
**Commit:** `cae5505 chore(ci): delete duplicate and broken workflows`

| Workflow | Why Deleted |
|----------|-------------|
| ai-code-review-v2.yml | Exact duplicate of ai-code-review.yml |
| story-merge.yml | Uses deprecated rss-enqueue edge function |
| test-rss-real.yml | Uses old schema, incompatible with current system |

### Phase 3: Documentation Cleanup
**Commit:** `d328551 docs(cleanup): deduplicate and organize documentation`

| Action | Count |
|--------|-------|
| Deleted duplicate docs at /docs/ root | 10 files |
| Archived legacy schemas to docs/archive/legacy-schemas/ | 2 files |
| Archived legacy API docs to docs/archive/legacy-api/ | 1 file |
| Archived rss-deployment folder | ~30 files |
| Deleted obsolete migration guides | 5 files |

**Files deleted:**
- docs/API.md, docs/ARCHITECTURE.md (canonical in subdirs)
- docs/database-schema.md, docs/database-documentation.md
- docs/category-system.md, docs/dashboard-architecture.md
- docs/daily-tracker-api.md, docs/environment-variables-setup.md
- docs/duplicate-detection-enhancement.md, docs/BRANCH-STRUCTURE-SYNC.md
- migrations/APPLY_021A_NOW.md, APPLY_MIGRATION_021.md, 022, 023
- migrations/TTRC-145-pending-prod-migrations.md

### Phase 3 Addendum
**Commit:** `6fcd426 docs: add archive banner and cleanup plan documentation`

- Updated docs/README.md with plans/ subdirectory and "do not create in root" guidance
- Added docs/archive/README.md with archive banner warning
- Committed planning docs from previous session

---

## Commits Summary

| Commit | Message | Files |
|--------|---------|-------|
| 84f99cc | chore(cleanup): organize root directory files | 6 |
| ad3a096 | chore(ci): disable legacy workflows | 2 |
| cae5505 | chore(ci): delete duplicate workflows | 3 |
| d328551 | docs(cleanup): deduplicate and organize documentation | 51 |
| 6fcd426 | docs: add archive banner and cleanup plan docs | 4 |

**Total:** 5 commits, ~65 files changed

---

## Verification

### QA Smoke Tests
```
npm run qa:smoke
[OK] clustering-boundaries
[OK] attach-or-create-integration
[OK] enqueue-idempotency
[OK] clustering-concurrency
```

### Workflow Status
- lint-prod-refs: Passing
- RSS health check: Passing
- AI code review: 0s "failure" (expected - PR trigger only, not push)

---

## Remaining Work (JIRA Cards)

| Ticket | Summary | Priority |
|--------|---------|----------|
| TTRC-369 | Archive legacy scripts and cleanup archive/ directory | Medium |
| TTRC-370 | Clean temp/ directory and public test artifacts | Medium |
| TTRC-371 | Update CLAUDE.md and add deprecation notices | Medium |
| TTRC-372 | Clean up orphaned jobs in job_queue table | Low |

---

## Notes

1. **Disabled workflows need PR to main:** The `job-scheduler.yml` and `test-daily-tracker.yml` are disabled on test branch. They won't stop running on main until merged via PR.

2. **GitHub Actions cache:** The `gh workflow list` still shows deleted workflows (ai-code-review-v2, story-merge, test-rss-real) - this is cached and will update after GitHub refreshes.

3. **Untracked files not touched:** Root-level log files and CSV files are in .gitignore, so they weren't deleted - just left in place.

---

## Next Session

Option A: Create PR to main with workflow disables to stop PROD orphaned job creation
Option B: Continue with TTRC-369 (archive legacy scripts)

**Plan location:** `docs/plans/2026-01-08-repo-cleanup-audit.md`

---

## Session Stats
- **Duration:** ~1 hour
- **Commits:** 6 (5 cleanup + 1 handoff)
- **Files Changed:** ~65
- **QA Tests:** All passing
- **Branches Deleted:** 11 stale branches
- **PR Created:** #36 (test→main, awaiting merge)

---

## Additional Work Done (Late Session)

### JIRA Updated
- Added comment to TTRC-368 explaining job-scheduler disable relates to schema drift cleanup

### Branch Cleanup
Deleted 11 stale branches that were causing lint-prod-refs failures:
- AJWolfe18-patch-1, test-backup-20250817, feature/ttrc-221-eo-detail
- test-ai-review-trigger, verify-ai-review-workflow
- deploy-prod-phase3, docs-sync-to-prod, fix-artifact-v4
- fix-prod-deps, sync-rss-scripts, sync-utils

**Remaining branches:** `main`, `test` only

### Auto-Delete Enabled
Enabled `delete_branch_on_merge` in repo settings - branches will auto-delete when PRs merge.

### AI Code Review Issue Identified
- AI code review workflow only triggers on PRs, not pushes
- The 0s "failures" on pushes are a GitHub display quirk
- Last actual PR-triggered review was October 2025 (~2.5 months ago)
- Workflow may need investigation (JIRA card recommended)

---

## Orphaned Jobs Status

**TEST database:** Has orphaned `story.cluster` jobs from Jan 4-5 (visible via MCP)

**PROD database:** Unknown - no MCP access. Need to check manually:
```sql
SELECT job_type, status, COUNT(*) AS cnt,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM public.job_queue
WHERE status IN ('pending', 'claimed')
GROUP BY job_type, status
ORDER BY cnt DESC;
```

See TTRC-372 for cleanup procedure.

---

## Open Items

| Item | Status | Action |
|------|--------|--------|
| PR #36 | Open | Merge to stop PROD orphaned job creation |
| PROD orphaned jobs | Unknown | Check via Supabase dashboard |
| AI code review | Broken? | Investigate why not triggering on PRs |
| TTRC-369-372 | Backlog | Future cleanup phases |

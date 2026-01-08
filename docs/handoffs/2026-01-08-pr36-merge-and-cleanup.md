# PR #36 Merge and PROD Cleanup Session

**Date:** 2026-01-08
**Ticket:** N/A (Continuation of repo cleanup)
**Branch:** test
**Status:** COMPLETE

---

## Summary

Completed PR #36 merge to main (fixing merge conflicts) and cleaned up 829 orphaned jobs in PROD. Created TTRC-373 for AI-generated story titles feature.

---

## What Was Done

### PR #36 Merge Fix
PR had merge conflicts due to 5 commits on main since PR creation.

**Resolution:**
1. Merged `origin/main` into `test` branch
2. Resolved conflict in `docs/README.md` (kept test branch improvements)
3. Re-deleted 35 files that main merge brought back (already archived)
4. Pushed to test - PR became mergeable
5. Squash merged PR #36 to main

**Commits:**
- `5f1b206` - Merge branch 'main' into test
- `7f94b4c` - chore: re-apply doc deletions after main merge

### job-scheduler Disabled on Main
Verified `job-scheduler.yml` now has `if: false` on both jobs on main branch. PROD will no longer create orphaned jobs.

### PROD Orphaned Jobs Cleanup
**Before cleanup:**
| job_type | count |
|----------|-------|
| fetch_feed | 409 |
| story.cluster | 378 |
| story.lifecycle | 40 |
| story.merge | 2 |
| **Total** | **829** |

**Cleanup query:**
```sql
DELETE FROM public.job_queue WHERE status = 'pending';
```

**Result:** 0 pending jobs remaining

### JIRA Updates
- **TTRC-372** - Added cleanup results, transitioned to Done
- **TTRC-373** - Created new ticket for AI-generated story titles

---

## New Feature Request: AI Story Titles (TTRC-373)

User noticed articles with "Watch:" in titles - want AI-generated neutral titles instead of using article headlines.

**Scope:**
- Add `display_title` column to stories table
- Generate neutral AI title during enrichment
- Display AI title on frontend, keep original headline for reference
- Example: "Watch: Trump announces..." → "Trump announces new tariffs on Chinese imports"

---

## Repo Cleanup Progress

**Plan:** `docs/plans/2026-01-08-repo-cleanup-audit.md`

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Root directory organization | ✅ Done (prev session) |
| 2 | Workflow cleanup | ✅ Done (prev session) |
| 3 | Documentation cleanup | ✅ Done (prev session) |
| 4 | Archive legacy scripts | ⏳ TTRC-369 |
| 5 | Clean temp/public artifacts | ⏳ TTRC-370 |
| 6 | Update CLAUDE.md + deprecations | ⏳ TTRC-371 |
| 7 | Clean orphaned jobs | ✅ TTRC-372 (this session) |

## Remaining Cleanup Backlog

| Ticket | Phase | Summary |
|--------|-------|---------|
| TTRC-369 | 4 | Archive legacy scripts |
| TTRC-370 | 5 | Clean temp/public test artifacts |
| TTRC-371 | 6 | Update CLAUDE.md + deprecation notices |

---

## Verification

- [x] PR #36 merged to main
- [x] job-scheduler.yml disabled on main
- [x] PROD orphaned jobs = 0
- [x] TTRC-372 closed
- [x] TTRC-373 created

---

## Next Session

**Continue repo cleanup (3 phases remain):**
- TTRC-369: Archive legacy scripts (Phase 4)
- TTRC-370: Clean temp/public artifacts (Phase 5)
- TTRC-371: Update CLAUDE.md + deprecations (Phase 6)

**Or start new feature:**
- TTRC-373: AI story titles

**Related handoffs:**
- Previous cleanup session: `docs/handoffs/2026-01-08-repo-cleanup-execution.md`
- Cleanup plan: `docs/plans/2026-01-08-repo-cleanup-audit.md`

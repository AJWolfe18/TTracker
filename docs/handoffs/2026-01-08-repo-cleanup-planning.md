# Repository Cleanup Planning Session

**Date:** 2026-01-08
**Ticket:** N/A (Planning session)
**Branch:** test
**Status:** PLAN COMPLETE - Ready for execution

---

## Summary

Comprehensive audit and cleanup plan for TTracker repository after PROD go-live. Created detailed plan with advisor feedback incorporated.

---

## Deliverables

### Plan Created
- **Location:** `docs/plans/2026-01-08-repo-cleanup-audit.md`
- **Scope:** 7 phases, ~100 files to organize/archive/delete
- **This session:** Phases 1-3 (root files, workflows, docs)
- **Future sessions:** Phases 4-7 via JIRA cards

### JIRA Cards Created
| Ticket | Summary | Priority |
|--------|---------|----------|
| TTRC-369 | Archive legacy scripts and cleanup archive/ directory | Medium |
| TTRC-370 | Clean temp/ directory and public test artifacts | Medium |
| TTRC-371 | Update CLAUDE.md and add deprecation notices | Medium |
| TTRC-372 | Clean up orphaned jobs in job_queue table | Low |

---

## Key Findings

### Workflow Status
- **RSS Tracker PROD** - Primary system, every 2 hours
- **Executive Orders Tracker** - KEEP (separate Federal Register API system)
- **Daily Tracker** - Already disabled (PR #34)
- **Job Scheduler** - TO DISABLE (creates orphaned jobs)

### Files to Organize
- 8 log files at root → logs/
- 5 CSV files at root → exports/
- 3 Windows batch files → delete
- 4 empty directories → delete
- 10+ duplicate docs → delete (keep canonical versions)

---

## Next Session

Execute Phases 1-3 from the plan:
1. Organize root directory files
2. Disable + delete legacy workflows
3. Deduplicate documentation

**Plan location:** `docs/plans/2026-01-08-repo-cleanup-audit.md`

---

## Session Stats
- **Duration:** ~2 hours (mostly planning/investigation)
- **JIRA Cards Created:** 4
- **Plan Files:** 1

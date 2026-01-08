# Handoff: JIRA Ticket Cleanup Session

**Date:** 2025-12-31
**Branch:** test

---

## What Was Done

### Ticket Review & Cleanup

Reviewed 4 clustering-related tickets for current relevance after recent improvements:

| Ticket | Title | Action | Reason |
|--------|-------|--------|--------|
| **TTRC-236** | Merge Validation & Threshold Tuning | → Cancelled | Superseded by TTRC-324/336. Original goal (shared `shouldMerge()`) replaced by tiered guardrails and batch dedup. |
| **TTRC-304** | Frequency-based entity weighting | Keep in Backlog | Still relevant as enhancement, but lower priority while current stopword approach works |
| **TTRC-332** | Duplicate-Aware Story Tie-Break (Phase 3) | Keep in Backlog | Partially obsolete - re-evaluate after TTRC-336 goes live |
| **TTRC-336** | Same-batch dedup | In Progress ✓ | Correct status - 1 more shadow run needed before live |

---

## Key Decisions

### TTRC-236 Closure Rationale

Original scope (Oct 2025):
- Consolidate threshold logic into `scripts/lib/merge-thresholds.js`
- Create shared `shouldMerge()` function
- Grid search for optimal thresholds

Why superseded:
- **TTRC-324** implemented tiered guardrails (new threshold system)
- **TTRC-336** added batch dedup with corroboration requirements
- **TTRC-315/321/329** reworked clustering significantly

Architecture evolved past original design - no longer applicable.

### TTRC-332 Assessment

TTRC-332 addresses margin gate tie-breaks (two competing candidate stories). While TTRC-336 reduces same-run fragmentation, TTRC-332 handles a different scenario (existing story duplicates). Keep in backlog, re-evaluate impact after TTRC-336 goes live.

---

## Current Ticket State

### Ready for Prod
- TTRC-258 (Article scraping)
- TTRC-260 (Readability upgrade)
- TTRC-320 (Embedding order fix)
- TTRC-321 (Same-run override)
- TTRC-323 (Exact title match)
- TTRC-324 (Tiered guardrails)
- TTRC-333 (Title token bypass)

### Ready for Test
- TTRC-354 (Hash collision fix)

### In Progress
- TTRC-336 (Batch dedup - 1 more shadow run)

### Backlog (Kept)
- TTRC-304 (Frequency entity weighting)
- TTRC-332 (Duplicate story tie-break Phase 3)

### Closed This Session
- TTRC-236 (Merge validation - superseded)
- TTRC-330 (Duplicate of 354) - from earlier session

---

## Next Session

1. **Trigger one more RSS run** for TTRC-336 validation
2. **If clean:** Flip `BATCH_DEDUP_SHADOW_MODE=false` in workflow
3. **Review full ticket list** for prod PR (more than just clustering tickets)

---

## Commands Reference

```bash
# Trigger RSS run
gh workflow run "RSS Tracker - TEST" --ref test

# Check batch dedup logs
gh run view [RUN_ID] --log 2>&1 | grep "BATCH_DEDUP\|TTRC-354"

# Flip to live mode (edit workflow)
# .github/workflows/rss-tracker-test.yml
# BATCH_DEDUP_SHADOW_MODE: 'false'
```

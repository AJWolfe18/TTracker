# TTRC-329 Investigation Complete

**Date:** 2025-12-26
**Status:** Complete - spawned TTRC-331, TTRC-332

---

## What We Did

1. Ran RSS workflow, analyzed 58 articles (Run 2)
2. Found 5 additional false negatives (7 total across 2 runs)
3. Identified root cause: **Tier B has no margin bypass, unlike Tier A**
4. Discovered margin threshold is 0.04 (not 0.03)
5. Created plan document with phased solution
6. Created JIRA tickets for implementation

## Root Cause

All 7 false negatives were in the 0.88-0.90 embed range (Tier B) with:
- margin < 0.04
- entity or slug corroboration

Tier A has a margin bypass when corroboration exists. Tier B does not.

## JIRA Tickets

| Ticket | Description | Status |
|--------|-------------|--------|
| TTRC-329 | Shadow policy investigation | **Done** |
| TTRC-331 | Tier B margin bypass + logging | Backlog |
| TTRC-332 | Duplicate-aware tie-break (future) | Backlog |

## Files Created/Updated

| File | Purpose |
|------|---------|
| `docs/plans/margin-gate-fix.md` | Implementation plan |
| `docs/plans/ttrc-329-run-tracking.md` | Run tracking data |
| `logs/shadow-policy/near-misses-run2.json` | Run 2 raw data |

## Key Concepts Explained

**Margin Gate:** Requires gap of >= 0.04 between best and second-best match. Designed to prevent ambiguous merges, but blocking legitimate ones.

**Shadow Policy:** Test alternative thresholds without changing behavior. Logs what WOULD happen at different thresholds.

---

## Next Session Prompt

```
READ: docs/plans/margin-gate-fix.md

## Task: Implement TTRC-331
1. Add improved logging (Phase 1)
2. Add Tier B margin bypass (Phase 2)
3. Test with historical false negatives
4. Push and validate on RSS run
```

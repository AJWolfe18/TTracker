# TTRC-329: Run Tracking Session

**Date:** 2025-12-24
**Status:** In Progress - collecting data

---

## What We Did

1. Triggered RSS workflow (run 20491979093) - completed successfully
2. Analyzed 11 near-miss cases from the run
3. Found 2 false negatives (articles that should have merged but didn't)
4. Created tracking document: `docs/plans/ttrc-329-run-tracking.md`
5. Updated JIRA TTRC-329 with findings

## Key Finding

**Margin gate is the primary blocker, not embed threshold.**

Found 3 stories about the same event (Trump banning EU officials) that should be 1 story:
- Story 16338, 16347, 16359 - all single-article stories about the same news

## Files

| File | Purpose |
|------|---------|
| `docs/plans/ttrc-329-run-tracking.md` | Cumulative run tracking (update after each run) |
| `logs/shadow-policy/near-misses-latest.json` | Raw near-miss data from latest run |

## Next Steps

1. Wait for more RSS runs (need 5+ runs of data)
2. After each run, update the tracking document with new findings
3. Once enough data collected, decide on threshold/margin gate changes

---

## Next Session Prompt

```
READ: docs/plans/ttrc-329-run-tracking.md

## Context
TTRC-329 shadow policy analysis. We're collecting data across runs
to decide if we should adjust the clustering thresholds.

## Task
1. Trigger RSS workflow
2. After completion, analyze near-misses
3. Update the tracking document with new findings
4. Check if we have enough data (20+ shadow diffs, 5+ runs) to make a decision
```

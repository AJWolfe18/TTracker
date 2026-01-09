# TTRC-329: Fresh Simulation Experiment

**Date:** 2025-12-24
**Status:** Paused - 9 shadow diffs collected, need 20+

---

## What We Did

1. **Confirmed recluster failure** - All 200 articles matched back to original stories via slug
2. **Identified root cause** - Slug matching (0.96 score) bypasses embedding similarity entirely
3. **Designed fresh simulation** - Delete stories, clear article slugs, recluster as if fresh RSS
4. **Ran experiments:**
   - 50 articles → 2 shadow diffs (4% rate)
   - 200 articles → 3 shadow diffs (1.5% rate)
   - Plus 3 from earlier RSS runs
   - **Total: 9 shadow diffs (need 20+)**

## Key Finding

Clearing `topic_slug` from articles forces embedding-based matching. This generates real shadow policy diffs in the 0.86-0.88 gray zone.

## Shadow Diff Examples

| embed_best | Corroboration | Would match at |
|------------|---------------|----------------|
| 0.851 | title_token | None (below 0.86) |
| 0.858 | entity + title | 0.86 only |

## Files Created

| File | Purpose |
|------|---------|
| `scripts/recluster-fresh-simulation.mjs` | Fresh RSS simulation script |
| `scripts/compare-recluster-results.mjs` | Comparison script |
| `logs/fresh-simulation-output.log` | 50-article run output |
| `logs/fresh-simulation-200.log` | 200-article run output |
| `logs/stories_backup_fresh.json` | Backup of deleted stories |
| `logs/article_slugs_backup.json` | Backup of cleared slugs |

## Current State

- 9 shadow diffs collected (need 20+)
- 250 articles processed via fresh simulation
- RSS workflow triggered earlier today

## Decision Needed: Is More Simulation Worth It?

**Current state:** 9 shadow diffs from 250 articles (~2-4% rate)

**Option A: Run 500 more articles**
- Pros: Gets to 20+ faster, can complete threshold analysis this week
- Cons: More DB churn (deleting stories, clearing slugs), destructive experiment
- Effort: ~5 min runtime, minimal

**Option B: Wait for natural RSS**
- Pros: Non-destructive, real-world data
- Cons: Slower (3 diffs from several days of RSS runs)
- Timeline: Could take 1-2 weeks to hit 20+

**Option C: Analyze what we have (9 diffs)**
- Pros: No more experimentation, move forward now
- Cons: Smaller sample size, less confidence in threshold decision
- Question: Is 9 enough to see a pattern?

**Option D: Abandon threshold tuning**
- Keep current 0.88 threshold
- Accept current clustering behavior
- Focus on other priorities (TTRC-330, etc.)

### Key Question
Do we have enough signal from 9 cases to make a threshold decision, or do we need the full 20+?

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-24-ttrc-329-fresh-simulation.md

## Context
TTRC-329 shadow policy. Got 9 shadow diffs from fresh simulation.
Need to decide: is it worth running more, or work with what we have?

## Decision Point
Review the 4 options in handoff and decide path forward:
A) Run 500 more articles
B) Wait for natural RSS
C) Analyze the 9 we have
D) Abandon threshold tuning

## To Help Decide
- Show me the 9 shadow diffs we collected (embed scores, what they would have matched)
- Are they mostly in 0.86-0.87 range or spread out?
- Do they show a clear pattern?

## Also Pending
- TTRC-330: WaPo duplicate bug (Backlog)
```

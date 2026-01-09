# TTRC-329: Recluster Experiment Session

**Date:** 2025-12-24
**Updated:** 2025-12-23 (investigation complete)
**Status:** Closed - experiment failed, continuing with natural data collection

---

## What We Did

1. **Fixed AI review blocker** - commit 6930365 (targetStory null-check)
2. **Created TTRC-330** - WaPo duplicate article bug
3. **Ran recluster experiment** - 200 single-article stories

## Recluster Results

- 200 articles reclustered
- **0 shadow diffs generated** (expected some)
- All articles re-attached to stories with 0.96 scores (slug matches)

## Problem Identified

Articles matched back to their **original stories** via slug matching. The stories weren't deleted, only the article_story junction entries. So articles found their original stories and re-attached - never hitting the "create new story" path where shadow logging fires.

## Investigation Complete (2025-12-23)

### Findings

Ran `scripts/compare-recluster-results.mjs` to compare original vs current story assignments:

```
=== RECLUSTER COMPARISON ===
Matched SAME story: 200
Matched DIFFERENT story: 0
Not found: 0
No original record: 0

CONCLUSION: Experiment failed - all articles matched back to original stories.
```

**All 200 articles matched back to their EXACT original story IDs.**

### Root Cause

1. We only deleted `article_story` junction entries
2. Stories themselves remained in `stories` table with their `topic_slug` values
3. Slug-matching found original stories during recluster
4. Articles re-attached at 0.96 score (slug corroboration)
5. Never hit "create new story" path where shadow logging fires

### Conclusion

**Reclustering existing articles cannot generate shadow diffs** unless we delete the stories themselves (destructive). The only way to collect shadow data is from **new articles** that naturally hit the 0.86-0.88 gray zone.

**Path forward:** Continue RSS triggers 2-3x daily to collect natural shadow diffs from new articles.

## Files Created

| File | Purpose |
|------|---------|
| `logs/article_story_backup.json` | Original 2384 article_story mappings |
| `logs/single_article_stories.json` | 2125 single-article story IDs |
| `logs/recluster_batch.json` | 200 article IDs we reclustered |
| `logs/shadow-policy/recluster-run.log` | Full recluster output |
| `scripts/get-single-article-stories.mjs` | Helper script |
| `scripts/remove-batch-for-recluster.mjs` | Helper script |
| `scripts/recluster-shadow-batch.mjs` | Recluster script |
| `scripts/compare-recluster-results.mjs` | Comparison script (confirmed experiment failed) |

## Current Shadow Data

| Source | Count |
|--------|-------|
| Earlier RSS runs | 3 |
| This recluster | 0 |
| **Total** | 3 |

Need 20+ for threshold analysis.

## Open Questions

1. Why did all 200 articles match at 0.96? Are they truly matching original stories or finding new matches?
2. Should we delete the stories too, not just the junction entries?
3. Is there actual fragmentation to find, or are single-article stories truly unique?

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-24-ttrc-329-recluster-experiment.md
READ: docs/plans/ttrc-329-shadow-policy-evaluation.md

## Context
TTRC-329 shadow policy work. Recluster experiment confirmed failed - all 200 articles
matched back to original stories. Only way to collect shadow diffs is from new articles
hitting the gray zone naturally.

## Current Status
- Shadow diffs collected: 3 (need 20+)
- RSS triggered: 2025-12-23
- Recluster approach: CLOSED (doesn't work)

## Tasks
1. Check RSS run results from last trigger
2. Pull shadow logs: `bash scripts/pull-shadow-policy-logs.sh`
3. If 20+ diffs, run analysis: `node scripts/analyze-shadow-policy.mjs`
4. Continue triggering RSS 2-3x daily until 20+ diffs collected

## Also Pending
- TTRC-330: WaPo duplicate bug (created, needs implementation)
```

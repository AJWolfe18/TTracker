# Handoff: Clustering Ticket Review & TTRC-336 Threshold Fix

**Date:** 2025-12-31
**Tickets:** TTRC-336, 354, 321, 323, 324, 328, 333, 304, 305, 306, 332, 320
**Branch:** test
**Commits:** fede6a9, 268cf52

---

## What Was Done

### 1. TTRC-336 Threshold Fix

**Problem:** Shadow run showed 67% false positive rate (2/3 attach decisions wrong) at embed >= 0.93 without corroboration.

**Fix:** Removed standalone mode from batch dedup. All matches now require:
- `tokenOverlap >= 2` OR
- Non-generic slug overlap

**Validation:** Post-fix run showed 0 false positives (10/10 correct rejections).

**Status:** Shadow mode still on. Need 2-3 more runs before flipping to live.

### 2. New Bug Created: TTRC-354

**Issue:** Articles orphaned when story creation fails with duplicate hash constraint.
- 3 "Tracking who Trump is appointing" articles left without story links
- Story 13783 exists but ANN didn't return it
- Story creation failed, no fallback to attach

**Fix needed:** ~20 lines - catch hash collision, lookup story by hash, attach article.

### 3. Ticket Grooming (12 tickets reviewed)

**Moved to Ready for Prod:**
- TTRC-324 (was In Review)

**Closed as Won't Do:**
- TTRC-328 (recency filters - superseded by tiered guardrails)
- TTRC-305 (keyphrase scoring - not worth complexity)
- TTRC-306 (AI topic IDs - redundant with existing topic_slug)

**Already Ready for Prod:**
- TTRC-321 (same-run override)
- TTRC-323 (exact title match)
- TTRC-333 (title token bypass)

**Kept in Backlog:**
- TTRC-304 (frequency entity weighting)
- TTRC-332 (duplicate story tie-break Phase 3)

---

## Current Ticket State

| Status | Tickets |
|--------|---------|
| Ready for Prod | TTRC-321, 323, 324, 333 |
| In Progress | TTRC-336 (shadow testing) |
| Bugs to Fix | TTRC-354 (orphaned articles), TTRC-320 (embedding ordering) |
| Backlog | TTRC-304, TTRC-332 |
| Closed | TTRC-328, 305, 306 |

---

## Key Architectural Insight

**Embeddings alone can't distinguish "same topic" from "same domain" in politics/news.**

The corroboration pattern (embedding threshold + title_token/slug match) is the right approach. This is now standard across:
- DB guardrails (TTRC-324)
- Batch dedup (TTRC-336)

---

## Next Session: TTRC-254 and TTRC-320

**TTRC-320:** Embedding ordering bug - `enrichArticles()` orders ASC (oldest first), causing 54% of new articles to miss embeddings. Simple fix: change to DESC.

**TTRC-254:** Need to query for details.

---

## Files Changed

- `scripts/rss/hybrid-clustering.js` - removed standalone mode (lines 326-327)
- `docs/handoffs/2025-12-31-ttrc-336-threshold-fix.md` - created

---

## Commands Run

```bash
# RSS validation runs
gh workflow run "RSS Tracker - TEST" --ref test

# Commits
git commit -m "fix(clustering): TTRC-336 require corroboration for all batch dedup matches"
git commit -m "docs: add handoff for TTRC-336 threshold fix"
```

# Handoff: TTRC-336 Same-Batch Dedup

**Date:** 2025-12-30
**Ticket:** TTRC-336
**Branch:** test
**Commits:** c7669e8, 6a7991e

---

## What Was Done

Implemented in-memory batch tracking to fix same-run fragmentation - articles in the same RSS batch can now find stories created seconds earlier.

### The Problem

Articles A and B about the same topic, processed 7 seconds apart:
- Article A creates Story 16468
- Article B queries DB but can't find Story 16468 because:
  - Entity block: newborn story has EMPTY entity_counter
  - Slug block: topic_slugs not populated yet
  - ANN block: may be below threshold
- Article B creates Story 16476 (DUPLICATE)

### The Solution

**Fallback-only batch dedup:** After DB candidate scoring fails, check in-memory cache of stories created this run.

### Changes

**`scripts/rss/hybrid-clustering.js`:**
- Added `batchStoriesThisRun` Map (lines 57-66)
- Added helper functions (lines 173-363):
  - `isMeaningfulTokenForBatch()` - tokens 5+ chars or acronyms (CFPB, DOJ)
  - `getMeaningfulTokenOverlap()` - count shared meaningful tokens
  - `hasValidSlugOverlap()` - non-generic slug match
  - `isRoundup()` - detect roundup headlines
  - `cosineSimilarity()` - embedding comparison
  - `findBatchStoryMatch()` - main matching logic with tiered thresholds
- Inserted batch dedup fallback after DB scoring fails (lines 1187-1255)
- Populate batch cache on story creation (lines 1301-1313)
- Added batch_dedup stats to RUN_SUMMARY (lines 1700-1704)

**`scripts/rss-tracker-supabase.js`:**
- Added batch_dedup stats to CLUSTERING_SUMMARY (lines 688-695)

**`.github/workflows/rss-tracker-test.yml`:**
- Added `ENABLE_BATCH_DEDUP=true`
- Added `BATCH_DEDUP_SHADOW_MODE=true`

---

## Tiered Thresholds

| Embedding | Requirement | Rationale |
|-----------|-------------|-----------|
| >= 0.93 | Allow standalone | Embedding strong enough alone |
| 0.88-0.93 | Require corroboration | Need semantic proof |
| < 0.88 | Reject | Too weak |

**Valid Corroborators (for 0.88-0.93 band):**
1. title_token overlap >= 2 (meaningful tokens only)
2. Non-generic slug overlap (not "us-politics", "immigration", etc.)

**Additional Gates:**
- Roundup heuristic: "live updates|roundup" headlines need >= 0.93
- Ambiguity rejection: top1.sim - top2.sim < 0.02 -> reject
- Tie-breaker: prefer earliest story among near-ties

---

## First Shadow Run (Dec 30)

- 7 articles processed, 5 stories created
- Batch cache working (5+ stories added)
- ~14 BATCH_DEDUP_DECISION logs generated
- All correctly rejected (embed 0.84-0.87 < 0.88)
- Manual review: 5 distinct topics, no false positives

---

## Current State

- **Feature flags:** Shadow mode enabled in TEST
- **Code:** Complete, pushed to test
- **AI Code Review:** Passed
- **JIRA:** Updated with implementation details

---

## Next Steps

1. Monitor overnight RSS runs for shadow decisions
2. Look for `decision: "attach"` logs with actual duplicates
3. Validate those decisions would have been correct
4. When confident, flip to live mode:
   ```yaml
   BATCH_DEDUP_SHADOW_MODE: 'false'
   ```
5. Deploy to production via PR to main

---

## Rollback

```bash
# Immediate - disable batch dedup
ENABLE_BATCH_DEDUP=false

# Hard rollback - revert commits
git revert 6a7991e c7669e8
```

---

## Files Changed

- `scripts/rss/hybrid-clustering.js` (+309 lines)
- `scripts/rss-tracker-supabase.js` (+8 lines)
- `.github/workflows/rss-tracker-test.yml` (+3 lines)

---

## Related

- TTRC-333: Title token margin bypass (completed, ready for prod)
- TTRC-321: Same-run override (completed)
- TTRC-324: Tiered merge thresholds (completed)

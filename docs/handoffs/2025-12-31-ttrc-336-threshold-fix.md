# Handoff: TTRC-336 Batch Dedup Threshold Fix

**Date:** 2025-12-31
**Ticket:** TTRC-336
**Branch:** test
**Commit:** fede6a9

---

## What Was Done

Removed standalone mode from batch dedup after shadow run revealed 67% false positive rate at embed >= 0.93.

### The Problem

Shadow run (20621523101) showed 3 "attach" recommendations:
- 1 correct (childcare articles, embed 0.9499, title_token 3)
- 2 false positives (embed 0.93, title_token 0-1)

Politics/news embeddings are "topic-adjacent sticky" - 0.93 similarity doesn't guarantee same story without corroboration.

### The Fix

**Deleted lines 326-327** from `scripts/rss/hybrid-clustering.js`:
```javascript
// ≥0.93 is always eligible (no corroboration needed)
if (sim >= 0.93) return true;
```

All batch dedup matches now require:
- `tokenOverlap >= 2` OR
- Non-generic slug overlap

### Validation

Post-fix run (20622880854):
- 10 batch dedup decisions, all rejections
- 0 false positives
- All rejections had title_token = 0 (correctly rejected)

---

## Full Article Analysis (30 rejected)

| Category | Count |
|----------|-------|
| Legitimate different topics | 27 |
| Story creator | 1 |
| Orphaned (separate bug) | 3 |

Only duplicate pair found: Stories 16564 + 16565 (childcare funding) - shadow mode caught this correctly with title_token = 3.

---

## Related Bug Created

**TTRC-354:** Articles orphaned when story creation fails with duplicate hash constraint
- 3 "Tracking who Trump is appointing" articles left without story links
- Story 13783 exists but ANN didn't return it as candidate
- Story creation failed with hash collision, no recovery path
- Linked to Epic TTRC-225

---

## Current State

- **Shadow mode:** Still enabled (recommended for 2-3 more runs)
- **Feature flags:**
  - `ENABLE_BATCH_DEDUP=true`
  - `BATCH_DEDUP_SHADOW_MODE=true`
- **JIRA:** Updated with implementation details

---

## Next Steps

1. Monitor 2-3 more shadow runs for any edge cases
2. Look for false negatives (high embed rejections that should have matched)
3. When confident, flip `BATCH_DEDUP_SHADOW_MODE=false`
4. Deploy to production via PR to main

---

## Files Changed

- `scripts/rss/hybrid-clustering.js` (-4 lines, +3 lines)

---

## Key Learnings

1. **Embeddings alone aren't enough** - 0.93 similarity can be wrong without semantic corroboration
2. **Prefer fragmentation over false merges** - duplicate stories are fixable, wrong merges are not
3. **Acronym handling matters** - CFPB, DOJ, ICE are correctly counted as meaningful tokens (3-6 chars ALL CAPS)

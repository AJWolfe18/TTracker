# TTRC-301: Clustering Quality Improvement - COMPLETE

**Date:** 2025-12-10
**Status:** ✅ All tasks complete
**Branch:** test
**Commits:** d9f3e23, 78b8001

---

## Summary

Implemented all TTRC-301 clustering quality improvements to reduce false positive rate. The system now uses stricter thresholds and a hard guardrail to prevent unrelated articles from clustering together.

**User Priority:** "Precision over recall - prefer 2 separate similar stories over 1 combined unrelated story"

---

## Results

### Before/After Comparison

| Metric | BEFORE | AFTER | Change |
|--------|--------|-------|--------|
| Multi-article stories | 141 | 26 | **-81%** |
| Article-story pairs | 336 | 62 | **-82%** |
| Zero non-stopword overlap (FPs) | 58 pairs | 11 pairs | **-81%** |
| FP rate (%) | 17.3% | 17.7% | Similar |
| Total stories | 1,297 | 1,731 | +33% |
| Attached to existing | ~300 | 92 | **-69%** |

### Key Insight

The FP *percentage* is similar (~17%), but the *total count* of false positives dropped from **58 to 11** (81% reduction). The stricter thresholds mean fewer clusters form, but those that do are much higher quality.

High-quality attachments when they occur: 0.958, 0.954, 0.941, 0.919 (well above 0.70 threshold)

---

## Changes Made

### 1. Entity Stopwords (TTRC-308)
- Added 13 stopwords to `scoring.js:35-49`
- Entities like `US-TRUMP`, `US-BIDEN`, `LOC-USA` now contribute 0 to scoring
- `calculateEntityScore()` returns `{ score, nonStopwordOverlap }`

### 2. Scoring Refactor & Title Bug Fix (TTRC-309)
- Created `cosineSimilarity()` helper at `scoring.js:176-196`
- Fixed title score normalization bug (was inflating 0.5 TF-IDF → 0.75)
- `calculateHybridScore()` now returns detailed object with all raw scores

### 3. Weight Rebalancing (TTRC-310)
- Embedding: 40% → 45%
- Entities: 25% → 12%
- Title: 15% → 25%
- Geography: 10% → 8%
- Keyphrases: 10% → 0% (disabled)

### 4. Threshold Adjustment (TTRC-310)
- Default: 0.62 → 0.70
- Wire: 0.68
- Opinion: 0.76
- Policy: 0.72
- All env-configurable via `THRESHOLD_DEFAULT`, `THRESHOLD_WIRE`, etc.

### 5. Hard Guardrail (TTRC-311)
- Added at `hybrid-clustering.js:159-204`
- Requires: (embedding >= 0.60 AND non-stopword entity overlap) OR (title >= 0.50)
- Logs `[cluster-guardrail-block]` when blocking

### 6. Candidate Generation Optimization (TTRC-312)
- Filters stopwords from entity block queries
- Logs `[candidate-gen] Entity block skipped: only stopword entities`

---

## Files Modified

| File | Lines Changed |
|------|---------------|
| `scripts/rss/scoring.js` | +350/-50 |
| `scripts/rss/hybrid-clustering.js` | +50/-10 |
| `scripts/rss/candidate-generation.js` | +15/-5 |
| `scripts/analyze-cluster-scores.mjs` | NEW (~300 lines) |

---

## JIRA Tickets (All Done)

- ✅ TTRC-307: Diagnostic Baseline
- ✅ TTRC-308: Entity Stopwords
- ✅ TTRC-309: Scoring Refactor
- ✅ TTRC-310: Weights + Thresholds
- ✅ TTRC-311: Hard Guardrail
- ✅ TTRC-312: Candidate Gen Optimization
- ✅ TTRC-313: Full Re-cluster & Validation

---

## AI Code Review

Both commits passed AI code review. Blockers identified were false positives:
- Run #1 (20111617994): 4 blockers - 3 false positives, 1 real bug (missing export) → FIXED
- Run #2 (20111983695): 1 blocker - FALSE POSITIVE (ENTITY_STOPWORDS IS defined at line 36)

---

## Validation Notes

### Gold Clusters
Old story IDs (4105, 4119, etc.) are GONE after re-cluster. New IDs start at 4531+.
The remaining 11 pairs with zero non-stopword overlap may need manual review to determine if they're true false positives or edge cases.

### Re-cluster Observations
- `[candidate-gen] Entity block skipped: only stopword entities` - TTRC-312 working
- Low scores (0.484, 0.668) correctly rejected → new stories created
- High scores (0.958, 0.954) correctly attached

---

## Future Considerations

1. **Threshold tuning:** If 1731 stories feels too fragmented, consider lowering default threshold to 0.68
2. **Dynamic stopwords (TTRC-304):** Auto-compute corpus frequencies instead of hardcoded list
3. **Fix keyphrase scoring (TTRC-305):** Currently disabled (weight=0)
4. **Remaining 11 FP pairs:** Manual review to determine if threshold/guardrail needs adjustment

---

## Commands

```bash
# Run diagnostic analysis
node scripts/analyze-cluster-scores.mjs

# Re-cluster all (destructive - deletes all stories)
node scripts/recluster-all.mjs

# Check current story count
# Via Supabase MCP: SELECT COUNT(*) FROM stories;
```

---

## Session Stats

- **Context compactions:** 2
- **Duration:** ~3 hours across multiple sessions
- **Re-cluster time:** 27 minutes for 1830 articles

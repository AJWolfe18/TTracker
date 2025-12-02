# TTRC-236: Merge Validation Framework - Session Handoff

**Date:** 2025-12-01
**Commit:** d4d66ea
**Branch:** test
**Status:** Initial validation complete, insights gathered

---

## Summary

Completed the merge validation framework for TTRC-236. Fixed critical bugs in the candidate generator, updated the validator with per-bucket metrics, and ran initial validation on 47 labeled pairs.

---

## What Was Done

### 1. Fixed Embedding Parsing Bug (Bucket B = 0)
**Root cause:** Supabase returns `centroid_embedding_v1` as strings (e.g., `"[0.1,0.2,...]"`), not JavaScript arrays. The `cosineSimilarity()` function was comparing character lengths, returning 0 for all pairs.

**Fix:** Added `parseEmbedding()` helper with:
- Defensive parsing (handles both string and array formats)
- Debug logging to confirm diagnosis
- Graceful fallback for malformed data

### 2. Updated Candidate Generator (`create-merge-test-data.js`)
- Bucket B now filters for stories WITH embeddings (not just recent)
- Lowered similarity threshold from 0.70 → 0.50 for broader coverage
- Now generates 51 candidates: A=13, B=18, C=10, D=10

### 3. Enhanced Validator (`validate-merge-quality.js`)
- **Skip MAYBE rows** - excluded from P/R/F1 metrics (was treating as YES)
- **Per-bucket metrics** - breakdown by A/B/C/D for targeted tuning
- **explainMergeDecision diagnostics** - FP/FN reports show `lane`, `blockedBy`, `shared` count

---

## Initial Validation Results

| Metric | Value |
|--------|-------|
| Total pairs | 47 (4 MAYBE excluded) |
| Coverage | 76.6% (36 usable after filters) |
| **Precision** | **100%** (zero false positives) |
| **Recall** | **36.4%** (7 missed duplicates) |
| **F1** | **53.3%** |

### Per-Bucket Breakdown

| Bucket | Pairs | Precision | Recall | F1 | Notes |
|--------|-------|-----------|--------|-----|-------|
| A | 4 | 0% | 0% | 0% | All NO labels (different events) |
| B | 12 | 100% | 50% | 67% | Best performing bucket |
| C | 10 | 0% | 0% | 0% | 1-entity lane disabled |
| D | 10 | 0% | 0% | 0% | Correctly rejecting different events |

### False Negatives Analysis

7 pairs labeled YES but not merged by algorithm:

| Stories | Sim | Blocked By | Issue |
|---------|-----|------------|-------|
| 39/40 | 0.55 | LOW_SIM_3 | Threshold too high for 3-entity pairs |
| 40/58 | 0.56 | LOW_SIM_2 | Threshold too high for 2-entity pairs |
| 41/56 | 0.60 | LOW_SIM_3 | Arizona election coverage |
| 41/66 | 0.63 | LOW_SIM_2 | Same election, different sources |
| 1516/1781 | 0.00 | 1_ENTITY_LANE_DISABLED | No embedding + 1-entity only |

---

## Key Insights

1. **Precision is excellent (100%)** - Current thresholds prevent false positives
2. **Recall is the bottleneck (36%)** - Thresholds too conservative
3. **Similarity range for YES pairs: 0.55-0.93** - Current threshold (0.75/0.65) misses 0.55-0.65 range
4. **11 pairs skipped by TIME_WINDOW** - May need to relax time window for validation
5. **Bucket B is most informative** - High-sim pairs with entity overlap

---

## Next Session Tasks

1. **Consider lowering thresholds:**
   - SIM_FOR_2: 0.75 → 0.50 or 0.55
   - SIM_FOR_3: 0.65 → 0.50 or 0.55
   - Will increase recall but monitor for FP increase

2. **Expand ground truth:**
   - Target: 70-100 labeled pairs
   - Focus on Bucket B (recall gaps)
   - Add more C pairs if 1-entity lane is enabled

3. **Embedding backfill:**
   - Recent stories (last 14 days) lack embeddings
   - Run enrichment to populate `centroid_embedding_v1`

4. **Monitor AI code review:**
   - Run ID: 19843955219
   - Check for any blocking issues

---

## Files Modified

| File | Change |
|------|--------|
| `scripts/create-merge-test-data.js` | NEW - 4-bucket candidate generator |
| `scripts/lib/merge-logic.js` | `explainMergeDecision()` already existed, no change |
| `scripts/validate-merge-quality.js` | Skip MAYBE, per-bucket metrics, diagnostics |
| `docs/plans/2025-12-01-ttrc-236-session-continuation.md` | Session plan |

---

## Ground Truth Files (Local Only - Gitignored)

| File | Description |
|------|-------------|
| `merge-candidates.csv` | 51 generated candidates |
| `merge-ground-truth.csv` | 47 labeled pairs (11 YES, 32 NO, 4 MAYBE) |

---

**Next Owner:** Continue threshold tuning and ground truth expansion
**JIRA:** Update TTRC-236 with initial metrics

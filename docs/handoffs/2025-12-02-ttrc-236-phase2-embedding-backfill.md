# TTRC-236 Phase 2: Embedding Backfill & Threshold Tuning

**Date:** 2025-12-02
**Ticket:** TTRC-236
**Status:** Decision Point - Threshold Selection

---

## What Was Done

### Step 1: Scoped Embedding Backfill ✅
- Identified 19 ground truth stories missing centroids
- Generated embeddings for 17 articles using `text-embedding-ada-002`
- 2 articles had no content (Politico live-updates) - embedded from titles only
- All 19 GT stories now have centroids (100% coverage)
- **Cost:** ~$0.00015 (1,432 tokens)

### Step 2: Candidate Generation ✅
- Generated 33 new candidate pairs via `create-merge-test-data.js`
- Filtered to 30 new pairs (3 already in ground truth)
- Distribution: A=1, B=9, C=10, D=10

### Step 3: Labeling ✅
- Josh labeled 30 pairs
- Results: 9 YES, 19 NO, 2 MAYBE
- Merged into `merge-ground-truth.csv` (now 84 rows)

### Step 4: Validation ✅
- Ran threshold sweep with expanded ground truth
- 30 pairs evaluated (45 skipped as TEST_DATA)

---

## Current Metrics

| Config (SIM_FOR_2/SIM_FOR_3) | Precision | Recall | F1 |
|------------------------------|-----------|--------|-----|
| 0.75/0.65 | 88.9% | 100% | 94.1% |
| 0.80/0.70 | 87.5% | 87.5% | 87.5% |
| **0.85/0.75** | **100%** | **62.5%** | **76.9%** |
| 0.88/0.78 (current) | 100% | 50.0% | 66.7% |

**Baseline:** Precision 100%, Recall 36.4%, F1 53.3%

---

## Decision Needed

**Recommended config:** `SIM_FOR_2=0.85, SIM_FOR_3=0.75`
- Meets 95% precision floor (actually 100%)
- Recall improves from 36.4% → 62.5% (+72%)
- F1 improves from 53.3% → 76.9% (+44%)

**Alternative:** Accept 88.9% precision for 100% recall (0.75/0.65)

---

## Bugs Found (Separate Tickets)

### TTRC-297: Job Queue Worker Embedding Model Mismatch
- Worker uses `text-embedding-3-small` (line 239)
- Existing data uses `text-embedding-ada-002`
- Would corrupt similarity space if worker processes new articles
- **Fix:** Change model to `ada-002` in `job-queue-worker.js`

### Additional issues in TTRC-297:
- Worker orders jobs by `created_at` not `run_at` (line 814)
- No `embedding_model_v1` tracking when writing embeddings

---

## Files Modified/Created

| File | Change |
|------|--------|
| `merge-ground-truth.csv` | +30 labeled pairs (84 total) |
| `merge-test-ground-truth.csv` | Copy for validation |
| `merge-candidates-to-label.csv` | Labeled candidates |
| `scripts/filter-new-merge-candidates.js` | New utility script |
| `scripts/temp-*.js` | Created and deleted |

---

## Next Steps

1. **Decision:** Confirm threshold selection (0.85/0.75 recommended)
2. **Update:** Apply new thresholds to `scripts/lib/merge-thresholds.js`
3. **Monitor:** Watch production merge quality with new thresholds
4. **Fix:** Address TTRC-297 before next RSS run to prevent model mixing

---

## Commands Reference

```bash
# Regenerate candidates
node scripts/create-merge-test-data.js > merge-candidates.csv

# Filter new candidates
node scripts/filter-new-merge-candidates.js merge-ground-truth.csv merge-candidates.csv merge-candidates-to-label.csv

# Run validation
cp merge-ground-truth.csv merge-test-ground-truth.csv
node scripts/validate-merge-quality.js
```

---

## Session Stats
- **Token usage:** ~50K estimated
- **OpenAI cost:** $0.00015 (embedding generation)

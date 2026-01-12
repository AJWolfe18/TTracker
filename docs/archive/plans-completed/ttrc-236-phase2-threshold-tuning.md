# TTRC-236 Phase 2: Threshold Tuning & Ground Truth Expansion

**Created**: 2025-12-01
**Status**: In Progress
**Ticket**: TTRC-236

## Context

- **Current state**: Precision 100%, Recall 36.4%, F1 53.3%
- **Ground truth**: 47 pairs (11 YES, 32 NO, 4 MAYBE) - too small for confident tuning
- **Thresholds**: SIM_FOR_2=0.88, SIM_FOR_3=0.82 (conservative)
- **Embeddings**: ~5% coverage, sparse on recent stories

## User Requirements

1. **Precision > Recall** - FP undermines trust, FN is just clutter
2. Expand ground truth to 70-100 pairs before locking thresholds
3. Scoped embedding backfill before serious tuning
4. Build tuning machinery in parallel (sanity checks only)

---

## Execution Order

### Step 1: Scoped Embedding Backfill (~$0.03)

**Goal**: Ensure all stories in ground truth + recent window have embeddings

**Why first**: Bucket B candidate quality depends on embedding similarity. Generate candidates AFTER backfill so similarity scores reflect real data distribution.

**Tasks**:
1. Extract unique story IDs from current `merge-ground-truth.csv`
2. Query recent stories (last 30 days) without `centroid_embedding_v1`
3. Run `backfill-article-embeddings.js` for articles in those stories
4. Process jobs via `job-queue-worker.js`
5. **Verify coverage explicitly**:
   - All story_ids in `merge-ground-truth.csv` have embeddings
   - All stories in candidate window (first_seen_at within 30 days) have embeddings
   - Not just a global count

**Files**:
- `scripts/backfill-article-embeddings.js`
- `scripts/job-queue-worker.js`

**Cost**: ~$0.03 (estimated 140 articles × $0.0002/article)

---

### Step 2: Generate Fresh Candidate File

**Goal**: A/B/C/D buckets with accurate post-backfill similarity scores

**Why after backfill**: Labels should align exactly with the data distribution we'll tune on. Stale similarity scores could shift which pairs qualify as "high similarity."

**Tasks**:
1. Run `create-merge-test-data.js` with updated embedding coverage
2. Output `merge-candidates.csv` with accurate similarity scores
3. Review bucket distribution (target: heavier Bucket B for recall gaps)

**Files**:
- `scripts/create-merge-test-data.js`
- `merge-candidates.csv` (output, local/gitignored)

---

### Step 3: Expand Ground Truth (70-100 pairs)

**Goal**: Statistically robust dataset for threshold decisions

**Tasks**:
1. Josh labels 30-50 new pairs from generated candidates
2. Focus on Bucket B (recall gaps - high-similarity unmerged pairs)
3. Update `merge-ground-truth.csv` with new labels
4. Re-run validation to get updated metrics

**Target distribution**:
- YES pairs: 25-35 (currently 11)
- NO pairs: 45-65 (currently 32)
- MAYBE: minimize (exclude from metrics)

**Files**:
- `merge-ground-truth.csv` (local, gitignored)

---

### Step 4: Build Threshold Tuning Machinery

**Goal**: Grid search infrastructure with precision floor and diagnostics

**Tasks**:
1. Verify `validate-merge-quality.js` grid search works
2. Add precision floor constraint (≥95% required)
3. **Progressive grid search** (start conservative, expand if precision holds):
   - First pass: SIM_FOR_2 ∈ [0.75, 0.85], SIM_FOR_3 ∈ [0.70, 0.80]
   - If precision stays >95%: expand to SIM_FOR_2 ∈ [0.65, 0.75], SIM_FOR_3 ∈ [0.60, 0.70]
   - Only explore aggressive [0.55, 0.50] if precision remains comfortable
4. **Per-bucket diagnostics**: For top configs, output:
   - Metrics broken down by bucket (A/B/C/D)
   - Sample FPs/FNs with `explainMergeDecision()` output (lane, blockedBy)
   - Confirm recall improvements come from intended buckets (B/C) without bad merges in D
5. Output: ranked configs by F1 (only those meeting precision floor)

**Constraints** (per user requirements):
- **Precision floor**: 95% minimum (FP is worse than FN)
- **Recall target**: Improve as far as possible without crossing precision floor

**Files**:
- `scripts/validate-merge-quality.js`
- `scripts/lib/merge-thresholds.js`

---

### Step 5: Final Threshold Selection

**Goal**: Lock in thresholds based on expanded ground truth

**Prerequisite**: Steps 1-4 complete, ground truth at 70+ pairs

**Tasks**:
1. Run full grid search with expanded data
2. Select config with highest recall where precision ≥ 95%
3. **Cross-validation** (if ground truth > 100 pairs):
   - Reserve 20-30% as holdout set
   - Tune on remaining 70-80%
   - Validate precision/recall on holdout before adopting config
4. Update `merge-thresholds.js` with new values
5. Re-run validation to confirm metrics
6. Document decision rationale in handoff

---

## Success Criteria

- [ ] Embedding coverage: 100% for ground truth stories + last 30 days
- [ ] Ground truth size: 70+ labeled pairs (25+ YES)
- [ ] Precision maintained: ≥ 95%
- [ ] Recall improved: Target 50-60% (from 36.4%)
- [ ] F1 improved: Target 65-70% (from 53.3%)

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/lib/merge-thresholds.js` | Update SIM_FOR_2, SIM_FOR_3 after tuning |
| `scripts/validate-merge-quality.js` | Add precision floor constraint to grid search |
| `merge-ground-truth.csv` | Expand with new labeled pairs |

---

## Risk Mitigation

- **Precision drop**: Hard floor at 95% - no config below this considered
- **Overfitting**: Cross-validate with holdout set if ground truth exceeds 100 pairs
- **Embedding drift**: Recompute centroids via `recompute_story_centroids()` if needed
- **Bucket D FPs**: Per-bucket diagnostics catch bad merges in "same topic, different events" pairs

---

## Estimated Effort

| Step | Dev Time | Other |
|------|----------|-------|
| 1. Backfill | 30 min | ~5 min runtime, $0.03 |
| 2. Generate candidates | 15 min | - |
| 3. Labeling | - | 1-2h Josh's time |
| 4. Tuning machinery | 1 hour | - |
| 5. Final selection | 30 min | - |

**Total**: ~2.5 hours dev time + labeling session

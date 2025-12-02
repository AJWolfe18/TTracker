# TTRC-236: Session Continuation - Fix Bucket B & Complete Validation

## Prior Session Summary (from snuggly-twirling-feigenbaum.md)

| Item | Status |
|------|--------|
| Smoke test | ✅ Passed |
| `explainMergeDecision()` | ✅ Implemented in merge-logic.js |
| Generator script | ✅ Created (scripts/create-merge-test-data.js) |
| Candidate generation | ⚠️ Partial (A=10, B=0, C=8, D=8 = 26 total) |
| Ground truth labeling | ❌ Not started |
| Validation run | ❌ Blocked by above |

---

## Issues Identified

### 1. Bucket B = 0 (Critical Bug)

**Root Cause:** Supabase returns `centroid_embedding_v1` as a string (e.g., `"[0.1,0.2,...]"`), not a JavaScript array. The `cosineSimilarity()` function at `create-merge-test-data.js:27-36`:
- Checks `a.length !== b.length` → compares string character counts, not vector dimensions
- Iterates with `for (let i = 0; i < a.length; i++)` → indexes characters, not floats
- Returns 0 or garbage for all pairs

**Evidence:** All similarity columns in merge-candidates.csv are empty (only happens when similarity is 0/falsy).

**Fix:** Add defensive embedding parsing with diagnostic logging:
```javascript
function parseEmbedding(emb) {
  if (!emb) return null;
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try {
      const parsed = JSON.parse(emb);
      console.error('  [DEBUG] Parsed string embedding to array');
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      console.error('  [DEBUG] Failed to parse embedding string');
      return null;
    }
  }
  return null;
}
```

### 2. Validator Treats MAYBE as YES

**Location:** `validate-merge-quality.js:103`
```javascript
are_duplicates: val === 'yes' || val === 'maybe',  // WRONG per plan
```

**Fix:** Skip MAYBE rows entirely from P/R/F1 calculation (as specified in original plan).

### 3. No Per-Bucket Metrics

**Current:** Validator outputs overall P/R/F1 only.
**Needed:** Breakdown by bucket (A/B/C/D) to identify which bucket has issues.

### 4. Error Report Missing Diagnostics

**Current:** FP/FN list shows story IDs and headlines only.
**Needed:** Use `explainMergeDecision()` to show `lane` and `blockedBy` for actionable tuning:
```
FN: Stories 1234/5678 (bucket=B, lane=multi_entity, blockedBy=LOW_SIM_2)
```

---

## Approach (User-Approved)

1. **Keep existing A/C/D candidates** (18 pairs from current CSV)
2. **Fix embedding parsing** in generator with defensive code + diagnostic logging
3. **Regenerate Bucket B only** (target ~15 pairs)
4. **Final target:** ~40 pairs (A≈10, B≈15, C≈8, D≈7)
5. **Update validator** to:
   - Skip MAYBE rows
   - Add per-bucket metrics
   - Use `explainMergeDecision()` in error reports

---

## Implementation Steps

### Step 1: Fix Generator (Bucket B)
**File:** `scripts/create-merge-test-data.js`

1. Add `parseEmbedding()` helper with defensive parsing + debug logging
2. Update `cosineSimilarity()` calls to use parsed embeddings
3. If parsing fails, log warning and skip pair (don't include in output)

### Step 2: Regenerate Bucket B Only
```bash
# Run with debug output to confirm fix
node scripts/create-merge-test-data.js 2>&1 | tee regenerate-log.txt

# Verify bucket distribution
head -5 merge-candidates.csv
```

**Expected output:** `Generated: ~40 pairs across 4 buckets (A≈10, B≈15, C≈8, D≈7)`

### Step 3: Merge with Existing Candidates
- Keep existing A/C/D rows from current `merge-candidates.csv`
- Add new Bucket B rows
- Remove duplicate pairs (by story1_id/story2_id)

### Step 4: Update Validator
**File:** `scripts/validate-merge-quality.js`

1. **Skip MAYBE rows** - modify line 93-103:
   ```javascript
   // Filter out MAYBE - don't include in metrics
   const labeled = records.filter(r => {
     const val = (r.are_duplicates || '').trim().toLowerCase();
     return val === 'yes' || val === 'no';  // MAYBE excluded
   });
   ```

2. **Add bucket column to ground truth** - parse from CSV

3. **Per-bucket metrics** - group results by bucket, compute P/R/F1 per group:
   ```
   bucket    n_pairs    precision    recall    f1
   A         10         1.00         0.70      0.82
   B         15         0.95         0.55      0.70
   C         8          1.00         0.30      0.46
   D         7          1.00         0.00      n/a
   ---
   OVERALL   40         0.97         0.52      0.68
   ```

4. **Use explainMergeDecision() for error reports**:
   ```javascript
   import { explainMergeDecision } from './lib/merge-logic.js';

   // In FP/FN reporting:
   const ctx = explainMergeDecision(pair.story1, pair.story2, pair.similarity, config);
   console.log(`FN: Stories ${p.story1_id}/${p.story2_id} (bucket=${p.bucket}, lane=${ctx.lane}, blockedBy=${ctx.blockedBy.join(',')})`);
   ```

### Step 5: Label Candidates (~20 min)
Copy `merge-candidates.csv` → `merge-ground-truth.csv`, then label `are_duplicates`:
- `YES` = Same event, should merge
- `NO` = Different events, should NOT merge
- `MAYBE` = Unclear (excluded from metrics)

### Step 6: Run Validation
```bash
node scripts/validate-merge-quality.js merge-ground-truth.csv
```

### Step 7: Commit & Handoff
- Commit all changes to test branch
- Check AI code review
- Create handoff doc with P/R/F1 results
- Update JIRA

---

## Files to Modify

| File | Action | Priority |
|------|--------|----------|
| `scripts/create-merge-test-data.js` | Add `parseEmbedding()`, fix similarity calc | 🔴 High |
| `scripts/validate-merge-quality.js` | Skip MAYBE, per-bucket metrics, use explainMergeDecision | 🟡 Medium |
| `merge-candidates.csv` | Regenerate with fixed Bucket B | 🔴 High |
| `merge-ground-truth.csv` | Create from candidates + labels | ⬜ Manual |

---

## Success Criteria

1. ✓ Bucket B has ~15 candidates with valid similarity scores
2. ✓ Total ~40 pairs labeled (YES/NO, MAYBE excluded)
3. ✓ Validator runs with per-bucket P/R/F1 breakdown
4. ✓ Error reports show `lane`/`blockedBy` diagnostics
5. ✓ Initial metrics reported
6. ✓ Handoff doc created

---

**Created:** 2025-12-01
**Status:** Ready for Implementation

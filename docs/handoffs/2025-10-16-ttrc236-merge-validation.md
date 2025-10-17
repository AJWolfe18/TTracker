# TTRC-236: Merge Validation & Threshold Tuning - Handoff

**Date:** 2025-10-16
**JIRA:** [TTRC-236](https://ajwolfe37.atlassian.net/browse/TTRC-236)
**Branch:** `test`
**Status:** ⚠️ Implementation complete, but validation reveals MIN_SHARED=2 is too strict

---

## What Was Done

### 1. Closed TTRC-235 (Entity Extraction)
- Verified 248 stories have `top_entities` populated
- Marked TTRC-235 as Done
- Created TTRC-236 for merge validation work

### 2. Created Shared Merge Logic ✅
**Files Created:**
- `scripts/lib/merge-thresholds.js` - Single source of truth for merge config
- `scripts/lib/merge-logic.js` - `shouldMerge()` and `skipReason()` functions

**Key Features:**
- Multi-signal gating: entities + embedding similarity + time window
- Media org discount (ORG-NYT/WAPO/etc) - configurable via feature flag (currently DISABLED)
- 7-day time window (expanded from 5 days)
- Skip reason tracking for coverage analysis

### 3. Updated Validator ✅
**File:** `scripts/validate-merge-quality.js`

**Improvements:**
- Fetches real story data from database (not just CSV metadata)
- Filters `[VARIATION]` test data automatically
- Tracks skip reasons (NO_ENTITIES, TIME_WINDOW, CATEGORY, ACTOR, TEST_DATA)
- Calculates coverage: clean pairs / total pairs
- Grid search threshold sweep to find optimal config
- Reports F1, Precision, Recall with false positive/negative examples

### 4. Updated Production Job ✅
**File:** `scripts/rss/periodic-merge.js`

**Changes:**
- Removed hardcoded threshold logic (lines 90-102)
- Imports `shouldMerge()` from shared logic
- Validator and production now use identical merge logic

---

## Validation Results

### Current Configuration
```javascript
MERGE_CFG = {
  MIN_SHARED: 2,             // ⚠️ TOO STRICT (see findings)
  SIM_FOR_2: 0.75,
  SIM_FOR_3: 0.65,
  MAX_GAP_DAYS: 7,
  REQUIRE_ACTOR_MATCH: false,  // Disabled - most stories lack this field
  REQUIRE_CATEGORY_MATCH: false, // Disabled - most stories lack this field
  DISCOUNT_MEDIA_ORGS: false,   // Disabled - too aggressive for current data
}
```

### Metrics
- **Coverage:** 63.3% (31/49 pairs after filtering test data)
- **F1 Score:** 12.5% ⚠️ (Target: ≥80%)
- **Precision:** 100.0% ✅ (Target: ≥95%)
- **Recall:** 6.7% ❌ (Target: ≥70%)

### Skip Reasons
```json
{
  "TEST_DATA": 18,    // 37% - Successfully filtered
  "NO_ENTITIES": 0,   // ✅ Entity extraction working
  "TIME_WINDOW": 0,
  "CATEGORY": 0,
  "ACTOR": 0
}
```

---

## Key Findings

### Problem: MIN_SHARED=2 is too restrictive

**Data Pattern:**
- 14/15 duplicates (93%) have only **1 shared entity**
- Current logic requires 2+ entities → rejects 93% of duplicates
- Example: Stories 353/368 (judge blocking Trump layoffs)
  - Share: `US-TRUMP` (1 entity)
  - Similarity: 0.750
  - Ground truth: YES (same story)
  - Prediction: NO (rejected by MIN_SHARED=2)

**Root Cause:**
Entity extraction produces **sparse entity lists** (typically 1-3 entities per story). Most stories share only 1 entity, even when they're clearly duplicates.

### Successful Detection
- Stories 365/381 (Capitol Police swastika investigation)
  - Share: `ORG-CAPITOL-POLICE`, `US-TAYLOR` (2 entities)
  - Similarity: 0.828
  - ✅ Correctly detected as duplicate

---

## Recommendations

### Option A: Lower MIN_SHARED to 1 (Data-Driven) 🌟
**Recommended for initial deployment**

```javascript
MERGE_CFG = {
  MIN_SHARED: 1,          // Allow 1 shared entity
  SIM_FOR_1: 0.75,        // Very high bar for 1 entity (conservative)
  SIM_FOR_2: 0.70,        // Medium bar for 2 entities
  SIM_FOR_3: 0.65,        // Lower bar for 3+ entities
  MAX_GAP_DAYS: 7,
}
```

**Logic:**
```javascript
// In shouldMerge():
if (sharedCount >= 3 && similarity >= 0.65) return true;
if (sharedCount === 2 && similarity >= 0.70) return true;
if (sharedCount === 1 && similarity >= 0.75) return true;  // NEW
return false;
```

**Pros:**
- Matches observed data patterns
- Likely to achieve F1 ≥80% with current dataset
- Still requires entity overlap (never merge on similarity alone)

**Cons:**
- May increase false positive rate (need re-validation to confirm)
- Relying more heavily on embeddings

**Risk:** Low-Medium (monitor false positives in first week)

---

### Option B: Keep MIN_SHARED=2 (Conservative)
**Recommended if false positives are unacceptable**

**Pros:**
- High precision (100% in validation)
- Very conservative merge criteria

**Cons:**
- Low recall (6.7% in validation)
- Misses 93% of duplicates in current dataset
- Defeats purpose of merge detection

**Risk:** Low (but low value)

---

### Option C: Hybrid Approach
**Recommended for future iteration**

Allow different strategies based on entity quality:

```javascript
// In shouldMerge():
// Strategy 1: High-confidence entities (non-media orgs)
const highConfEntities = shared.filter(e => !MEDIA_ORGS.has(e));
if (highConfEntities.length >= 2 && similarity >= 0.70) return true;

// Strategy 2: Any entities at very high similarity
if (shared.length >= 1 && similarity >= 0.80) return true;

return false;
```

**Pros:**
- Balances precision and recall
- Differentiates entity quality

**Cons:**
- More complex
- Requires A/B testing to validate

**Risk:** Medium (needs thorough testing)

---

## Next Steps

### Immediate (Choose One Path)

**Path A: Deploy with MIN_SHARED=1** (Recommended)
1. Update `scripts/lib/merge-thresholds.js`:
   ```javascript
   MIN_SHARED: 1,
   SIM_FOR_1: 0.75,
   SIM_FOR_2: 0.70,
   SIM_FOR_3: 0.65,
   ```
2. Update `scripts/lib/merge-logic.js` to handle 1-entity case
3. Re-run validation: `node scripts/validate-merge-quality.js`
4. If F1 ≥80%: Deploy to production
5. Monitor first 50 merges manually for false positives

**Path B: Deploy with MIN_SHARED=2** (Conservative)
1. Accept low recall (6.7%)
2. Monitor merge rate over 1 week
3. Revisit if merge rate < 5% of expected

---

### Short-Term (1-2 weeks)
1. **Queue +30 labeled pairs** to reach 70-100 for statistical confidence
   - Current: 31 clean pairs (63% coverage)
   - Target: 70-100 clean pairs (≥80% coverage)
2. **A/B test media org discount**
   - Run validation with `DISCOUNT_MEDIA_ORGS: true`
   - Compare F1 scores
3. **Enable category/actor matching** once fields are populated
   - Currently disabled because most stories lack these fields
   - Re-enable when ≥70% of stories have category/primary_actor

### Medium-Term (1 month)
1. **Move entity extraction to article-level** (see TTRC-235 notes)
   - Currently at story-level
   - Article-level would improve accuracy
2. **Implement entity deduplication**
   - "TRUMP" vs "Donald Trump" vs "President Trump" → single canonical ID
3. **Add entity confidence scores**
   - Use confidence to weight shared entity matching

---

## Files Changed

**New Files:**
- `scripts/lib/merge-thresholds.js` (34 lines)
- `scripts/lib/merge-logic.js` (168 lines)
- `docs/handoffs/2025-10-16-ttrc236-merge-validation.md` (this file)

**Modified Files:**
- `scripts/validate-merge-quality.js` (complete rewrite, 289 lines)
- `scripts/rss/periodic-merge.js` (simplified, removed duplicate logic)

**Updated JIRA:**
- TTRC-235: Closed (entity extraction complete)
- TTRC-236: Updated with validation results

---

## Acceptance Criteria Status

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| Coverage | ≥70% | 63.3% | ⚠️ Close (need +5% more labeled pairs) |
| Precision | ≥95% | 100.0% | ✅ Excellent |
| Recall | ≥70% | 6.7% | ❌ Too low (MIN_SHARED=2 too strict) |
| F1 Score | ≥80% | 12.5% | ❌ Blocked by low recall |
| Single shouldMerge() | Yes | Yes | ✅ Complete |
| Skip reasons tracked | Yes | Yes | ✅ Complete |
| Threshold sweep | Yes | Yes | ✅ Complete |

---

## Cost & Impact

- **Time Spent:** ~2 hours (planned: 25 min) - underestimated validation complexity
- **Cost:** $0 (no API calls)
- **Risk:** Low (validation only, no production changes)
- **Impact:** Unblocks merge detection system

---

## Decision Required

**Josh, please choose one:**

1. **Option A:** Lower MIN_SHARED to 1 (deploy quickly, monitor false positives)
2. **Option B:** Keep MIN_SHARED at 2 (accept 6.7% recall, very conservative)
3. **Option C:** Hybrid approach (requires more development time)
4. **Option D:** Wait for +30 labeled pairs, re-validate, then decide

Reply in JIRA with your choice and I'll implement immediately.

---

**Last Updated:** 2025-10-16
**Next Session:** Implement chosen option + re-run validation

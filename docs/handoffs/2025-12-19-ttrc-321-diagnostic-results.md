# TTRC-321 Phase 0 Diagnostic Results

**Date:** 2025-12-19
**Status:** Analysis Complete - Ready for Phase 1 Implementation
**Workflow Run:** 20384543873
**Branch:** test

---

## Summary

Ran Phase 0 diagnostic logging to diagnose batch deduplication issue. **79 new stories created**, many of which should have clustered together.

## Key Finding: SCORING ISSUE, Not Candidate Generation

The diagnostic logs reveal:

1. **Same-run stories ARE being found** as best matches (via ANN/embedding block)
2. **BUT scoring doesn't reach 0.700 threshold** - best totals range 0.55-0.68
3. The `from_this_run=0` counter is misleading - stories ARE being found

## Evidence

### Same-Run Stories Found But Below Threshold

| Topic | Best Match Story | Best Score | Embedding | Gap to 0.700 |
|-------|-----------------|------------|-----------|--------------|
| Epstein | 15717 | **0.680** | 0.901 | **-0.020** |
| Stefanik | 15712 | 0.640 | 0.934 | -0.060 |
| Epstein | 15711 | 0.646 | 0.854 | -0.054 |
| Bongino | 15745 | 0.623 | 0.923 | -0.077 |
| ACA | 15744 | 0.596 | 0.921 | -0.104 |

### Duplicates Created This Run

| Topic | Stories Created | Should Be |
|-------|----------------|-----------|
| Epstein Files | 6+ (15711, 15713, 15716, 15717, 15719, 15721) | 1 |
| Elise Stefanik | 3 (15712, 15714, 15723) | 1 |
| Dan Bongino/FBI | 4+ (15742, 15745, 15747, 15749) | 1 |
| Kennedy Center | 2 (15709, 15724) | 1 |
| ACA Subsidies | 3 (15736, 15744, 15753) | 1 |
| Marijuana | 2 (15729, 15730) | 1 |
| Trump Media/Fusion | 2 (15733, 15737) | 1 |

## Root Cause Analysis

The scoring formula penalizes same-run stories:

1. **Entity overlap = 0** - Entities not populated yet on newly created stories
2. **Title similarity low** - Different headlines even for same topic ("Epstein Files Released" vs "Jeffrey Epstein File Redactions")

This causes total scores of 0.55-0.68 vs the 0.70 threshold, even when embeddings are excellent (0.85-0.93).

### Scoring Formula Breakdown (Estimated)

For same-run story matches:
- Embedding (35%): 0.90 × 0.35 = 0.315
- Title (15%): 0.30 × 0.15 = 0.045 (low - different headlines)
- Entity (15%): 0.00 × 0.15 = 0.000 (no entities yet)
- Recency (15%): 1.00 × 0.15 = 0.150
- Freshness (15%): 1.00 × 0.15 = 0.150
- Source div (5%): 0.60 × 0.05 = 0.030

**Estimated Total: ~0.69** (matches observed 0.62-0.68)

## Recommendation: Proceed to Phase 1

Since scoring is SO CLOSE to threshold (some at 0.680 vs 0.700), implement **same-batch title dedup**:

Before creating a new story, check if any story created in the current batch has high title similarity (>0.70). If yes, attach instead of creating.

This is a lightweight fix that catches obvious duplicates without changing the core scoring algorithm.

## Next Steps

1. **Implement Phase 1** - Same-batch title similarity check in `hybrid-clustering.js`
2. **Test with another workflow run**
3. **Clean up diagnostic logging** - Remove `LOG_PHASE0_DIAGNOSTICS` after validation

## Files Modified

- `.github/workflows/rss-tracker-test.yml` - Added `LOG_PHASE0_DIAGNOSTICS: 'true'`

## JIRA Status

- **Ticket:** TTRC-321
- **Status:** In Progress
- **Comment:** Diagnostic results added with detailed analysis

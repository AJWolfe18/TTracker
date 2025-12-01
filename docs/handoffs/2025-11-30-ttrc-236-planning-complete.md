# Handoff: TTRC-236 Planning Complete

**Date:** 2025-11-30
**Status:** Planning Complete - Ready for Session 1

---

## What Was Done This Session

### 1. Reviewed Previous Work
- Confirmed TTRC-155 (Feed-to-Topic Mapping) complete - can be closed
- Confirmed TTRC-296 fixed and JIRA updated

### 2. Created Comprehensive Plan for TTRC-236
- Full plan at: `docs/plans/ttrc-236-merge-validation.md`
- Incorporated external reviewer feedback

### 3. Key Decisions Made
- **Focus:** Tune 2-entity lane first (relax thresholds, optional actor match)
- **1-entity lane:** Strict, heavily guarded (7+ gates), disabled by default
- **Dataset:** ~100 labeled pairs across 4 buckets
- **Deferred:** CI integration, "related stories" feature, hybrid scoring for Bucket B

---

## Plan Summary

**Goal:** Achieve Precision ≥95%, Recall ≥70%, F1 ≥80%

**Current:** Precision ~100%, Recall ~7%, F1 ~13% (too strict, missing merges)

**Phases:**
1. **Phase 1:** Infrastructure queries + merge distribution analysis
2. **Phase 2:** Build ~100 labeled pairs (4 buckets)
3. **Phase 3:** Validation framework with `explainMergeDecision()` + grid search
4. **Phase 4:** Implementation (if needed)
5. **Phase 5:** 3-session execution plan
6. **Phase 6:** Rollout safety (feature flags, dry-run, lane tagging)

---

## Key Files Created/Updated

| File | Status |
|------|--------|
| `docs/plans/ttrc-236-merge-validation.md` | ✅ Created (comprehensive plan) |
| `.github/workflows/ai-code-review.yml` | ✅ Updated (skip docs-only pushes) |
| `docs/AI-CODE-REVIEW-GUIDE.md` | ✅ Updated |

---

## Next Session: Execute Phase 1

### Start Here
1. Read `docs/plans/ttrc-236-merge-validation.md`
2. Verify GIN index exists:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_stories_top_entities_gin
     ON stories USING gin (top_entities);
   ```
3. Run Phase 1 infrastructure queries
4. Run merge distribution queries
5. Generate candidate pairs for all 4 buckets

### Commands to Resume
```bash
# Verify on test branch
git branch --show-current

# Check plan
cat docs/plans/ttrc-236-merge-validation.md

# No uncommitted work from this session (plan is docs only)
```

---

## JIRA Status

| Ticket | Status | Notes |
|--------|--------|-------|
| TTRC-155 | Ready to close | Backend complete, topics populated |
| TTRC-236 | In Progress | Planning complete, ready for execution |
| TTRC-225 | Blocked | Waiting on TTRC-236 completion |

---

## Files Changed (Uncommitted)

```
docs/plans/ttrc-236-merge-validation.md (NEW)
docs/handoffs/2025-11-30-ttrc-236-planning-complete.md (NEW)
```

**Note:** These are documentation files, no code changes yet.

---

## Token Usage This Session

~50K tokens used for comprehensive planning with external reviewer feedback.

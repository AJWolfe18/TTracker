# Prompt: Implement Stage 1 Title Token Unification

## Context

We analyzed clustering near-misses and found that Tier B and guardrail use different title matching logic, causing logical incoherence. We designed a staged fix:

- **Stage 1 (this task):** Refactor + logging, zero behavior change
- **Stage 2 (after data):** Policy change (raise threshold to >= 2, align guardrail)

## Your Task

Implement Stage 1 as specified in `/docs/plans/ttrc-stage1-title-token-unification.md`.

**Key requirements:**
1. Add `getTitleTokenOverlapEnhanced()` function with pattern-based acronym detection
2. Compute BOTH legacy and enhanced overlaps once, store in scoreResult
3. Tier B uses legacy overlap (behavior unchanged)
4. Guardrail uses titleScore (behavior unchanged)
5. Add overlap fields to CROSS_RUN_OVERRIDE and CROSS_RUN_NEAR_MISS logs

**Critical constraint:** This must be behavior-neutral. No merge decisions should change.

## After Implementation

1. Run RSS: `gh workflow run "RSS Tracker - TEST" --ref test`
2. Check logs for new fields: `title_token_overlap`, `title_token_overlap_enhanced`, etc.
3. Verify no change in merge behavior vs baseline

## Files to Modify

- `scripts/rss/hybrid-clustering.js`

## Reference

See full plan: `/docs/plans/ttrc-stage1-title-token-unification.md`

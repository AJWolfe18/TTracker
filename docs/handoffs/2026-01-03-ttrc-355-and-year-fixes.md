# Handoff: TTRC-355 Stage 1 + Year Fixes

**Date:** 2026-01-03
**Branch:** test
**Commits:** `844f91d`, `fcfe886`, `7b674ca`

---

## TTRC-355: Stage 1 Title Token Unification

**Status:** Ready for Test (JIRA updated)

### What was implemented:
- Added `TITLE_TOKEN_THRESHOLD = 1` constant for easy Stage 2 changes
- Added `ACRONYM_DENYLIST` for ambiguous patterns (US, USA)
- Added `getTitleTokenOverlapEnhanced()` with pattern-based acronym detection
- Added `computeTitleTokenOverlaps()` helper used in both OVERRIDE and NEAR_MISS paths
- 5 new log fields in CROSS_RUN_OVERRIDE and CROSS_RUN_NEAR_MISS:
  - `title_token_overlap` (legacy)
  - `title_token_overlap_enhanced`
  - `title_token_overlap_enhanced_regular`
  - `title_token_overlap_enhanced_acronym`
  - `title_token_threshold`

### Validation:
- RSS tracker ran successfully
- New fields confirmed appearing in logs
- AI code review passed

### Plan document:
`/docs/plans/ttrc-stage1-title-token-unification-v2.md`

---

## Year Fixes (2026 Compatibility)

**Status:** Complete

### Issues fixed:
1. **RSS age filter**: Changed from 72h to 96h (4 days)
2. **daily-tracker-supabase.js**:
   - Removed hardcoded `< 2025` year check
   - Now uses dynamic 1-year cutoff
3. **enrichment/prompts.js**:
   - Changed from hardcoded "2025" to `CURRENT_YEAR` constant
   - Uses `getUTCFullYear()` for timezone safety
4. **executive-orders-tracker.js**:
   - Changed from `includes('2025')` to `date >= inauguration date`
   - Uses proper date comparison instead of string matching

### Design principle:
All changes use dynamic date calculations that won't require yearly updates.

---

## Files Modified

- `scripts/rss/hybrid-clustering.js` - Stage 1 functions and logging
- `scripts/rss/fetch_feed.js` - 96h age filter
- `scripts/daily-tracker-supabase.js` - Dynamic year checks
- `scripts/enrichment/prompts.js` - UTC year constant
- `scripts/executive-orders-tracker.js` - Date-based filtering
- `docs/plans/ttrc-stage1-title-token-unification-v2.md` - Plan document

---

## Next Steps

### Stage 2 Analysis (after data accumulates):
```bash
# Distribution of legacy overlap for title_token overrides
cat logs.jsonl | jq -r 'select(.type=="CROSS_RUN_OVERRIDE" and .corroboration=="title_token") | .title_token_overlap' | sort -n | uniq -c

# If legacy == 1 is <10% of overrides → safe to raise threshold to >= 2
```

### Stage 2 Implementation (separate ticket):
- Raise threshold from >= 1 to >= 2
- Switch from legacy to enhanced acronym counting
- Add titleTokenOverlap check to guardrail

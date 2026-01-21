# ADO-274: Stories Tone Variation Fix - COMPLETE

**Date:** 2026-01-21
**ADO:** https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/274
**Status:** Closed
**Commits:** 994bad4, 423fad6 (code review fixes)

---

## Summary

Implemented frame-based variation system for Stories enrichment to fix repetitive GPT outputs. Replaces the old category-based system that hardcoded alarm level to 3.

## What Was Done

### New File: `scripts/enrichment/stories-style-patterns.js`

Frame-based variation system with:
- **3 frame buckets:** alarmed | critical | grudging_credit
- **3 topic pools:** investigations | policy | general (from feed_registry.topics)
- **9 total pools** (topic × frame)
- **35 patterns** (14 Stories-specific + 21 core from shared)

Key features:
- Deterministic selection via FNV-1a hash (separate `hashBias` and `hashIdx` to avoid correlation)
- Negative context guard for "blocked aid" false positives
- Post-gen banned-starter repair with fail-closed safety
- Exported tuning knob: `STORIES_SPECIFIC_BIAS_THRESHOLD = 40`

### Updated: `scripts/enrichment/enrich-stories-inline.js`

- Feed registry cache with:
  - Race-condition prevention (in-flight promise pattern)
  - String-normalized Map keys for Supabase bigint compatibility
  - Tier range validation (1-3)
  - Cache-on-error for fail-soft stability
- Frame estimation from headline + feed tier (pre-enrichment signals)
- Deterministic variation selection with `PROMPT_VERSION`
- Post-gen validation for banned starters in `summary_spicy`
- Debug logging: `[ADO-274] Story X: frame=Y, pool=Z, pattern=W`

### Updated: `docs/features/labels-tones-alignment/plan.md`

Added ADO-274 completion status and detailed implementation notes.

## Code Review Feedback Applied

1. **Map key type mismatch** - Fixed with `String(feedId)` normalization
2. **Error path caching** - Cache set even on failure (fail-soft, stable)
3. **Race condition** - In-flight promise prevents double-load
4. **Tier sanity** - Range validation (1-3, default 2)
5. **Correlated hash math** - Separate `hashBias` and `hashIdx` hashes
6. **Fail-closed repair** - Only repairs if `phraseStart === 0`
7. **Shared helper** - `stripLeadingJunk()` prevents drift between find/repair

## Post-Commit Code Review Fixes (423fad6)

1. **Negative context patterns incomplete** - Added bridge-word support (0-3 words)
   - Now catches: "Trump blocked DOJ investigation", "blocks congressional oversight"
   - Pattern: `/\bblock(?:ed|s|ing)?\s+(?:\w+\s+){0,3}(investigation|probe|...)\b/i`
2. **Repair reason logging** - `repairBannedStarter()` now returns `reason` field
   - Values: PHRASE_NOT_FOUND, PHRASE_NOT_AT_START, REMAINDER_TOO_SHORT, STILL_BANNED:X
3. **Improved banned-starter logging** - Includes story_id, pattern_id, and failure reason

## Testing Done

- Syntax check: PASS
- Module import test: PASS
- Frame estimation tests: PASS
- Deterministic selection test: PASS
- QA smoke tests: PASS

## Files Changed

| File | Change |
|------|--------|
| `scripts/enrichment/stories-style-patterns.js` | NEW - Frame-based variation system |
| `scripts/enrichment/enrich-stories-inline.js` | Updated imports, feed cache, frame-based selection |
| `docs/features/labels-tones-alignment/plan.md` | Status update |

## Old File Retained

`scripts/enrichment/stories-variation-pools.js` - No longer imported but kept for reference. Can be deleted in future cleanup.

## Next Steps

1. **End-to-end test** - Run RSS pipeline with Stories enrichment to verify variety in production
2. **Monitor** - Watch for banned-starter repair logs in enrichment output
3. **Tune** - Adjust `STORIES_SPECIFIC_BIAS_THRESHOLD` if Stories don't feel distinct enough
4. **Expand negative context** - Add more patterns as misclassifications are observed

## Related Work

- **ADO-273** - EO tone variation (architecture source)
- **ADO-270** - Original Stories tone system (baseline)
- **Plan:** `docs/features/labels-tones-alignment/tone-variation-fix-plan.md`

# Handoff: ADO-273 EO Tone Variation Fix - Phase 1 Complete

**Date:** 2026-01-19
**Branch:** test
**Commits:** 0bdc462, 764434e, fed4f80
**Status:** Phase 1 CODE COMPLETE | VALIDATION PENDING

---

## Summary

Implemented the frame-based tone variation system for Executive Orders (Phase 1 of ADO-273/274/275/276). This replaces the broken level-based system that was hardcoded to alarm level 3.

---

## What Was Done

### New Files Created

| File | Purpose |
|------|---------|
| `scripts/shared/style-patterns-core.js` | 21 universal patterns + FNV-1a hash function |
| `scripts/shared/style-patterns-lint.js` | Instructional pattern checker (catches "Start with:" style problems) |
| `scripts/enrichment/eo-style-patterns.js` | Frame estimation, pool selection, deterministic variation |

### Files Modified

| File | Changes |
|------|---------|
| `scripts/executive-orders-tracker-supabase.js` | Store FR abstract in `description` field |
| `scripts/enrichment/prompts.js` | Add section-specific banned openers, update `buildEOPayload()` |
| `scripts/enrichment/enrich-executive-orders.js` | Wire up frame-based variation system |

---

## Architecture

### Frame Buckets (3)
- `alarmed` - Crisis mode, this is an attack (maps to levels 4-5)
- `critical` - Standard sardonic voice, default (maps to levels 2-3)
- `grudging_credit` - Credit where due (maps to levels 0-1)

### Category Pools (3)
- `miller` - Immigration/authoritarian EOs
- `donor` - Economy/energy/corporate EOs
- `default` - All other policy EOs

### Total Pools: 9
`{miller|donor|default}_{alarmed|critical|grudging_credit}`

### Pattern Count
- 21 core patterns (shared)
- 12 EO-specific patterns
- 33 total patterns available

### Key Features
1. **Frame estimation** - Pre-GPT frame selection from title + description + category
2. **Deterministic selection** - FNV-1a hash ensures same EO always gets same pattern
3. **Batch deduplication** - Tracks recently used patterns to avoid repetition within batch
4. **Post-gen validation** - Detects and repairs banned starter phrases
5. **Mismatch fuse** - Prompt allows GPT to override if frame estimate is wrong

---

## Prompt Version

`v4-ado273` - Update from `v3-ado271`

---

## Validation Results

All automated checks passed:
- Core patterns: 21 patterns with required fields
- Lint self-test: Catches instructional patterns, passes good patterns
- Frame estimation: Returns correct frames for test cases
- Variation selection: Deterministic with proper _meta
- Syntax check: No errors

---

## Next Steps

### Immediate (This Session or Next)
1. **Re-enrich sample of 30-50 EOs** with new prompt version
2. **Review output variety** - Check:
   - No repeated variation.id within batch
   - Top summary opener < 25%
   - 0 banned phrase starts in sections
   - Frame distribution (mostly critical, some alarmed, rare grudging_credit)

### If Validation Passes
3. **Re-enrich remaining ~170 EOs** with v4-ado273
4. **Push to test site** for visual review

### After EO Validation
5. **Phase 2 (ADO-274)** - Stories - Same architecture, different signals
6. **Phase 3 (ADO-275)** - SCOTUS - 0.5 session
7. **Phase 4 (ADO-276)** - Pardons - 0.5 session

---

## Test Command

To re-enrich a small batch:
```bash
node scripts/enrichment/enrich-executive-orders.js 30
```

---

## Files to Review

If something seems off:
1. `scripts/enrichment/eo-style-patterns.js` - Frame estimation logic
2. `scripts/shared/style-patterns-core.js` - Pattern definitions
3. `scripts/enrichment/prompts.js` - EO_ENRICHMENT_PROMPT banned openers section

---

## Code Review Findings (2026-01-19)

| Issue | Severity | Status |
|-------|----------|--------|
| FNV-1a hash bit-width handling | Critical | ✅ Fixed (764434e) |
| Input validation in selectVariation | Important | ✅ Fixed |
| Empty input warning in estimateFrame | Important | ✅ Fixed |
| Repair logic checking all sections | Important | ✅ Fixed |
| Pattern linter false positives | Low | WAI (different regex) |
| Pool size imbalance for grudging_credit | Low | WAI (rare frame) |
| Description field migration | Low | WAI (field exists) |

---

## Files to Promote to Main (after validation)

```
scripts/shared/style-patterns-core.js      (NEW)
scripts/shared/style-patterns-lint.js      (NEW)
scripts/enrichment/eo-style-patterns.js    (NEW)
scripts/executive-orders-tracker-supabase.js
scripts/enrichment/prompts.js
scripts/enrichment/enrich-executive-orders.js
```

---

## ADO Status

- **ADO-273** (EOs): Active - Code complete, validation pending
- **ADO-274** (Stories): New - Blocked by 273 validation
- **ADO-275** (SCOTUS): New - Blocked by 274
- **ADO-276** (Pardons): New - Blocked by 275

---

## Session Stats

- Files created: 3
- Files modified: 3
- Lines added: ~1060
- Commit: 0bdc462

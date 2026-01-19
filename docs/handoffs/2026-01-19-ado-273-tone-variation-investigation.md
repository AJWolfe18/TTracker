# Handoff: ADO-273 Tone Variation Investigation

**Date:** 2026-01-19
**Branch:** test
**ADO:** 273 (New), 271 (Resolved)
**Status:** Investigation only - no changes made

---

## Summary

ADO-271 EO pipeline fix is complete and working, but testing revealed a new issue: **tone variation isn't working**. All enriched EOs have nearly identical phrasing despite the variation injection system.

---

## Problem Discovered

Reviewed 20 recently enriched EOs and found:

### Repetitive Patterns

| Pattern | Occurrences |
|---------|-------------|
| "Beneath the surface..." opener | 5/20 |
| "What they don't say is..." opener | 4/20 |
| "This order is a blatant..." | 3/20 |
| "YOUR healthcare/paycheck/rights" | 12/20 |
| "Who benefits?" | 15/20 |
| "Trump's cronies/donors/allies" | 20/20 |

### Alarm Level Distribution (No Low Levels)

| Level | Count | Expected |
|-------|-------|----------|
| 5 | 8 | ~2-3 |
| 4 | 12 | ~5-6 |
| 3 | 0 | ~5-6 |
| 2 | 0 | ~3-4 |
| 1 | 0 | ~2-3 |
| 0 | 0 | ~1-2 |

### Summary Format (Zero Variation)
All 20 summaries start identically:
```
"Executive Order 143XX, signed on [date], aims to..."
```

---

## Investigation Areas

### 1. Variation Injection Mechanism
- File: `scripts/enrichment/eo-variation-pools.js`
- Check: Is `{variation_injection}` placeholder being replaced?
- Check: Is `buildVariationInjection()` returning meaningful content?

### 2. Variation Selection
- File: `scripts/enrichment/eo-variation-pools.js`
- Check: Is `selectVariation()` actually selecting different variations?
- Check: Are the pools diverse enough?

### 3. Prompt Dominance
- File: `scripts/enrichment/prompts.js`
- Check: Is `EO_ENRICHMENT_PROMPT` base text so strong it overrides variations?
- Check: Are banned openings being enforced but replaced with same alternatives?

### 4. Alarm Level Calibration
- Check: Is GPT ignoring the 0-5 scale guidance?
- Check: Are EOs genuinely all high-alarm, or is calibration off?

---

## Files to Investigate

```
scripts/enrichment/eo-variation-pools.js    # Variation selection logic
scripts/enrichment/enrich-executive-orders.js  # Where injection happens (lines 183-191)
scripts/enrichment/prompts.js               # EO_ENRICHMENT_PROMPT base text
```

---

## Next Session Prompt

```
Continue ADO-273: Fix EO tone variation.

Read: docs/handoffs/2026-01-19-ado-273-tone-variation-investigation.md

Investigation needed:
1. Read eo-variation-pools.js - understand how variations are selected
2. Check enrich-executive-orders.js lines 183-191 - verify injection works
3. Add logging to see what variation_injection text is being sent
4. Consider: Is the prompt structure too rigid?

Potential fixes:
- Make variation instructions more prominent in prompt
- Add more diverse opening patterns to pools
- Reduce base prompt's prescriptive phrasing
- Add explicit "vary your opening" instruction

DO NOT re-enrich until fix is validated.
```

---

## What Was Completed Today

1. **ADO-271 Resolved** - EO pipeline refactored (import + enrich separation)
2. **Commits:** dc8912d, c74096f, 4740c53
3. **50 EOs enriched** with v3-ado271 prompt
4. **169 EOs remaining** for enrichment (hold until variation fixed)

---

## Reference

- ADO-273: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/273
- ADO-271: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/271
- Variation pools: `scripts/enrichment/eo-variation-pools.js`
- EO prompt: `scripts/enrichment/prompts.js` (EO_ENRICHMENT_PROMPT)

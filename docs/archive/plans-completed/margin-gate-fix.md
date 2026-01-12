# Margin Gate Fix Plan (TTRC-331)

**Created:** 2025-12-26
**Status:** Ready for Implementation
**Related Tickets:**
- TTRC-329 (investigation) - CLOSED
- TTRC-331 (Phase 1+2: Tier B bypass + logging)
- TTRC-332 (Phase 3: duplicate-aware tie-break) - Backlog

---

## Problem Summary

Articles in the 0.88-0.90 embedding range are being blocked by the margin gate (requires margin >= 0.04) even when they have strong corroboration signals. This causes story fragmentation.

**Root Cause:** Tier A has a margin bypass with corroboration. Tier B does NOT.

### Evidence (from TTRC-329 investigation)

| Run | Articles | Near-Misses | False Negatives | All Blocked By |
|-----|----------|-------------|-----------------|----------------|
| 2025-12-24 | 31 | 11 | 2 | margin |
| 2025-12-26 | 58 | 17 | 5 | margin |
| **Total** | 89 | 28 | **7** | **margin (100%)** |

**Example Fragmentation:** EU visa ban story split into 4+ separate stories (16338, 16347, 16359, 16402)

---

## Solution Overview

### A) Behavior Fix (the actual bug)

1. **marginVacuous fix**: Single-candidate cases pass margin gate (no ambiguity to resolve)
2. **Tier B bypass**: Feature-flagged bypass for slug/entity>=2 corroboration

### B) Safety + Rollout Control

1. **Feature flag OFF by default**: `ENABLE_TIERB_MARGIN_BYPASS=false`
2. **Shadow logging with rate limit**: First 10 per run, module-scope counter

### C) Actionable Logging

1. Separate `margin_pass_raw` vs `tierB_margin_ok` (raw vs final)
2. `blocked_by` computed from booleans, uses RAW margin gate
3. `bypass_applied` boolean for easy filtering
4. Shadow mode fields: `tierBMarginBypass_would_fire`, `_via`

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Add Tier B margin bypass, improve logging |

---

## A) Behavior Fix Code

### A1. marginVacuous fix + pre-bypass state

```javascript
// Tier B margin gate: passes if meaningful margin OR vacuous (single candidate)
// IMPORTANT: Save pre-bypass state for logging/shadow mode
const tierBMarginOk_preBypass = hasMeaningfulMargin || marginVacuous;
let tierBMarginOk = tierBMarginOk_preBypass;  // Will be mutated by bypass
```

### A2. Compute wouldBypass BEFORE bypass mutation

```javascript
// MUST compute before bypass mutates tierBMarginOk
const wouldBypassVia = slugTok.passes ? 'slug' : (entityOverlap >= 2 ? 'entity' : null);
const wouldBypass = !tierBMarginOk_preBypass && wouldBypassVia && embedBest >= 0.88 && timeDiffHours <= 48 && passesGuardrail;
```

### A3. Tier B bypass (feature-flagged)

```javascript
let tierBMarginBypass = null;

if (
  !tierBMarginOk_preBypass &&                          // Use PRE-bypass state
  embedBest >= 0.88 &&
  timeDiffHours <= 48 &&                               // Stricter time (48h not 72h)
  passesGuardrail &&
  ENABLE_TIERB_MARGIN_BYPASS                           // Feature flag
) {
  if (slugTok.passes) {
    tierBMarginOk = true;
    tierBMarginBypass = 'slug';
  } else if (entityOverlap >= 2) {                     // Entity >= 2 (not 1)
    tierBMarginOk = true;
    tierBMarginBypass = 'entity';
  }
  // NO title-only bypass
}

// CRITICAL: Final attach STILL requires passesCorroboration
if (!isTierA && embedBest >= 0.88 && timeDiffHours <= 72 && tierBMarginOk && passesGuardrail && passesCorroboration) {
  // attach...
}
```

---

## B) Safety + Rollout Code

### B1. Feature flag default OFF

```javascript
const ENABLE_TIERB_MARGIN_BYPASS = process.env.ENABLE_TIERB_MARGIN_BYPASS === 'true';
```

### B2. Shadow log with working rate limit

```javascript
// COUNTER MUST BE OUTSIDE PER-ARTICLE LOOP (module scope or batch function scope)
let tierBBypassShadowCount = 0;
const TIERB_BYPASS_SHADOW_LIMIT = 10;

// Inside article processing (AFTER wouldBypass computed, before bypass mutation):
const marginIsBlocker = !tierBMarginOk_preBypass && !marginVacuous;

if (!ENABLE_TIERB_MARGIN_BYPASS && marginIsBlocker && wouldBypass &&
    tierBBypassShadowCount < TIERB_BYPASS_SHADOW_LIMIT) {
  tierBBypassShadowCount++;
  console.log(JSON.stringify({
    type: 'TIERB_BYPASS_SHADOW',
    article_id, story_id: best.story_id,
    embed_best: embedBest, margin,
    would_bypass_via: wouldBypassVia,
    shadow_count: tierBBypassShadowCount
  }));
}
```

---

## C) Actionable Logging

### C1. CROSS_RUN_NEAR_MISS additions

```javascript
{
  // Existing fields...

  // Margin diagnosis - SEPARATE raw vs final
  margin_pass_raw: hasMeaningfulMargin,                 // raw margin gate only (>= 0.04)
  tierB_margin_ok_preBypass: tierBMarginOk_preBypass,   // raw + vacuous (before bypass)
  tierB_margin_ok: tierBMarginOk,                       // final (includes bypass)
  margin_raw: margin,                                   // 6 decimal precision
  margin_vacuous: marginVacuous,
  tierBMarginBypass: tierBMarginBypass,                 // 'slug'|'entity'|null
  bypass_applied: tierBMarginBypass != null,            // boolean for easy filtering

  // blocked_by - uses RAW margin gate (shows true failures even if bypassed)
  blocked_by: buildBlockedBy({
    guardrail: passesGuardrail,
    time: timeDiffHours <= 72,
    embed: embedBest >= 0.88,
    corroboration: tierB_corroboration_pass,
    margin: tierBMarginOk_preBypass                     // RAW, not tierBMarginOk
  }),

  // Embed values (null if candidate_count < 2)
  embed_best: embedBest,
  embed_second: candidateCount >= 2 ? embedSecond : null,
  candidate_count: candidateCount,

  // Second candidate (null if doesn't exist)
  second_candidate_id: secondCandidate?.story_id ?? null,

  // Shadow mode
  tierBMarginBypass_would_fire: wouldBypass,
  tierBMarginBypass_would_fire_via: wouldBypassVia
}
```

### C2. Helper for blocked_by

```javascript
function buildBlockedBy(gates) {
  const blockers = [];
  const order = ['guardrail', 'time', 'embed', 'corroboration', 'margin'];
  for (const k of order) {
    if (!gates[k]) blockers.push(k);
  }
  return blockers;
}
```

---

## Critical Guardrail

**DON'T SCREW THIS UP:**

The bypass must not change corroboration semantics. This line is the guardrail:

```javascript
... && passesGuardrail && passesCorroboration
```

If someone later "refactors" and makes bypass imply corroboration, you'll get silent false positives.

---

## PR Description Notes

**Behavior change even with flag OFF:**

The marginVacuous fix changes behavior IMMEDIATELY (not gated by feature flag):
- **Before**: Single-candidate cases (candidate_count = 1) were blocked by margin gate
- **After**: Single-candidate cases pass margin gate (no ambiguity to resolve)

This is intentional. Call out in PR description.

---

## Nice-to-haves (CUT for speed)

- Deterministic blocked_by order (helpful but not required)
- Full policy_constants object (can infer from commit)
- Normal/bypass time limit logging (can infer from tierBMarginBypass + timeDiffHours)
- second_candidate_headline (id is enough)

---

## Code Structure

| Section | Lines | Current State |
|---------|-------|---------------|
| Tier A logic | 640-664 | Has margin bypass (entity >= 1, slug, title_token) |
| Tier B logic | 666-684 | NO margin bypass - uses `hasMeaningfulMargin` directly |
| Near-miss logging | 786-805 | Uses `tierB_primary_blocker` (string) |
| Shadow policy | 808+ | Exists for threshold testing |

**Bug location:** Line 671 - `const hasMeaningfulMargin = !marginVacuous && margin >= 0.04;`
**Problem:** Line 673 uses this directly without bypass logic

---

## Implementation Steps

1. [ ] Add constants near line 640:
   - `ENABLE_TIERB_MARGIN_BYPASS = process.env.ENABLE_TIERB_MARGIN_BYPASS === 'true'`
   - `TIERB_BYPASS_SHADOW_LIMIT = 10`
2. [ ] Add module-scope counter (outside article loop):
   - `let tierBBypassShadowCount = 0`
3. [ ] Add `buildBlockedBy()` helper function
4. [ ] At line 671 - marginVacuous fix with pre-bypass state:
   - `const tierBMarginOk_preBypass = hasMeaningfulMargin || marginVacuous`
   - `let tierBMarginOk = tierBMarginOk_preBypass`
5. [ ] Compute wouldBypass BEFORE bypass mutation (uses tierBMarginOk_preBypass)
6. [ ] Add Tier B bypass logic (feature-flagged, uses tierBMarginOk_preBypass)
7. [ ] Modify line 673: replace `hasMeaningfulMargin` with `tierBMarginOk`
8. [ ] Add TIERB_BYPASS_SHADOW logging with rate limit (uses wouldBypass)
9. [ ] Update CROSS_RUN_NEAR_MISS logging (lines 786-805):
   - `margin_pass_raw`, `tierB_margin_ok_preBypass`, `tierB_margin_ok`
   - `blocked_by` via `buildBlockedBy()` with tierBMarginOk_preBypass
   - `bypass_applied: tierBMarginBypass != null`
   - `second_candidate_id: secondCandidate?.story_id ?? null`
   - Shadow fields: `tierBMarginBypass_would_fire`, `_via`
10. [ ] Verify corroboration still required in attach block
11. [ ] Push to test branch
12. [ ] Run RSS workflow: `gh workflow run "RSS Tracker - TEST" --ref test`
13. [ ] Verify logs contain new fields
14. [ ] Update JIRA TTRC-331

---

## Validation Checklist

- [ ] marginVacuous fix works (single-candidate cases pass)
- [ ] Shadow log fires when margin blocks + bypass would have fired
- [ ] Shadow log rate-limited (max 10 per run)
- [ ] `blocked_by` uses raw margin gate (shows failures even if bypassed)
- [ ] `bypass_applied` correctly reflects bypass state
- [ ] Corroboration still required in final attach block
- [ ] Feature flag defaults to OFF

---

*Last updated: 2025-12-26*

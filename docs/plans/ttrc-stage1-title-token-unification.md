# TTRC: Stage 1 - Title Token Overlap Unification

**Status:** Ready to implement
**Priority:** High
**Risk:** Zero (behavior-neutral)

## Background

### The Problem
Tier B and guardrail use different title matching logic:
- **Tier B:** `getTitleTokenOverlap()` - counts shared meaningful words (5+ chars, not stopwords)
- **Guardrail:** `scoreResult.titleScore` - a weighted hybrid score component

This causes logical incoherence: an article can pass Tier B's `title_token` corroboration but fail guardrail's title check.

### Evidence
- 3 RSS runs analyzed, 27 near-misses total
- 1 case (boat strikes) blocked by guardrail despite having 4 shared title tokens
- 89% of near-misses were correctly blocked (system is working well overall)

### Why Stage This Fix
The fix has two parts:
1. **Refactor** (compute titleTokenOverlap once, log it) - zero risk
2. **Policy change** (make guardrail use titleTokenOverlap, raise threshold to >= 2) - needs data

Staging separates low-risk from higher-risk changes and gives us data to validate Stage 2.

---

## Stage 1 Scope

### What We're Doing
1. Add `getTitleTokenOverlapEnhanced()` helper (pattern-based acronyms, log-only)
2. Compute both legacy and enhanced overlaps once
3. Store in `scoreResult` for unified access
4. Add overlap fields to CROSS_RUN_OVERRIDE and CROSS_RUN_NEAR_MISS logs
5. Keep all decision logic unchanged (Tier B uses legacy >= 1, guardrail uses titleScore)

### What We're NOT Doing (Stage 2)
- Changing Tier B threshold (stays at >= 1)
- Changing guardrail to use titleTokenOverlap
- Raising threshold to >= 2
- Enabling margin bypass

---

## Implementation Details

### 1. Add Enhanced Overlap Helper

Add next to existing `getTitleTokenOverlap()` in `scripts/rss/hybrid-clustering.js`:

```javascript
// Stage 1: enhanced overlap (pattern-based acronyms), log-only
const ACRONYM_DENYLIST = new Set(['US', 'USA']);

function getTitleTokenOverlapEnhanced(a, b, stopwordsSet) {
  const tokens = (s) => (s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);

  const isAcronym = (raw) => {
    if (!raw) return false;
    if (raw.length < 3 || raw.length > 6) return false;
    if (!/^[A-Z]+$/.test(raw)) return false;
    return !ACRONYM_DENYLIST.has(raw);
  };

  const buildSets = (s) => {
    const regular = new Set();
    const acr = new Set();

    for (const raw of tokens(s)) {
      const lower = raw.toLowerCase();

      // regular tokens: match legacy intent (5+ chars, not stopword)
      if (lower.length >= 5 && !stopwordsSet.has(lower)) {
        regular.add(lower);
        continue;
      }

      // NEW: acronyms (ALLCAPS 3–6)
      if (isAcronym(raw)) {
        acr.add(lower); // store lowercase for matching
      }
    }

    return { regular, acr };
  };

  const A = buildSets(a);
  const B = buildSets(b);

  let regularOverlap = 0;
  for (const t of A.regular) if (B.regular.has(t)) regularOverlap++;

  let acronymOverlap = 0;
  for (const t of A.acr) if (B.acr.has(t)) acronymOverlap++;

  return {
    overlap: regularOverlap + acronymOverlap,
    regularOverlap,
    acronymOverlap,
  };
}
```

### 2. Compute Both Overlaps Once

Where Tier B currently computes overlap (~line 887):

```javascript
// BEFORE
const titleTokenOverlap = getTitleTokenOverlap(article.title, storyTitle);

// AFTER
const titleTokenOverlap_legacy = getTitleTokenOverlap(article.title, storyTitle);
const enhanced = getTitleTokenOverlapEnhanced(article.title, storyTitle, TITLE_STOPWORDS);

// Store for unified access
scoreResult.titleTokenOverlap = titleTokenOverlap_legacy;
scoreResult.titleTokenOverlap_enhanced = enhanced.overlap;
scoreResult.titleTokenOverlap_enhanced_regular = enhanced.regularOverlap;
scoreResult.titleTokenOverlap_enhanced_acronym = enhanced.acronymOverlap;
```

### 3. Tier B Decision (UNCHANGED)

```javascript
// Uses legacy, behavior-identical
if (scoreResult.titleTokenOverlap >= 1) {
  isTierB = true;
  corroboration = 'title_token';
}
```

### 4. Guardrail (UNCHANGED)

Still uses `scoreResult.titleScore >= GUARDRAIL.minTitle`. No changes in Stage 1.

### 5. Add Fields to Logs

**CROSS_RUN_OVERRIDE (~line 996-1014):**
```javascript
console.log(JSON.stringify({
  type: 'CROSS_RUN_OVERRIDE',
  // ...existing fields...
  title_token_overlap: scoreResult.titleTokenOverlap,
  title_token_overlap_enhanced: scoreResult.titleTokenOverlap_enhanced,
  acronym_overlap_enhanced: scoreResult.titleTokenOverlap_enhanced_acronym,
  regular_overlap_enhanced: scoreResult.titleTokenOverlap_enhanced_regular,
  title_token_threshold: 1,
}));
```

**CROSS_RUN_NEAR_MISS (~line 1090-1128):**
Add the same fields.

---

## Validation

### After 1-2 Runs

Pull distribution of title-token overrides:
```bash
# Count legacy overlap values
cat logs.jsonl \
  | jq -r 'select(.type=="CROSS_RUN_OVERRIDE" and .corroboration=="title_token") | .title_token_overlap' \
  | sort -n | uniq -c

# Compare legacy vs enhanced
cat logs.jsonl \
  | jq -r 'select(.type=="CROSS_RUN_OVERRIDE" and .corroboration=="title_token") | "\(.title_token_overlap)\t\(.title_token_overlap_enhanced)\t\(.acronym_overlap_enhanced)\t\(.regular_overlap_enhanced)"'
```

### Questions to Answer
1. How many overrides rely on legacy overlap == 1?
2. How many would change under enhanced acronym counting?
3. How many are acronym-only overlaps?
4. Are those cases good merges? (sample 5-10)

---

## Stage 2 Decision Thresholds (Pre-Defined)

| If legacy overlap == 1 is... | Action |
|------------------------------|--------|
| < 10% of title_token overrides | Raise to >= 2 (low risk) |
| 10-30%, samples look sketchy | Raise to >= 2 (acceptable) |
| >= 30%, many are clearly correct | Keep >= 1, or require alternate corroborator |

---

## Stage 2 Preview (After Data)

If data supports, Stage 2 would:
1. **A)** Raise threshold from >= 1 to >= 2
2. **B)** Switch from legacy to enhanced acronym counting
3. **C)** Add refinement logic (require regular + acronym mix, or acronym-only needs embed >= 0.92)
4. **D)** Add titleTokenOverlap >= 2 check to guardrail

Each lever is independent and attributable.

---

## Files to Modify

1. `scripts/rss/hybrid-clustering.js`
   - Add `getTitleTokenOverlapEnhanced()` function
   - Add `ACRONYM_DENYLIST` constant
   - Compute both overlaps where Tier B does overlap calculation
   - Store in scoreResult
   - Add fields to CROSS_RUN_OVERRIDE log
   - Add fields to CROSS_RUN_NEAR_MISS log

---

## Success Criteria

- [ ] Both overlaps computed once, stored in scoreResult
- [ ] Tier B decisions unchanged (uses legacy >= 1)
- [ ] Guardrail unchanged (uses titleScore)
- [ ] CROSS_RUN_OVERRIDE logs include all 4 new fields
- [ ] CROSS_RUN_NEAR_MISS logs include all 4 new fields
- [ ] Run RSS, verify logs contain expected fields
- [ ] No change in merge behavior (compare to baseline)

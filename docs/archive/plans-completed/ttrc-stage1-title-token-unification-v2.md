# Plan: Stage 1 Title Token Unification

**Status:** Ready to implement
**File:** `scripts/rss/hybrid-clustering.js`
**Risk:** Zero (behavior-neutral, logging only)

---

## Summary

Add enhanced title token overlap computation with pattern-based acronym detection, log to CROSS_RUN_OVERRIDE and CROSS_RUN_NEAR_MISS for Stage 2 analysis. No decision logic changes.

---

## Key Design Decisions (from review)

1. **Enhanced function operates on RAW tokens** - `isAcronym(raw)` checks before lowercasing, so "DOJ" is detected correctly
2. **Use helper function** - `computeTitleTokenOverlaps()` called from both OVERRIDE and NEAR_MISS paths (avoids drift)
3. **5 new log fields** - legacy, enhanced, enhanced_regular, enhanced_acronym, threshold
4. **No matched token lists** - Keep logs concise
5. **Log correctness verified** - `targetStory` is selected BEFORE overlap computation (line 828→839→887), so overlaps are for the winner not "last candidate"
6. **Enhanced < Legacy is expected** - Pattern detection (ALLCAPS only) may find fewer than allowlist. The delta is useful Stage 2 signal.
7. **Use constant for threshold** - Define `TITLE_TOKEN_THRESHOLD = 1` for easy Stage 2 changes
8. **U.S. edge case accepted** - `U.S.` becomes `U` and `S`, won't match. Fine for Stage 1 log-only.
9. **enhanced_acronym = 3-4 char ALLCAPS only** - Tokens with len >= 5 (SCOTUS, UNHCR, NHTSA) go to `regular` first and skip acronym check. Stage 2 analysis should not assume enhanced_acronym represents all acronyms.
10. **TITLE_STOPWORDS initialization order verified** - Defined at line 118, new functions after 144, first call at 887. Order is correct.

---

## Implementation Steps

### Step 1: Add Constants and Enhanced Function (after line 144)

```javascript
// Stage 1: Title token threshold constant (for easy Stage 2 changes)
const TITLE_TOKEN_THRESHOLD = 1;

// Stage 1: Acronyms to exclude from pattern detection (too common/ambiguous)
const ACRONYM_DENYLIST = new Set(['US', 'USA']);

/**
 * Stage 1: Enhanced overlap with pattern-based acronym detection (log-only)
 * Operates on RAW tokens before lowercasing so "DOJ" is detected
 */
function getTitleTokenOverlapEnhanced(a, b, stopwordsSet) {
  const tokens = (s) => (s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);

  const isAcronym = (raw) => {
    if (!raw) return false;
    if (raw.length < 3 || raw.length > 6) return false;
    if (!/^[A-Z]+$/.test(raw)) return false;  // Must be ALL CAPS
    return !ACRONYM_DENYLIST.has(raw);
  };

  const buildSets = (s) => {
    const regular = new Set();
    const acr = new Set();

    for (const raw of tokens(s)) {
      const lower = raw.toLowerCase();

      // regular tokens: 5+ chars, not stopword
      if (lower.length >= 5 && !stopwordsSet.has(lower)) {
        regular.add(lower);
        continue;
      }

      // pattern-detected acronyms (ALLCAPS 3-6)
      if (isAcronym(raw)) {
        acr.add(lower);  // store lowercase for matching
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

/**
 * Stage 1: Unified helper for computing both legacy and enhanced overlaps
 * Call from both OVERRIDE and NEAR_MISS paths to avoid drift
 */
function computeTitleTokenOverlaps(articleTitle, storyTitle) {
  const legacy = getTitleTokenOverlap(articleTitle, storyTitle);
  const enhanced = getTitleTokenOverlapEnhanced(articleTitle, storyTitle, TITLE_STOPWORDS);
  return {
    legacy,
    enhanced: enhanced.overlap,
    enhanced_regular: enhanced.regularOverlap,
    enhanced_acronym: enhanced.acronymOverlap
  };
}
```

### Step 2: Use Helper at Line 887 (main OVERRIDE path)

Replace:
```javascript
const titleTokenOverlap = getTitleTokenOverlap(article.title, storyTitle);
```

With:
```javascript
const titleOverlaps = computeTitleTokenOverlaps(article.title, storyTitle);
const titleTokenOverlap = titleOverlaps.legacy;  // Used by Tier B decision (unchanged)
```

### Step 3: Update CROSS_RUN_OVERRIDE Log (lines 996-1014)

Add after `total: attachScore`:
```javascript
title_token_overlap: titleOverlaps.legacy,
title_token_overlap_enhanced: titleOverlaps.enhanced,
title_token_overlap_enhanced_regular: titleOverlaps.enhanced_regular,
title_token_overlap_enhanced_acronym: titleOverlaps.enhanced_acronym,
title_token_threshold: TITLE_TOKEN_THRESHOLD,
```

### Step 4: Use Helper at Line 1048 (NEAR_MISS path)

Replace:
```javascript
const titleTokenOverlapNM = getTitleTokenOverlap(article.title, storyTitleNM);
```

With:
```javascript
const titleOverlapsNM = computeTitleTokenOverlaps(article.title, storyTitleNM);
const titleTokenOverlapNM = titleOverlapsNM.legacy;  // Keep for existing corroboration_detail
```

### Step 5: Update CROSS_RUN_NEAR_MISS Log (lines 1090-1128)

Add these fields:
```javascript
title_token_overlap: titleOverlapsNM.legacy,
title_token_overlap_enhanced: titleOverlapsNM.enhanced,
title_token_overlap_enhanced_regular: titleOverlapsNM.enhanced_regular,
title_token_overlap_enhanced_acronym: titleOverlapsNM.enhanced_acronym,
title_token_threshold: TITLE_TOKEN_THRESHOLD,
```

---

## Files to Modify

**`scripts/rss/hybrid-clustering.js`**
- Add `TITLE_TOKEN_THRESHOLD = 1` constant (after line 144)
- Add `ACRONYM_DENYLIST` constant
- Add `getTitleTokenOverlapEnhanced()` function
- Add `computeTitleTokenOverlaps()` helper
- Update line 887 to use helper
- Add 5 fields to CROSS_RUN_OVERRIDE log
- Update line 1048 to use helper
- Add 5 fields to CROSS_RUN_NEAR_MISS log

---

## Validation Checklist (Behavior-Neutral Proof)

**Code checks:**
- [ ] Helper function called at both paths (lines 887 and 1048)
- [ ] Tier B decisions unchanged (uses `titleTokenOverlap` aka legacy >= TITLE_TOKEN_THRESHOLD)
- [ ] Guardrail unchanged (uses `titleScore`)
- [ ] CROSS_RUN_OVERRIDE logs include 5 new fields
- [ ] CROSS_RUN_NEAR_MISS logs include 5 new fields

**Run validation (more precise than "merge count"):**
- [ ] Run RSS: `gh workflow run "RSS Tracker - TEST" --ref test`
- [ ] Grep logs for new fields: `"title_token_overlap"`
- [ ] Verify `story_id` chosen for each article is identical pre/post
- [ ] Verify decision type counts identical (attach/new story)
- [ ] Only log payload changes (no behavior change)

---

## Post-Implementation: Stage 2 Data Queries

```bash
# Distribution of legacy overlap for title_token overrides
cat logs.jsonl | jq -r 'select(.type=="CROSS_RUN_OVERRIDE" and .corroboration=="title_token") | .title_token_overlap' | sort -n | uniq -c

# Compare legacy vs enhanced (enhanced may be LOWER - that's expected!)
cat logs.jsonl | jq -r 'select(.type=="CROSS_RUN_OVERRIDE") | "\(.title_token_overlap)\t\(.title_token_overlap_enhanced)\t\(.title_token_overlap_enhanced_acronym)"'

# Find cases where enhanced < legacy (indicates lowercase acronym sources)
cat logs.jsonl | jq 'select(.type=="CROSS_RUN_OVERRIDE" and .title_token_overlap_enhanced < .title_token_overlap)'
```

**Expected behavior (NOT bugs):**
- `enhanced < legacy`: Sources using lowercase acronyms ("doj" not "DOJ")
- `enhanced_acronym = 0` even with acronyms: RSS lowercased upstream
- `enhanced_acronym` doesn't include SCOTUS/UNHCR/NHTSA: 5+ char tokens go to `regular` (by design)

**Stage 2 decision points:**
- If legacy == 1 is <10% of overrides → safe to raise threshold to >= 2
- If enhanced consistently finds more than legacy → pattern detection working well

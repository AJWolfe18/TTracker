# Plan: TTRC-315 - Fix Clustering Guardrail with Slug Token Similarity

**Status:** Ready for implementation
**Created:** 2025-12-18
**Related:** TTRC-302 (topic slugs), TTRC-311 (guardrail)

---

## Problem Statement

Articles with 0.87-0.90 embedding similarity aren't clustering.

**Root Cause:** TTRC-311 guardrail requires a "concrete reason" to cluster, but:
- Slug match fails (slugs are too specific/unique)
- Entity overlap fails (different entity focus)
- Title match fails (different phrasings)

**Evidence:** Venezuela oil tanker articles have 0.90 embedding similarity but are in 3 separate stories.

---

## Solution: Tiered Guardrail with Slug Token Similarity

### Key Safeguards

1. **Token overlap alone is too permissive** - need extra gates
2. **Tiered embedding requirements** - only allow slug-token at high embedding
3. **Very high embedding override** - 0.90+ is "concrete enough" on its own
4. **Log merge reasons** - for analysis and tuning

### New Constants (scoring.js)

```javascript
const VERY_HIGH_EMBEDDING = 0.90;  // Auto-pass guardrail
const TOKEN_OVERLAP_EMBED_MIN = 0.85;  // Min embedding for slug-token to count

const STOP_TOKENS = new Set(['TRUMP', 'WHITE', 'HOUSE', 'SAYS', 'NEWS', 'UPDATE']);

// Already exists: EVENT_WORD_MAP for verb normalization
```

### Slug Token Similarity Function (scoring.js)

```javascript
/**
 * Calculate slug token similarity with strict requirements
 * @returns {object} { passes, overlapCoeff, overlapCount, hasEventOverlap }
 */
function slugTokenSimilarity(articleSlug, storySlugs, options = {}) {
  const {
    minTokenLen = 3,
    minTokens = 3,
    minOverlapCount = 2,
    minOverlapCoeff = 0.60,
    requireEventTokenOverlap = true,
  } = options;

  if (!articleSlug || !storySlugs?.length) {
    return { passes: false, overlapCoeff: 0, overlapCount: 0, hasEventOverlap: false };
  }

  // Tokenize and normalize
  const normalize = (slug) => {
    return slug.split('-')
      .filter(t => t.length >= minTokenLen)
      .filter(t => !STOP_TOKENS.has(t))
      .map(t => EVENT_WORD_MAP[t] || t);  // Normalize verbs
  };

  const articleTokens = new Set(normalize(articleSlug));
  if (articleTokens.size < minTokens) {
    return { passes: false, overlapCoeff: 0, overlapCount: 0, hasEventOverlap: false };
  }

  let best = { passes: false, overlapCoeff: 0, overlapCount: 0, hasEventOverlap: false };

  for (const storySlug of storySlugs) {
    const storyTokens = new Set(normalize(storySlug));
    if (storyTokens.size < minTokens) continue;

    const intersection = [...articleTokens].filter(t => storyTokens.has(t));
    const overlapCount = intersection.length;
    const minSize = Math.min(articleTokens.size, storyTokens.size);
    const overlapCoeff = minSize > 0 ? overlapCount / minSize : 0;

    // Check if any overlap token is an "event word"
    const hasEventOverlap = intersection.some(t =>
      Object.values(EVENT_WORD_MAP).includes(t) || EVENT_WORD_MAP[t]
    );

    const passes = overlapCount >= minOverlapCount &&
                   overlapCoeff >= minOverlapCoeff &&
                   (!requireEventTokenOverlap || hasEventOverlap);

    if (overlapCoeff > best.overlapCoeff) {
      best = { passes, overlapCoeff, overlapCount, hasEventOverlap };
    }
  }

  return best;
}
```

### Updated Guardrail Logic (hybrid-clustering.js)

```javascript
// Thresholds
const VERY_HIGH_EMBEDDING = 0.90;
const TOKEN_OVERLAP_EMBED_MIN = 0.85;

// Calculate slug token similarity
const slugToken = slugTokenSimilarity(article.topic_slug, story.topic_slugs);

// Slug token overlap only valid at high embedding
const hasSlugTokenOverlap =
  scoreResult.embeddingScore >= TOKEN_OVERLAP_EMBED_MIN &&
  slugToken.passes;

// Final guardrail: tiered logic
const passesGuardrail = hasDecentEmbedding && (
  scoreResult.embeddingScore >= VERY_HIGH_EMBEDDING ||  // Very high = auto-pass
  slugsMatch ||
  hasSlugTokenOverlap ||
  hasNonStopwordEntityOverlap ||
  hasTitleMatch
);

// Log the reason for merge analysis
const mergeReasons = [];
if (scoreResult.embeddingScore >= VERY_HIGH_EMBEDDING) mergeReasons.push('very_high_embedding');
if (slugsMatch) mergeReasons.push('exact_slug_match');
if (hasSlugTokenOverlap) mergeReasons.push('slug_token_overlap');
if (hasNonStopwordEntityOverlap) mergeReasons.push('entity_overlap');
if (hasTitleMatch) mergeReasons.push('title_match');

console.log(`[cluster-reasons] ${mergeReasons.join(', ') || 'BLOCKED'}`);
```

---

## Implementation Steps

1. **Add STOP_TOKENS constant to scoring.js**
2. **Add slugTokenSimilarity function to scoring.js** (export it)
3. **Update guardrail in hybrid-clustering.js** with tiered logic
4. **Test on Venezuela articles** - dry-run scoring
5. **Recluster last 7-14 days** - measure results

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/rss/scoring.js` | Add STOP_TOKENS, slugTokenSimilarity(), export |
| `scripts/rss/hybrid-clustering.js` | Add tiered guardrail logic, merge reason logging |

---

## Success Metrics (Measure, Don't Commit)

Test on 7-14 day recluster:
- Multi-article story rate (currently 2%)
- Median articles per story
- Sample 50 merges for false positives
- Merge reason distribution

Then decide if thresholds need tuning.

---

## Diagnostic Evidence

### Venezuela Oil Tanker - Should Cluster But Didn't

| Article Slug | Story | Embedding Sim |
|--------------|-------|---------------|
| TRUMP-SEIZURE-OIL-TANKER | 15542 | 1.00 (self) |
| WHITE-HOUSE-SEIZES-OIL-TANKERS | 15531 | 0.90 |
| OIL-TANKER-SEIZED-VENEZUELA | 15536 | 0.87 |

All within 1.5 hours, 0.87-0.90 similarity, but in 3 different stories.

### After Fix

With normalized tokens:
- SEIZE, TANKER vs SEIZE, TANKER = 100% overlap
- hasEventOverlap = true (SEIZE)
- embeddingScore = 0.90 >= 0.85

**Result: passes via `very_high_embedding` AND `slug_token_overlap`**

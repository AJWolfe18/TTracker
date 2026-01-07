# Story Clustering Quality Analysis

**Date:** 2025-12-10
**Epic:** TTRC-250 (RSS v2 System)
**Status:** Analysis Complete - Ready for Review
**Priority:** High - Clustering producing bad results

---

## Executive Summary

After re-clustering 1,830 articles, manual review of the exported CSV revealed **significant quality issues**. Many multi-article stories contain unrelated articles that were incorrectly grouped together. The root cause is a combination of:

1. **Threshold too low** (0.62) - allowing marginal matches
2. **Entity weight too high** (25%) - generic entities like `US-TRUMP` boost unrelated articles
3. **Embedding similarity is noisy** - all Trump political news has high semantic similarity

**Business Impact:** Stories are polluted with unrelated articles, reducing trust and usability of the story view.

---

## Current Clustering Logic

### File: `scripts/rss/scoring.js`

### Scoring Weights
```javascript
const WEIGHTS = {
  embedding: 0.40,      // Semantic similarity (cosine)
  entities: 0.25,       // Entity overlap (Jaccard)
  title: 0.15,          // Title TF-IDF similarity
  time: 0.10,           // Time decay (72h window)
  keyphrases: 0.05,     // Keyphrase overlap
  geography: 0.05,      // Location match
};
```

### Threshold Configuration
```javascript
// From getThreshold() function
Wire services (AP, Reuters): 0.60
Opinion pieces: 0.68
Policy documents: 0.64
Default: 0.62
```

### Cosine Similarity Normalization
```javascript
// Line 181 of scoring.js
const similarity = dotProduct / (normA * normB);
return (similarity + 1) / 2;  // Normalize -1..1 to 0..1
```

**Note:** This normalization was intentionally implemented based on the theoretical cosine range of -1 to +1. However, OpenAI text embeddings (`text-embedding-ada-002`) in practice only range from ~0.5 to 1.0 because text vectors are sparse and positive.

---

## Problems Identified

### Problem 1: Generic Entity Over-Weighting

**Example - Story 3081 (9 articles, all unrelated):**

| Article Title | Source | Similarity | Belongs Together? |
|---------------|--------|------------|-------------------|
| Trump's Tylenol Advice and the Politics of 'Tough It Out' | NYT | 0.83 | Primary |
| Food Stamp Cuts Expose Trump's Strategy | NYT | 0.69 | ❌ No |
| When the Trump Guardrails Fall | NYT | 0.68 | ❌ No |
| The Trump Split Screen: A Peacemaker Abroad... | NYT | 0.67 | ❌ No |
| Builders Find Hardship in Trump's Tariffs | NYT | 0.67 | ❌ No |
| Trump's Team Offers to Keep Donors Incognito | NYT | 0.67 | ❌ No |
| Trump Administration Decimates Birth Control Office | NYT | 0.66 | ❌ No |
| Trump Considers Overhaul of Refugee System | NYT | 0.65 | ❌ No |
| Trump's Retribution Revival Tour | NYT | 0.64 | ❌ No |

**Root Cause:** All articles share the entity `US-TRUMP`, which contributes 25% of the score. Combined with moderate embedding similarity (all political news), they exceed the 0.62 threshold.

### Problem 2: Threshold Too Low

**Similarity Score Distribution (from article_story table):**

| Score Range | Count | Quality |
|-------------|-------|---------|
| 1.00 | ~1300 | Primary articles (created story) |
| 0.90-0.99 | ~10 | High confidence - likely correct |
| 0.80-0.89 | ~30 | Good confidence - mostly correct |
| 0.70-0.79 | ~100 | Mixed quality - some errors |
| 0.62-0.69 | ~300 | Just above threshold - many errors |

Most clustered articles are in the 0.62-0.79 range, which includes many false positives.

### Problem 3: Embedding Similarity Noise

All Trump-related political news has high embedding similarity (~0.75-0.85) because:
- Same topic domain (US politics)
- Same key figure (Trump)
- Similar vocabulary and framing

This means embedding similarity alone can't distinguish between:
- "Trump's Tylenol advice" (health policy)
- "Trump's tariff policy" (trade)
- "Trump's refugee policy" (immigration)

---

## Good Clustering Examples

Not all clusters are bad. Some work well:

**Story 3128 - Gaza/Netanyahu (5 articles):**
| Article Title | Source | Similarity |
|---------------|--------|------------|
| Trump Believes 'We Have a Deal' on Gaza | NYT | 1.00 |
| Trump urges Israeli president to pardon Netanyahu | NY Post | 0.71 |
| Trump calls for Netanyahu pardon | Fox News | 0.68 |
| Trump's first term defined by staunch support for Israel | Politico | 0.67 |
| Trump and Bibi | Economist | 0.65 |

**Why this works:** All articles are about the same specific topic (Trump-Netanyahu-Israel relationship).

**Story 3188 - Epstein Files (4 articles):**
| Article Title | Source | Similarity |
|---------------|--------|------------|
| Epstein files: New batch... | AP | 1.00 |
| Familiar names revealed in Epstein files | NBC | 0.88 |
| Epstein files reveal... | NPR | 0.76 |
| Documents released... | WaPo | 0.74 |

**Why this works:** Specific event (`EVT-EPSTEIN-FILES`) with unique vocabulary.

---

## Proposed Fixes

### Option A: Quick Fix (1-2 hours)
1. **Raise threshold:** 0.62 → 0.78
2. **Reduce entity weight:** 25% → 10%
3. **Increase title weight:** 15% → 30%

**New weights:**
```javascript
const WEIGHTS = {
  embedding: 0.40,      // Keep at 40%
  entities: 0.10,       // Reduce from 25%
  title: 0.30,          // Increase from 15%
  time: 0.10,           // Keep at 10%
  keyphrases: 0.05,     // Keep at 5%
  geography: 0.05,      // Keep at 5%
};
```

**Pros:** Fast, no new data needed
**Cons:** May still cluster some unrelated articles, may miss valid clusters

### Option B: Entity Stopwords (2-3 hours)
Add a blocklist for generic entities in scoring:

```javascript
const ENTITY_STOPWORDS = new Set([
  'US-TRUMP',
  'ORG-WHITE-HOUSE',
  'ORG-GOP',
  'ORG-DEM',
  'ORG-CONGRESS',
  'LOC-WASHINGTON',
]);

// In calculateEntityScore():
const filteredEntities = articleEntities.filter(e => !ENTITY_STOPWORDS.has(e.id));
```

**Pros:** Targeted fix, preserves specific entity signal
**Cons:** Requires maintenance as new generic entities appear

### Option C: Topic Extraction (1-2 days)
Extract canonical topic/event slug during enrichment:

```
Prompt: "What specific event is this article about?
Return a slug like: 'hegseth-confirmation' or 'gaza-ceasefire'"
```

Add as new scoring signal (25% weight).

**Pros:** Most accurate long-term solution
**Cons:** API cost (~$0.001/article), requires backfill

### Option D: Disable Clustering (30 min)
Every article creates its own story. Re-enable when logic is fixed.

**Pros:** No bad clusters, simple
**Cons:** Lose multi-source story value

---

## Recommendation

**Start with Option A (Quick Fix):**
1. Raise threshold to 0.78
2. Reduce entity weight to 10%
3. Increase title weight to 30%
4. Re-cluster and evaluate

**If still problematic, add Option B (Entity Stopwords)**

**Plan Option C (Topic Extraction) for future sprint**

---

## Files Involved

| File | Purpose |
|------|---------|
| `scripts/rss/scoring.js` | Hybrid scoring weights and thresholds |
| `scripts/rss/hybrid-clustering.js` | Main clustering orchestration |
| `scripts/rss/candidate-generation.js` | Finding candidate stories to compare |
| `scripts/lib/entity-normalization.js` | Entity ID normalization (potential stopwords location) |

---

## Testing Artifacts

| File | Description |
|------|-------------|
| `exports/clustering-review-2025-12-10.csv` | One article per row, 336 rows, 141 multi-article stories |
| `exports/clustering-golden-set-2025-12-10.csv` | One story per row with all article titles |
| `scripts/export-clustering-review.mjs` | Export script for review format |

---

## Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Multi-article stories | 141 | ~50-80 (higher quality) |
| Avg articles/story | 2.4 | 2-3 (when actually related) |
| False positive rate | ~40-50% (estimated) | <10% |
| Threshold | 0.62 | 0.78+ |

---

## Next Steps

1. [ ] Review this document
2. [ ] Decide on fix approach (A, B, C, or D)
3. [ ] Implement selected fix
4. [ ] Re-cluster all articles
5. [ ] Export new golden set for validation
6. [ ] Compare before/after quality

---

**Created:** 2025-12-10
**Author:** Claude Code
**For:** Josh (PM)

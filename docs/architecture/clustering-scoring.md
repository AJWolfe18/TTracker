# Story Clustering & Scoring System

## Overview

TrumpyTracker uses a **hybrid scoring system** to cluster related articles into stories. The system combines multiple signals (embeddings, entities, title similarity, etc.) with configurable weights and thresholds.

**Philosophy:** Precision over recall - prefer 2 separate similar stories over 1 combined unrelated story.

---

## Scoring Components

### Weight Configuration

```javascript
// scripts/rss/scoring.js
const WEIGHTS = {
  embedding: 0.45,    // Semantic similarity (primary signal)
  entities: 0.12,     // Entity overlap (refinement only)
  title: 0.25,        // Title TF-IDF similarity
  time: 0.10,         // Time decay (72h window)
  keyphrases: 0.00,   // Disabled (see TTRC-305)
  geography: 0.08,    // Location match
};
// Mental model: Embeddings + title carry the decision; entities refine.
```

### Component Details

| Component | Weight | Scale | Description |
|-----------|--------|-------|-------------|
| **Embedding** | 45% | 0-1 | Cosine similarity of OpenAI embeddings. Captures semantic meaning. |
| **Title** | 25% | 0-1 | TF-IDF cosine similarity of headlines. Strong signal for same event. |
| **Entities** | 12% | 0-1 | Jaccard similarity of entity IDs (with stopwords filtered). |
| **Time** | 10% | 0-1 | Linear decay over 72h. Same-day = 1.0, 72h = 0.0. |
| **Geography** | 8% | 0-1 | Fraction of matching location fields (country, state, city). |
| **Keyphrases** | 0% | - | Disabled. See TTRC-305 for fix. |

---

## Entity Stopwords

Generic entities that appear in 80%+ of articles provide no clustering signal. These contribute **0** to entity similarity:

```javascript
// scripts/rss/scoring.js
const ENTITY_STOPWORDS = new Set([
  'US-TRUMP',
  'US-BIDEN',
  'LOC-USA',
  'ORG-WHITE-HOUSE',
  'ORG-DEM',
  'ORG-GOP',
  'ORG-CONGRESS',
  'ORG-SENATE',
  'ORG-HOUSE',
  'ORG-SUPREME-COURT',
  'ORG-DOJ',
  'ORG-FBI',
  'LOC-WASHINGTON',
]);
```

**Important:** Stopwords only affect scoring, not storage. Entities are still stored in `articles.entities` and `stories.top_entities` for display/analytics.

### Future: Frequency-Based Weighting (TTRC-304)

Automatic downweighting based on document frequency:
- `>20%` frequency → weight 0
- `10-20%` → weight 0.25x
- `5-10%` → weight 0.5x
- `≤5%` → full weight

---

## Thresholds

### Attach Thresholds by Content Type

```javascript
// scripts/rss/scoring.js - getThreshold()
Wire services (AP, Reuters): 0.68
Opinion pieces: 0.76
Policy documents: 0.72
Default: 0.70
```

**Rationale:** Scores in the 0.62-0.69 range had ~40-50% false positive rate. Raising to 0.70+ eliminated most bad clusters.

---

## Hard Guardrail

Even when the hybrid score crosses the threshold, we require a **concrete reason** to cluster:

```javascript
// scripts/rss/hybrid-clustering.js
const hasNonStopwordEntityOverlap = candidate.nonStopwordEntityOverlapCount > 0;
const hasDecentEmbedding = candidate.embeddingScore >= 0.60;
const hasTitleMatch = candidate.titleScore >= 0.50;

const passesGuardrail =
  hasDecentEmbedding &&
  (hasNonStopwordEntityOverlap || hasTitleMatch);

if (bestScore >= threshold && passesGuardrail) {
  // ATTACH to existing story
} else {
  // CREATE new story
}
```

**Why this matters:**
- Prevents "Trump blob" clusters where unrelated political news gets grouped
- Requires either a specific entity match (not US-TRUMP) OR a title match
- Safety net for precision-first approach

### Tuning the Guardrail

The 0.60/0.50 values are tunables. If you see issues:

1. Check `[cluster-guardrail-block]` logs for blocked clusters
2. Review if blocks were correct (false positive prevention) or wrong (breaking good clusters)
3. Adjust thresholds as needed

---

## Candidate Generation

Before scoring, we find candidate stories to compare against using **OR-blocking**:

1. **Time Block** - Stories updated in last 72 hours
2. **Entity Block** - Stories with overlapping `top_entities` (GIN index)
3. **ANN Block** - Top-K nearest neighbors by embedding (HNSW index)

Combined candidates are deduplicated and limited to 200.

---

## Debugging Clustering Issues

### Score Breakdown Logging

For debugging specific stories, scoring.js has a debug hook:

```javascript
if (story.id === TARGET_STORY_ID) {
  console.log(`[scoring] Story #${story.id} breakdown:`, {
    embedding: embeddingScore,
    entity: entityScore,
    title: titleScore,
    time: timeScore,
    total: totalScore,
    threshold,
  });
}
```

### Guardrail Block Logging

When the guardrail blocks a would-be cluster:

```javascript
console.log('[cluster-guardrail-block]', {
  articleId,
  storyId: candidate.storyId,
  embeddingScore,
  titleScore,
  nonStopwordEntityOverlapCount,
  totalScore,
  threshold,
});
```

### Analysis Scripts

- `scripts/analyze-cluster-scores.mjs` - Score breakdown for all clusters
- `scripts/export-clustering-review.mjs` - Export clusters as CSV for manual review
- `scripts/recluster-all.mjs` - Re-run clustering with current logic

---

## Common Issues & Fixes

### "Trump Blob" Clusters

**Symptom:** 5+ unrelated articles grouped because they all mention Trump

**Root Cause:** Generic entity (US-TRUMP) + semantic similarity of political news

**Fix:**
1. Entity stopwords filter generic entities
2. Reduced entity weight (25% → 12%)
3. Hard guardrail requires specific entity OR title match

### Good Clusters Breaking Apart

**Symptom:** Related articles not clustering (e.g., Epstein files across sources)

**Root Cause:** Threshold too high or guardrail too strict

**Fix:**
1. Lower threshold for specific content types
2. Adjust guardrail embedding/title thresholds
3. Verify specific entities are being extracted correctly

### Duplicate Articles in Same Story

**Symptom:** Same article appears multiple times

**Root Cause:** Data quality issue, not scoring

**Fix:** Check `url_hash` deduplication and article upsert logic

---

## Performance

| Operation | Target | Notes |
|-----------|--------|-------|
| Candidate generation | <100ms | Uses GIN + HNSW indexes |
| Scoring 200 candidates | <50ms | O(n) across candidates |
| End-to-end clustering | <500ms | Per article |

---

## Related Tickets

| Ticket | Description |
|--------|-------------|
| TTRC-301 | Clustering quality improvement (stopwords, weights, thresholds, guardrail) |
| TTRC-304 | Frequency-based entity weighting |
| TTRC-305 | Fix keyphrase scoring component |
| TTRC-306 | AI topic extraction for clustering |

---

## Files

| File | Purpose |
|------|---------|
| `scripts/rss/scoring.js` | Hybrid scoring weights, thresholds, calculations |
| `scripts/rss/hybrid-clustering.js` | Clustering orchestration, guardrail |
| `scripts/rss/candidate-generation.js` | Finding candidate stories |
| `scripts/lib/entity-normalization.js` | Entity ID normalization |

---

**Last Updated:** 2025-12-10
**Author:** Claude Code + Josh

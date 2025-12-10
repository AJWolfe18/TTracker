# TTRC-301: Clustering Quality Improvement Plan

**Status:** Ready for Implementation
**Priority:** High
**Estimated Effort:** 4-6 hours
**Parent Epic:** TTRC-225 (RSS Feed Expansion)
**Created:** 2025-12-10

---

## Problem Summary

~40-50% false positive rate in story clustering. Unrelated articles are grouped together because:
1. Generic entities like `US-TRUMP` contribute 25% to scoring
2. All political news has high semantic similarity (~0.75-0.85)
3. Threshold (0.62) is too low
4. Keyphrase scoring is broken (uses entity IDs, not actual phrases)
5. **No guardrail** to prevent clustering when score crosses threshold due to "generic mush"

**User Priority:** Precision over recall - prefer 2 separate similar stories over 1 combined unrelated story.

---

## Implementation Plan

### Phase 1: Diagnostic Baseline (30 min)

**Goal:** Document current state for before/after comparison

1. **Create score breakdown script** - `scripts/analyze-cluster-scores.mjs`
   - For each multi-article story, log per-component scores
   - Output CSV columns:
     - `story_id, article_id, embedding_score, entity_score, title_score, time_score, geo_score, total_score`
     - **Debug columns:** `non_stopword_entity_overlap_count`, `has_title_overlap` (boolean)
     - `is_correct` (manual label during review)

   **Definition:** `has_title_overlap` = true when TF-IDF cosine similarity ≥ 0.50 (same scale as raw title_score)

2. **Track "Gold" clusters** - Pick 5-10 known arcs to verify across versions:
   - Epstein files (Story 4105, 4119, 4215)
   - Comey case (Story 3109, 3124)
   - Government shutdown (Story 3142, 3121)
   - Trump/Greene (Story 4079)
   - Voting Rights Act (Story 3270)

3. **Sample analysis** - Document 10 good + 10 bad clusters from existing CSV
   - Already have data in `exports/clustering-review-2025-12-10.csv`

**Deliverable:** Baseline metrics document with gold cluster tracking

---

### Phase 2: Entity Stopwords (45 min)

**Goal:** Prevent generic entities from inflating scores

**File:** `scripts/rss/scoring.js`

**Hard stopword list (13 entities) - Contribute 0 to entity similarity:**
```javascript
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

**Simple implementation (no frequency buckets for v1):**
```javascript
function getEntityWeight(entityId) {
  return ENTITY_STOPWORDS.has(entityId) ? 0 : 1;
}
```

**Implementation:**
1. Add `ENTITY_STOPWORDS` set to `scoring.js`
2. Add simple `getEntityWeight(entityId)` function
3. Modify `calculateEntityScore()` to filter stopwords
4. Track `non_stopword_entity_overlap_count` for diagnostics

**Implementation note - use unique IDs (Set) for overlap count:**
```javascript
const nonStopwordArticleEntities = new Set(
  article.entities
    .map(e => e.id)
    .filter(id => !ENTITY_STOPWORDS.has(id))
);
const nonStopwordStoryEntities = new Set(
  story.top_entities.filter(id => !ENTITY_STOPWORDS.has(id))
);

const overlap = [...nonStopwordArticleEntities]
  .filter(id => nonStopwordStoryEntities.has(id));

const nonStopwordEntityOverlapCount = overlap.length;
```

**Important:** Stopwords only affect scoring, not storage. `articles.entities` and `stories.top_entities` still contain TRUMP/BIDEN/etc. for display and analytics.

**Deferred to follow-up ticket (TTRC-304):** Frequency-based bucketed weighting (>20% → 0, 10-20% → 0.25x, etc.)

---

### Phase 3: Weight Rebalancing (30 min)

**Goal:** Reduce entity influence, let embeddings + title do heavy lifting

**File:** `scripts/rss/scoring.js`

**Current weights:**
```javascript
const WEIGHTS = {
  embedding: 0.40,    // Keep
  entities: 0.25,     // TOO HIGH
  title: 0.15,        // Could increase
  time: 0.10,         // Keep
  keyphrases: 0.05,   // BROKEN - remove or fix
  geography: 0.05,    // Keep
};
```

**New weights:**
```javascript
const WEIGHTS = {
  embedding: 0.45,    // +5% (primary signal)
  entities: 0.12,     // -13% (refinement only)
  title: 0.25,        // +10% (strong signal for same event)
  time: 0.10,         // Keep
  keyphrases: 0.00,   // Disabled until fixed (Option A)
  geography: 0.08,    // +3% (redistribute)
};
// Mental model: Entities are refinement only; embeddings + title carry the decision.
```

**Compatibility check:** Ensure all component scores are on same 0–1 scale before weighting. Currently:
- `embedding_score`: 0–1 (cosine normalized)
- `title_score`: 0–1 (TF-IDF cosine)
- `entity_score`: 0–1 (Jaccard)
- `time_score`: 0–1 (linear decay)
- `geo_score`: 0–1 (field match fraction)

**Deferred to follow-up ticket (TTRC-305):** Fix keyphrase scoring instead of disabling

---

### Phase 4: Threshold Adjustment (15 min)

**Goal:** Raise bar for clustering to reduce false positives

**File:** `scripts/rss/scoring.js`

**Current thresholds:**
```javascript
Wire services: 0.60
Opinion: 0.68
Policy docs: 0.64
Default: 0.62
```

**Testing gradient approach:**
1. First test with moderate increase (0.68 default)
2. Verify gold clusters still work
3. If good, consider moving to 0.72

**Target thresholds (may adjust after testing):**
```javascript
Wire services: 0.68     // +8%
Opinion: 0.76           // +8%
Policy docs: 0.72       // +8%
Default: 0.70           // +8% (start here, may go to 0.72)
```

**Rationale:**
- Scores in 0.62-0.69 range have highest false positive rate
- Raising to 0.70+ eliminates most bad clusters from CSV analysis
- Will increase single-article stories (acceptable per user preference)
- Test gradient prevents over-correction that breaks good clusters

**TEST-first rollout:** Apply threshold changes in TEST first; only promote to PROD after gold cluster validation passes.

---

### Phase 4.5: Hard Guardrail (30 min) ⭐ CRITICAL

**Goal:** Prevent clustering even when hybrid score crosses threshold due to "generic mush"

**File:** `scripts/rss/hybrid-clustering.js` (attach decision logic)

**The guardrail requires a concrete reason to cluster, not just a threshold pass:**

```javascript
// In the attach decision logic
const hasNonStopwordEntityOverlap = candidate.nonStopwordEntityOverlapCount > 0;
const hasDecentEmbedding = candidate.embeddingScore >= 0.60;  // raw, pre-weight
const hasTitleMatch = candidate.titleScore >= 0.50;           // raw, pre-weight

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
- Even with good weights/thresholds, marginal cases can slip through
- Guardrail says: "You must have EITHER a specific entity match OR a title match"
- Generic political news with only US-TRUMP overlap cannot pass
- This is the safety net for precision-first approach

**Implementation:**
1. Expose raw component scores from `calculateHybridScore()`
2. Track `nonStopwordEntityOverlapCount` during scoring
3. Add guardrail check in attach decision
4. Log when guardrail blocks a would-be cluster:

```javascript
console.log('[cluster-guardrail-block]', {
  articleId,
  storyId: candidate.storyId,
  embeddingScore: candidate.embeddingScore,
  titleScore: candidate.titleScore,
  nonStopwordEntityOverlapCount,
  totalScore: candidate.totalScore,
  threshold,
});
```

**Note:** The 0.60 / 0.50 thresholds are tunables, not constants. Use the guardrail block logs to refine these values if needed.

---

### Phase 5: Re-cluster and Validate (1 hour)

**Goal:** Verify improvements with fresh data

**TEST-first:** Run reclustering in TEST environment with metrics captured before any PROD changes.

**Steps:**
1. Run `scripts/recluster-all.mjs` with new scoring logic
2. Export new review CSV: `scripts/export-clustering-review.mjs`
3. Manual review of 20 multi-article stories
4. Compare metrics:
   - False positive rate: Target <10% (from ~45%)
   - Multi-article story count: Expect decrease (OK)
   - Average articles/story: May decrease (OK)

**Success criteria:**
- No "Trump blob" clusters with unrelated articles
- Specific events (Epstein files, Comey case, etc.) still cluster correctly
- User can manually verify improvement via CSV review

---

## Future Work (Separate Tickets)

### TTRC-304: Frequency-Based Entity Weighting

**Concept:** Automatically downweight entities based on document frequency
- `>20%` frequency → weight 0 (treat as stopword)
- `10-20%` → weight 0.25x
- `5-10%` → weight 0.5x
- `≤5%` → full weight (1.0x)

**Files:** `scripts/compute-entity-frequencies.mjs`, `scripts/rss/scoring.js`

---

### TTRC-305: Fix Keyphrase Scoring

**Current bug:** Uses `story.top_entities` (entity IDs) instead of actual keyphrases

**Proper fix:**
1. Add `keyphrases` column to stories table (text[])
2. During enrichment, extract top 5 keyphrases via AI or TF-IDF
3. Store and use for scoring

---

### TTRC-306: AI Topic Extraction

**Concept:** Generate topic IDs/slugs for each article via AI

```
"Trump faces federal investigation in Georgia"
→ TOPIC-TRUMP-GA-RICO-CASE
```

**Scoring impact:**
- Topic match → lower threshold allowed
- Topic mismatch → higher threshold required

**Cost:** ~$0.001/article (within budget)

---

## Files to Modify (TTRC-301)

| File | Changes |
|------|---------|
| `scripts/rss/scoring.js` | Stopwords, weights, thresholds, expose raw scores |
| `scripts/rss/hybrid-clustering.js` | Add guardrail check in attach decision |
| `scripts/analyze-cluster-scores.mjs` | NEW - diagnostic score breakdown with debug columns |
| `scripts/recluster-all.mjs` | May need updates for new scoring |

---

## Rollback Plan

If new scoring produces unexpected results:
1. Revert `scoring.js` to previous version
2. Re-run clustering with old logic
3. Investigate specific failure cases

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| False positive rate | ~45% | <10% |
| Multi-article stories | 141 | ~50-80 |
| "Trump blob" clusters | Common | **Zero** (guardrail prevents) |
| Gold clusters intact | ✅ | ✅ (verify Epstein, Comey, etc.) |

**Validation checklist:**
- [ ] Story 4079 (Trump/Greene) - still clusters correctly
- [ ] Story 3109 (Comey) - still clusters correctly
- [ ] Story 3270 (Voting Rights Act) - still clusters correctly
- [ ] Story 3081 (9 unrelated NYT articles) - NO LONGER clusters together

---

## Related Tickets

| Ticket | Description | Status |
|--------|-------------|--------|
| TTRC-301 | Clustering Quality Improvement (this work) | In Progress |
| TTRC-304 | Frequency-Based Entity Weighting | Backlog |
| TTRC-305 | Fix Keyphrase Scoring | Backlog |
| TTRC-306 | AI Topic Extraction | Backlog |

**Parent Epic:** TTRC-225 (RSS Feed Expansion)

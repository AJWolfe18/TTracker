# TTRC-301: Clustering Quality Improvement Plan

**Status:** Ready for Implementation
**Priority:** High
**Estimated Effort:** 5-7 hours
**Parent Epic:** TTRC-225 (RSS Feed Expansion)
**Created:** 2025-12-10
**Last Updated:** 2025-12-10 (Expert Review Incorporated)

---

## Problem Summary

~40-50% false positive rate in story clustering. Unrelated articles are grouped together because:
1. Generic entities like `US-TRUMP` contribute 25% to scoring
2. All political news has high semantic similarity (~0.75-0.85)
3. Threshold (0.62) is too low
4. Keyphrase scoring is broken (uses entity IDs, not actual phrases)
5. **No guardrail** to prevent clustering when score crosses threshold due to "generic mush"
6. **Title score normalization bug** - TF-IDF cosine (0-1) passed through embedding normalizer inflates scores

**User Priority:** Precision over recall - prefer 2 separate similar stories over 1 combined unrelated story.

---

## Key Decisions (from Expert Review)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entity source for scoring | `entity_counter` | Richer data (has counts), no information loss vs `top_entities` (top 8 only) |
| Reclustering strategy | Full re-cluster | Delete all article_story links, recluster from scratch |
| Title score normalization | Fix the bug | TF-IDF already 0-1, don't apply embedding normalizer |

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

**Implementation:**
1. Add `ENTITY_STOPWORDS` set to `scoring.js`
2. Modify `calculateEntityScore()` to filter stopwords and return overlap count
3. **Use `entity_counter` as canonical source** (not `top_entities`)

**Implementation (using entity_counter):**
```javascript
function calculateEntityScore(articleEntities, storyEntityCounter) {
  if (!articleEntities || !storyEntityCounter) return { score: 0, nonStopwordEntityOverlapCount: 0 };

  // Use entity_counter keys (has all entities, not just top 8)
  const storyEntityIds = Object.keys(storyEntityCounter || {});
  const articleEntityIds = (articleEntities || [])
    .map(e => e.id)
    .filter(id => id && !ENTITY_STOPWORDS.has(id));

  const storyNonStop = new Set(
    storyEntityIds.filter(id => !ENTITY_STOPWORDS.has(id))
  );
  const articleNonStop = new Set(articleEntityIds);

  const overlap = [...articleNonStop].filter(id => storyNonStop.has(id));
  const nonStopwordEntityOverlapCount = overlap.length;

  // Jaccard on non-stopword entities only
  const union = new Set([...articleNonStop, ...storyNonStop]);
  const score = union.size > 0 ? overlap.length / union.size : 0;

  return { score, nonStopwordEntityOverlapCount };
}
```

**Important:**
- Stopwords only affect scoring, not storage
- `entity_counter` is canonical for scoring (complete data)
- `top_entities` stays useful for GIN index queries and UI display

**Deferred to follow-up ticket (TTRC-304):** Frequency-based bucketed weighting (>20% → 0, 10-20% → 0.25x, etc.)

---

### Phase 2.5: Scoring Refactor & Normalization Fix (30 min) ⭐ MANDATORY

**Goal:** Fix title score bug and enable guardrail by exposing raw component scores

**File:** `scripts/rss/scoring.js`

**BUG FIX - Title Score Normalization:**

Current code has a bug where TF-IDF cosine (already 0-1) is passed through `calculateEmbeddingScore()` which applies `(similarity + 1) / 2` normalization (meant for embedding cosine -1 to 1):

```javascript
// BEFORE (buggy) - scoring.js:237
function calculateTitleScore(titleA, titleB) {
  // ... TF-IDF calculation ...
  return calculateEmbeddingScore(vectorA, vectorB);  // ← WRONG
}
```

**Fix:** Create separate cosine similarity helper:

```javascript
// Pure cosine similarity for TF-IDF (already 0-1 scale)
function cosineSimilarity(vectorA, vectorB) {
  if (!vectorA?.length || !vectorB?.length || vectorA.length !== vectorB.length) return 0;

  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);  // No normalization - TF-IDF is already 0-1
}

// AFTER (fixed)
function calculateTitleScore(titleA, titleB) {
  // ... TF-IDF calculation ...
  return Math.max(0, Math.min(1, cosineSimilarity(vectorA, vectorB)));
}

// Embeddings still use the old normalization (cosine ranges -1 to 1)
function calculateEmbeddingScore(embA, embB) {
  const cosine = cosineSimilarity(embA, embB);
  return (cosine + 1) / 2;  // Normalize -1..1 to 0..1
}
```

**REFACTOR - Return detailed scores object:**

```javascript
export function calculateHybridScore(article, story) {
  const embeddingScore = calculateEmbeddingScore(article.embedding_v1, story.centroid_embedding_v1);
  const titleScore = calculateTitleScore(article.title, story.primary_headline);
  const { score: entityScore, nonStopwordEntityOverlapCount } = calculateEntityScore(article.entities, story.entity_counter);
  const timeScore = calculateTimeScore(article.published_at, story.last_updated_at);
  const geoScore = calculateGeoScore(article.geo, story.geography);

  // Keyphrase short-circuit (weight is 0)
  const keyphraseScore = WEIGHTS.keyphrases > 0
    ? calculateKeyphraseScore(article.keyphrases, story.top_entities)
    : 0;

  const total =
    WEIGHTS.embedding * embeddingScore +
    WEIGHTS.title * titleScore +
    WEIGHTS.entities * entityScore +
    WEIGHTS.time * timeScore +
    WEIGHTS.geography * geoScore +
    WEIGHTS.keyphrases * keyphraseScore;

  // Add bonuses...

  return {
    total: Math.min(total + bonuses, 1.0),
    embeddingScore,
    titleScore,
    entityScore,
    timeScore,
    geoScore,
    keyphraseScore,
    nonStopwordEntityOverlapCount,
  };
}
```

**Update hybrid-clustering.js:**

```javascript
// BEFORE
const score = calculateHybridScore(article, story);
if (score >= threshold) { ... }

// AFTER
const scoreResult = calculateHybridScore(article, story);
if (scoreResult.total >= threshold) { ... }
// Now can access scoreResult.embeddingScore, scoreResult.titleScore, etc.
```

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

**Configuration block (add to scoring.js):**
```javascript
const GUARDRAIL = {
  minEmbedding: 0.60,  // Raw embedding score required
  minTitle: 0.50,      // Raw title score required (if no entity overlap)
};
```

**The guardrail requires a concrete reason to cluster, not just a threshold pass:**

```javascript
// In the attach decision logic (hybrid-clustering.js)
const scoreResult = calculateHybridScore(article, candidateStory);

const hasNonStopwordEntityOverlap = scoreResult.nonStopwordEntityOverlapCount > 0;
const hasDecentEmbedding = scoreResult.embeddingScore >= GUARDRAIL.minEmbedding;
const hasTitleMatch = scoreResult.titleScore >= GUARDRAIL.minTitle;

const passesGuardrail =
  hasDecentEmbedding &&
  (hasNonStopwordEntityOverlap || hasTitleMatch);

if (scoreResult.total >= threshold && passesGuardrail) {
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
1. ✅ Raw component scores now available from Phase 2.5 refactor
2. ✅ `nonStopwordEntityOverlapCount` tracked in Phase 2
3. Add guardrail check in attach decision
4. Log when guardrail blocks a would-be cluster:

```javascript
if (scoreResult.total >= threshold && !passesGuardrail) {
  console.log('[cluster-guardrail-block]', {
    articleId: article.id,
    storyId: candidateStory.id,
    embeddingScore: scoreResult.embeddingScore,
    titleScore: scoreResult.titleScore,
    nonStopwordEntityOverlapCount: scoreResult.nonStopwordEntityOverlapCount,
    totalScore: scoreResult.total,
    threshold,
    reason: !hasDecentEmbedding ? 'low-embedding' :
            (!hasNonStopwordEntityOverlap && !hasTitleMatch) ? 'no-specific-match' : 'unknown'
  });
}
```

**Note:** The 0.60 / 0.50 thresholds are tunables. Use the guardrail block logs to refine these values if needed.

---

### Phase 5: Re-cluster and Validate (1 hour)

**Goal:** Verify improvements with fresh data

**TEST-first:** Run reclustering in TEST environment with metrics captured before any PROD changes.

**Strategy: FULL RE-CLUSTER**
- Delete all `article_story` links
- Delete all stories
- Re-cluster every article from scratch with new scoring
- This ensures clean data without legacy bad clusters

**Steps:**
1. **Backup current state:**
   ```sql
   -- Export current article_story for rollback
   SELECT * FROM article_story INTO OUTFILE 'article_story_backup.csv';
   ```

2. **Clear existing clusters:**
   ```sql
   DELETE FROM article_story;
   DELETE FROM stories;
   ```

3. **Run full re-cluster:**
   ```bash
   node scripts/recluster-all.mjs --full
   ```

4. **Export new review CSV:**
   ```bash
   node scripts/export-clustering-review.mjs
   ```

5. **Validate:**
   - Manual review of 20 multi-article stories
   - Verify gold clusters still form correctly
   - Compare metrics:
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
| `scripts/rss/scoring.js` | Stopwords, weights, thresholds, **title score bug fix**, **return type refactor**, GUARDRAIL config |
| `scripts/rss/hybrid-clustering.js` | Update to use `.total` from scoring, add guardrail check |
| `scripts/rss/candidate-generation.js` | Filter stopwords from entity block query (optimization) |
| `scripts/analyze-cluster-scores.mjs` | NEW - diagnostic score breakdown with debug columns |
| `scripts/recluster-all.mjs` | Add `--full` flag for complete re-cluster |

### Phase 6: Candidate Generation Optimization ✅ INCLUDED

**File:** `scripts/rss/candidate-generation.js`

Filter stopwords before building the entity candidate list to avoid wasting candidate slots:

```javascript
// In getEntityBlockCandidates()
const entityIds = (article.entities || [])
  .map(e => e.id)
  .filter(id => id && !ENTITY_STOPWORDS.has(id));

if (entityIds.length === 0) {
  // Skip entity block - rely on time + embeddings
  return [];
}

// Use filtered entityIds in overlaps() query
```

This prevents the entity block from returning stories that only match on US-TRUMP when that's the article's only entity.

---

### Phase 7: Env-Configurable Thresholds ✅ INCLUDED

**File:** `scripts/rss/scoring.js`

Make thresholds overridable via environment variables for quick A/B testing:

```javascript
const THRESHOLDS = {
  wire: parseFloat(process.env.THRESHOLD_WIRE || '0.68'),
  opinion: parseFloat(process.env.THRESHOLD_OPINION || '0.76'),
  policy: parseFloat(process.env.THRESHOLD_POLICY || '0.72'),
  default: parseFloat(process.env.THRESHOLD_DEFAULT || '0.70'),
};

const GUARDRAIL = {
  minEmbedding: parseFloat(process.env.GUARDRAIL_MIN_EMBEDDING || '0.60'),
  minTitle: parseFloat(process.env.GUARDRAIL_MIN_TITLE || '0.50'),
};
```

This allows quick tuning without code changes during validation.

---

## Scope Decisions

| Item | Decision | Rationale |
|------|----------|-----------|
| Candidate generation stopword filter | ✅ Include | Cleaner candidates, minor perf win |
| Env-configurable thresholds | ✅ Include | Easy A/B testing during validation |
| Automated gold cluster tests | ❌ Defer | Manual validation sufficient for now |

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

### TTRC-301 Sub-Tasks (Created 2025-12-10)

| Ticket | Summary | Phase | Est |
|--------|---------|-------|-----|
| **TTRC-307** | Diagnostic Baseline & Score Analysis | 1 | 30 min |
| **TTRC-308** | Entity Stopwords Implementation | 2 | 45 min |
| **TTRC-309** | Scoring Refactor & Title Bug Fix ⭐ CRITICAL | 2.5 | 30 min |
| **TTRC-310** | Weight Rebalancing & Thresholds | 3-4 | 30 min |
| **TTRC-311** | Hard Guardrail Implementation ⭐ CRITICAL | 4.5 | 30 min |
| **TTRC-312** | Candidate Generation Optimization | 6 | 15 min |
| **TTRC-313** | Full Re-cluster & Validation | 5+7 | 1 hour |

**Total Estimated Time:** 3h 40m

### Future Work (Separate Tickets)

| Ticket | Description | Status |
|--------|-------------|--------|
| TTRC-304 | Frequency-Based Entity Weighting | Backlog |
| TTRC-305 | Fix Keyphrase Scoring | Backlog |
| TTRC-306 | AI Topic Extraction | Backlog |

**Parent Epic:** TTRC-250 (RSS Feed Expansion)

# TTRC-236: Merge Logic Validation & Tuning

## Goal
Ensure story merging works correctly with the current scale (≈1,363 stories, 1,549 articles, 18+ feeds) and achieve target metrics:
- **Precision ≥ 95%**
- **Recall ≥ 70%**
- **F1 ≥ 80%**

---

## Infrastructure Summary (Verified)

**What EXISTS:**
- `centroid_embedding_v1` (vector(1536)) on stories - running average of article embeddings
- `top_entities` (text[]) on stories - top 5 entity IDs
- `embedding_v1` (vector(1536)) on articles - OpenAI `text-embedding-ada-002`
- `cosineSimilarity()` function in `periodic-merge.js`
- Jaccard similarity (headline word overlap) inline in JS
- Hybrid scoring with 6+ signals in `scoring.js`

**Current Merge Config (`merge-thresholds.js`):**
```javascript
MERGE_CFG = {
  MIN_SHARED: 2,              // Requires 2+ shared entities (blocks 1-entity)
  SIM_FOR_2: 0.88,            // High bar for 2 entities
  SIM_FOR_3: 0.82,            // Lower bar for 3+ entities
  MAX_GAP_DAYS: 7,            // Time window

  REQUIRE_ACTOR_MATCH: false,   // DISABLED (tunable later)
  REQUIRE_CATEGORY_MATCH: false, // DISABLED (tunable later)

  // 1-entity lane (strict, initially disabled)
  ENABLE_1_ENTITY_LANE: false,
  SIM_FOR_1: 0.93,
  MAX_GAP_DAYS_FOR_1: 2,
  MIN_TITLE_JACCARD_FOR_1: 0.6,
  EXCLUDED_1_ENTITY_IDS: [],        // Ultra-common entities to ignore
  REQUIRE_SHARED_PRIMARY_ACTOR: true,
  MAX_1_ENTITY_STORY_SIZE: 6,       // Don't merge into mega-clusters
  REQUIRE_CATEGORY_MATCH_FOR_1: true,
}
```

**Key Files:**
- `scripts/lib/merge-logic.js` - `shouldMerge()` decision function
- `scripts/lib/merge-thresholds.js` - Configuration
- `scripts/rss/periodic-merge.js` - Merge execution job
- `scripts/rss/scoring.js` - Hybrid scoring (6+ signals)
- `scripts/validate-merge-quality.js` - Merge validation & metrics

**Important: Hybrid vs Cosine**
For this phase we use **embedding cosine similarity** as the main continuous signal for candidate selection and evaluation. The existing hybrid score (6+ signals) is left untouched to keep analysis focused on entity + embedding behavior. Hybrid scoring may be revisited in a future phase.

---

## Prerequisites

### Required Index
Ensure GIN index exists for entity overlap queries:
```sql
CREATE INDEX IF NOT EXISTS idx_stories_top_entities_gin
  ON stories USING gin (top_entities);
```
Without this, self-join queries on `top_entities &&` will use sequential scans as data grows.

---

## Phase 1: Current State Analysis

### 1.1 Verify Infrastructure
```sql
-- Check embedding coverage
SELECT
  COUNT(*) as total_stories,
  COUNT(*) FILTER (WHERE centroid_embedding_v1 IS NOT NULL) as with_embeddings,
  COUNT(*) FILTER (WHERE top_entities IS NOT NULL AND array_length(top_entities, 1) > 0) as with_entities
FROM stories;

-- Check article embedding coverage
SELECT
  COUNT(*) as total_articles,
  COUNT(*) FILTER (WHERE embedding_v1 IS NOT NULL) as with_embeddings
FROM articles;
```

### 1.2 Analyze Current Merge Distribution
```sql
-- How many stories have multiple sources?
SELECT source_count, COUNT(*) as story_count
FROM stories
GROUP BY source_count
ORDER BY source_count;

-- Stories that WERE merged (validate precision)
SELECT id, primary_headline, source_count, top_entities
FROM stories
WHERE source_count > 1
ORDER BY source_count DESC
LIMIT 20;
```

### 1.3 Entity Quality Check
```sql
-- Sample entity extraction quality
SELECT id, primary_headline, top_entities
FROM stories
WHERE array_length(top_entities, 1) > 0
ORDER BY RANDOM()
LIMIT 20;
```

---

## Phase 2: Build Test Dataset

### 2.1 Stratified Sampling Strategy

**Target: ~100 labeled pairs across 4 buckets.**
If more data becomes available later, we can expand; the framework is designed to scale.

| Bucket | Count | Purpose | Source |
|--------|-------|---------|--------|
| **A: Existing Merges** | ~20 | Validate precision | Stories with `source_count > 1` |
| **B: High Similarity** | ~30 | Find recall gaps | Pairs with cosine ≥0.75, not merged |
| **C: 1-Entity Overlap** | ~30 | Stress-test 1-entity lane | Pairs sharing exactly 1 entity |
| **D: Same Topic Different Events** | ~20 | Prevent false positives | Similar headlines, different events |

*Note: Bucket sizes are targets, not hard constraints. If fewer merged stories exist, Bucket A will be smaller.*

### 2.2 Generate Candidate Pairs

**Bucket A: Existing Merges (precision)**
```sql
SELECT s.id, s.primary_headline, s.source_count, s.top_entities,
       array_agg(a.title ORDER BY a.id) AS article_titles
FROM stories s
JOIN article_story ast ON ast.story_id = s.id
JOIN articles a ON a.id = ast.article_id
WHERE s.source_count > 1
GROUP BY s.id
ORDER BY s.source_count DESC
LIMIT 20;
```

**Bucket B: High Similarity (recall gaps)**
Generate candidates by entity overlap + time window; compute cosine in JS:
```sql
SELECT s1.id AS story1_id, s2.id AS story2_id,
       s1.primary_headline AS headline1, s2.primary_headline AS headline2,
       s1.top_entities AS entities1, s2.top_entities AS entities2,
       cardinality(ARRAY(
         SELECT unnest(s1.top_entities) INTERSECT SELECT unnest(s2.top_entities)
       )) AS shared_count
FROM stories s1
JOIN stories s2 ON s2.id > s1.id
WHERE s1.centroid_embedding_v1 IS NOT NULL
  AND s2.centroid_embedding_v1 IS NOT NULL
  AND s1.first_seen_at > NOW() - INTERVAL '14 days'
  AND s2.first_seen_at > NOW() - INTERVAL '14 days'
  AND s1.top_entities && s2.top_entities
ORDER BY shared_count DESC
LIMIT 50;
```
Then in JS: Compute cosine similarity, keep ~30 highest pairs that are NOT currently merged.

**Bucket C: 1-Entity Overlap (stress-test 1-entity)**
```sql
SELECT s1.id AS story1_id, s2.id AS story2_id,
       s1.primary_headline AS headline1, s2.primary_headline AS headline2,
       ARRAY(
         SELECT unnest(s1.top_entities) INTERSECT SELECT unnest(s2.top_entities)
       ) AS shared_entities
FROM stories s1
JOIN stories s2 ON s2.id > s1.id
WHERE cardinality(ARRAY(
        SELECT unnest(s1.top_entities) INTERSECT SELECT unnest(s2.top_entities)
      )) = 1
  AND s1.first_seen_at > NOW() - INTERVAL '7 days'
  AND s2.first_seen_at > NOW() - INTERVAL '7 days'
LIMIT 30;
```

**Bucket D: Same Topic, Different Events**
Curated manually: Use headline keyword search (e.g. "impeachment", "border", "Ukraine") to find pairs with similar language but clearly different dates/phases. Select ~20 CLEAR "different event" pairs.

### 2.3 Labeling Process & Guidelines

Each pair is labeled as:
- `SAME_EVENT` - Same news event, SHOULD merge
- `DIFFERENT_EVENT` - Different events, should NOT merge
- `UNCLEAR` - Borderline (exclude from metrics)

**Guidelines for Consistent Labeling:**

**SAME_EVENT if:**
- The core factual proposition is the same (e.g. "House passes X bill", "DOJ announces indictment Y")
- Articles describe the same phase of a story (e.g. the indictment itself, not later appeals)

**DIFFERENT_EVENT if:**
- Articles describe different "chapters" (investigation vs indictment vs sentencing vs appeal)
- Distinct incidents separated by time or clearly different underlying actions

**UNCLEAR:**
- Long-running sagas where the boundary between "one story" vs "multiple" is ambiguous
- These are allowed in the dataset but ignored in P/R/F1 calculations

Ground truth stored in: `scripts/datasets/merge-ground-truth.json`

---

## Phase 3: Validation Framework

### 3.1 Metrics to Track
- **Precision:** Of predicted merges, how many are correct?
- **Recall:** Of true duplicates, how many did we find?
- **F1 Score:** Harmonic mean of precision/recall
- **Coverage:** % of pairs where both stories have sufficient metadata
- **Skip Reasons:** Why pairs were rejected (NO_ENTITIES, TIME_WINDOW, LOW_SIM, LANE_DISABLED)

### 3.2 Validation Script Improvements
Update `scripts/validate-merge-quality.js` to:
1. Load ground truth from JSON (`merge-ground-truth.json`)
2. Fetch story data from database (IDs from JSON)
3. Run multiple threshold configs (grid search)
4. Use `explainMergeDecision()` to capture skip reasons per pair
5. Compute P/R/F1 per config
6. Output false positives/negatives with dominant skip reasons
7. Tag which merges would come from which lane (`multi_entity` vs `1_entity`)

### 3.3 `explainMergeDecision()` Helper

Add to `merge-logic.js`. **Key design decision:** Compute similarity inside (Option B) so there's one source of truth:
```javascript
// Single source of truth - computes similarity internally
function explainMergeDecision(storyA, storyB, config = MERGE_CFG) {
  const similarity = cosineSimilarity(
    storyA.centroid_embedding_v1,
    storyB.centroid_embedding_v1
  );

  const context = {
    decision: false,
    lane: null,
    similarity,  // Include for debugging
    blockedBy: [],   // e.g. ['TIME_WINDOW', 'NOT_ENOUGH_ENTITIES', 'LOW_SIM_2']
    passed: [],      // e.g. ['ENTITY_OVERLAP', 'TIME_WINDOW_OK', 'SIM_2_OK']
  };

  // Run all lane logic, populating context.blockedBy / context.passed
  // Set context.decision = true/false and context.lane = 'multi_entity' | '1_entity' | null

  return context;
}

// Thin wrapper - single source of truth
export function shouldMerge(storyA, storyB, config = MERGE_CFG) {
  return explainMergeDecision(storyA, storyB, config).decision;
}
```
This prevents `shouldMerge` and `explainMergeDecision` from drifting apart.

### 3.4 Config Merge Semantics

Validation uses each config by **shallow-merging** over the default MERGE_CFG:
```javascript
function buildConfig(overrides) {
  return { ...MERGE_CFG, ...overrides };
}

// Usage in validation:
for (const testConfig of configs) {
  const mergedConfig = buildConfig(testConfig);
  // Run validation with mergedConfig
}
```
This ensures flags like `REQUIRE_CATEGORY_MATCH_FOR_1` don't get unexpected defaults.

### 3.5 Threshold Grid Search

Focus on 2+ entity tuning first, then optionally test strict 1-entity:
```javascript
const configs = [
  // Baseline (current)
  {
    name: 'baseline',
    MIN_SHARED: 2,
    SIM_FOR_2: 0.88,
    SIM_FOR_3: 0.82,
    REQUIRE_ACTOR_MATCH: false,
    REQUIRE_CATEGORY_MATCH: false,
    ENABLE_1_ENTITY_LANE: false,
  },

  // Relaxed 2-entity
  {
    name: 'relaxed_2_entity',
    MIN_SHARED: 2,
    SIM_FOR_2: 0.80,
    SIM_FOR_3: 0.75,
    REQUIRE_ACTOR_MATCH: false,
    ENABLE_1_ENTITY_LANE: false,
  },

  // 2-entity with actor match
  {
    name: 'actor_match_2_entity',
    MIN_SHARED: 2,
    SIM_FOR_2: 0.82,
    SIM_FOR_3: 0.78,
    REQUIRE_ACTOR_MATCH: true,
    ENABLE_1_ENTITY_LANE: false,
  },

  // Strict 1-entity lane (test only)
  {
    name: 'strict_1_entity_lane',
    MIN_SHARED: 2,
    SIM_FOR_2: 0.82,
    SIM_FOR_3: 0.78,
    REQUIRE_ACTOR_MATCH: true,
    ENABLE_1_ENTITY_LANE: true,
    SIM_FOR_1: 0.93,
    MAX_GAP_DAYS_FOR_1: 2,
    MIN_TITLE_JACCARD_FOR_1: 0.6,
    REQUIRE_SHARED_PRIMARY_ACTOR: true,
    MAX_1_ENTITY_STORY_SIZE: 6,
    REQUIRE_CATEGORY_MATCH_FOR_1: true,
  },
];
```

---

## Phase 4: Implementation (Based on Findings)

### 4.1 Decision Tree

| Analysis Result | Action |
|-----------------|--------|
| F1 ≥80%, Precision ≥95% | Document & close TTRC-236 |
| Recall <70%, Precision OK | Relax 2-entity thresholds |
| Precision <95% | Tighten thresholds / require actor |
| Both low | Full threshold recalibration |

**Priority order:**
1. Tune 2+ entity lane first (SIM thresholds, optional REQUIRE_ACTOR_MATCH)
2. Only then experiment with ultra-strict 1-entity lane, and only if recall is still unacceptable

### 4.2 Title Jaccard Similarity (with Stopwords)

Add to `merge-logic.js`:
```javascript
const NEWS_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this',
  'will', 'would', 'could', 'should',
  'says', 'said', 'reports', 'report',
  'new', 'again', 'today', 'latest',
  // add more as needed
]);

function titleJaccardSimilarity(title1, title2) {
  const normalize = (t) => t.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !NEWS_STOPWORDS.has(w));

  const words1 = new Set(normalize(title1));
  const words2 = new Set(normalize(title2));

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
}
```

### 4.3 Strict 1-Entity Lane (Optional, Flag-Gated)

1-entity lane is **not the primary strategy**; it is a narrow exception for cases where:
- There is exactly 1 shared entity
- That entity is the primary actor of BOTH stories
- Embedding similarity and title overlap are very high
- Time gap is small
- Cluster size doesn't exceed MAX_1_ENTITY_STORY_SIZE

**Implementation in shouldMerge():**
```javascript
// Lane: 1 shared entity (STRICT) - gated by config
if (config.ENABLE_1_ENTITY_LANE && sharedCount === 1) {
  const sharedEntity = sharedEntities[0];

  // Block ultra-common entities
  if (config.EXCLUDED_1_ENTITY_IDS.includes(sharedEntity)) {
    context.blockedBy.push('1_ENTITY_EXCLUDED_ID');
    return false;
  }

  // Require shared entity to be primary actor of BOTH stories
  if (config.REQUIRE_SHARED_PRIMARY_ACTOR) {
    if (storyA.primary_actor_id !== sharedEntity ||
        storyB.primary_actor_id !== sharedEntity) {
      context.blockedBy.push('PRIMARY_ACTOR_MISMATCH');
      return false;
    }
  }

  // Tight time window
  if (!withinDays(firstSeenA, firstSeenB, config.MAX_GAP_DAYS_FOR_1)) {
    context.blockedBy.push('1_ENTITY_TIME_WINDOW');
    return false;
  }

  // Very high embedding similarity
  if (similarity < config.SIM_FOR_1) {
    context.blockedBy.push('LOW_SIM_1');
    return false;
  }

  // Category match (if enabled)
  if (config.REQUIRE_CATEGORY_MATCH_FOR_1 &&
      !categoriesMatch(storyA, storyB)) {
    context.blockedBy.push('1_ENTITY_CATEGORY_MISMATCH');
    return false;
  }

  // Title word overlap
  const titleSim = titleJaccardSimilarity(storyA.primary_headline, storyB.primary_headline);
  if (titleSim < config.MIN_TITLE_JACCARD_FOR_1) {
    context.blockedBy.push('LOW_TITLE_JACCARD_1');
    return false;
  }

  // Don't merge into mega-clusters
  if (Math.max(storyA.source_count, storyB.source_count) > config.MAX_1_ENTITY_STORY_SIZE) {
    context.blockedBy.push('1_ENTITY_CLUSTER_TOO_LARGE');
    return false;
  }

  context.lane = '1_entity';
  context.decision = true;
  return true;
}
```

### 4.4 Threshold Adjustments (if precision too low)
- Increase `SIM_FOR_2` from 0.88 → 0.90
- Enable `REQUIRE_ACTOR_MATCH: true`
- Reduce `MAX_GAP_DAYS` from 7 → 5

---

## Phase 5: Execution Plan

### Session 1: Analysis & Dataset Building
1. Run infrastructure queries (embedding/entity coverage)
2. Run merge distribution queries
3. Generate candidate pairs for all 4 buckets
4. Calculate cosine similarity for bucket B (JS script)
5. AI-assisted labeling → present to user for review
6. Save ground truth to `scripts/datasets/merge-ground-truth.json`

### Session 2: Validation & Metrics
1. Run `validate-merge-quality.js` with ground truth
2. Report P/R/F1 metrics for current config
3. If F1 <80%: run grid search with test configs
4. Present winning config with examples

### Session 3: Implementation (if needed)
1. Implement `titleJaccardSimilarity()` function
2. Add 1-entity lane to `shouldMerge()`
3. Update config with new options
4. Re-run validation to confirm improvement

---

## Phase 6: Rollout Safety & Monitoring

### Before Production Deploy
- [ ] Validate changes on TEST branch only
- [ ] Keep `ENABLE_1_ENTITY_LANE = false` initially
- [ ] Run periodic-merge with dry-run flag: log what WOULD merge and via which lane
- [ ] Manual review of at least 10-20 proposed merges, especially:
  - Large clusters
  - Any merges via `1_entity` lane (if enabled in TEST)

### Gradual Enablement
1. **Week 1:** Deploy tuned 2-entity thresholds to PROD, 1-entity lane still disabled
2. **Week 2:** Optionally enable 1-entity lane in TEST only, monitor behavior
3. **Week 3:** If metrics and manual reviews look good, consider enabling in PROD

### Rollback Plan
```javascript
// Emergency rollback - just flip the flag
MERGE_CFG.ENABLE_1_ENTITY_LANE = false;
// Optionally tighten 2-entity thresholds if needed
```
No migration required, no data loss; changes take effect on next merge run.

### Lane-Tagged Merge Tracking
Ensure merges are logged with lane info:
- `lane: 'multi_entity'` for 2+ entity merges
- `lane: '1_entity'` for strict 1-entity merges

Track over time:
- Count of merges per lane
- Manual spot-check error rates per lane
- If 1-entity shows higher error rate, can disable instantly

### Operational Metric (Nice to Have)
Monitor daily distribution of `source_count` (1, 2, 3, 4+):
```sql
SELECT source_count, COUNT(*) FROM stories GROUP BY source_count;
```
If this suddenly explodes after a threshold change, you know where to look.

---

## Success Criteria

| Metric | Target | Baseline |
|--------|--------|----------|
| Precision | ≥95% | ~100% (few merges) |
| Recall | ≥70% | ~7% (strict config) |
| F1 Score | ≥80% | ~13% |
| Entity Coverage | ≥80% | ~63% |

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/lib/merge-logic.js` | Add `titleJaccardSimilarity()` with stopwords, `explainMergeDecision()`, strict 1-entity lane |
| `scripts/lib/merge-thresholds.js` | Add strict 1-entity config options / guardrails |
| `scripts/validate-merge-quality.js` | Load JSON ground truth, run configs, use `explainMergeDecision()` |
| `scripts/datasets/merge-ground-truth.json` | NEW: ~100 labeled pairs (SAME_EVENT/DIFFERENT_EVENT/UNCLEAR) |
| `scripts/rss/periodic-merge.js` | Support dry-run + lane-tagged logging (for monitoring) |

---

## User Decisions (Confirmed)

- **Focus first** on 2-entity lane tuning (relaxing thresholds, optional actor match)
- **1-entity lane is:**
  - Strict, heavily guarded (7+ gates)
  - Disabled by default, enabled only if validation proves it safe
- **Ground truth size:** ~100 pairs initially, expandable later
- **CI enforcement and "related stories" graph:** Future enhancements, not part of this phase
- **Labeling:** Follow explicit SAME_EVENT/DIFFERENT_EVENT/UNCLEAR guidelines for consistency

---

**Created:** 2025-11-30
**Updated:** 2025-11-30 (added reviewer feedback: GIN index, explainMergeDecision signature, config merge semantics)
**Status:** Planning Complete - Ready for Session 1

# TTRC-225: Production-Grade Story Clustering - Implementation Plan

**Epic:** TTRC-225  
**Status:** Phase 1 Complete ✅, Phase 2 Starting  
**Estimated Duration:** 3-4 weeks  
**Monthly Cost:** $15-20 (well under $50 budget)  
**Expected Improvement:** 90%+ precision (from ~75%)

---

## Executive Summary

**Problem:** Current clustering uses basic title similarity (pg_trgm) which over-merges unrelated articles and under-merges true follow-ups. All articles currently create separate stories (source_count=1).

**Solution:** Implement hybrid scoring system combining semantic embeddings, entity overlap, and content signals to accurately group related articles into stories.

**Business Impact:**
- **User Trust:** More accurate story grouping = better user experience
- **Editorial Efficiency:** Fewer manual interventions needed
- **Cost:** ~$0.47/month at current volume (62 articles/day)
- **Competitive Advantage:** Professional-grade clustering matches industry standards

---

## Architecture Overview

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ RSS Ingestion Pipeline (Existing)                          │
│ - Fetches feeds every 2 hours                              │
│ - Creates articles in database                             │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Metadata Extraction ✅ COMPLETE                    │
│ - Extract entities (GPT-4o-mini): Donald Trump, DOJ, etc.  │
│ - Generate embeddings (ada-002): 1536-dim semantic vectors │
│ - Extract keyphrases (TF-IDF): "executive order", etc.     │
│ - Detect artifacts: PDFs, Federal Register docs            │
│ - Extract geography: Washington DC, Texas, etc.            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Hybrid Scoring 🔄 NEXT UP                         │
│ - Weighted formula combining 6+ signals                    │
│ - Adaptive thresholds by content type                      │
│ - Candidate generation via blocking (<100ms)               │
│ - Centroid tracking for online learning                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Clustering Engine 📋 PLANNED                      │
│ - Online greedy clustering (real-time)                     │
│ - Story lifecycle (emerging → growing → stable → stale)    │
│ - Auto-split detection (internal coherence)                │
│ - Periodic merge job (nightly reconciliation)              │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Admin & Monitoring 📋 PLANNED                     │
│ - Manual merge/split tools                                 │
│ - Duplicate detection (SimHash)                            │
│ - Quality dashboard (B-cubed F1 metrics)                   │
│ - Audit trail for interventions                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Enhanced Metadata Extraction ✅ COMPLETE

**JIRA:** TTRC-229  
**Status:** Done  
**Time Spent:** 2 hours  
**Cost:** $0 (infrastructure only)

### What Was Built

#### 1. Database Schema (Migration 022)
```sql
-- Versioned embeddings (future-proof for model upgrades)
ALTER TABLE articles ADD COLUMN embedding_v1 vector(1536);
ALTER TABLE articles ADD COLUMN embedding_model_v1 text DEFAULT 'text-embedding-ada-002';

-- Content metadata for hybrid scoring
ALTER TABLE articles ADD COLUMN entities jsonb;           -- Top-5 entities with confidence
ALTER TABLE articles ADD COLUMN keyphrases text[];        -- TF-IDF extracted phrases
ALTER TABLE articles ADD COLUMN quote_hashes bigint[];    -- SimHash of 12+ word quotes
ALTER TABLE articles ADD COLUMN artifact_urls text[];     -- PDFs, FR docs, press releases
ALTER TABLE articles ADD COLUMN geo jsonb;                -- {country, state, city}

-- Performance indexes
CREATE INDEX ix_articles_emb_v1_hnsw ON articles 
  USING hnsw (embedding_v1 vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX ix_articles_entities_gin ON articles USING gin (entities);
CREATE INDEX ix_articles_keyphrases_gin ON articles USING gin (keyphrases);

-- Cost tracking table
CREATE TABLE openai_usage (
  id BIGSERIAL PRIMARY KEY,
  operation openai_op NOT NULL,
  article_id TEXT,
  tokens_used INT NOT NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. OpenAI Client (`scripts/lib/openai-client.js`)
- **Entity Extraction:** GPT-4o-mini extracts top-5 entities per article
  - Example: `{id: "US-TRUMP", name: "Donald Trump", type: "PERSON", confidence: 0.95}`
- **Embedding Generation:** ada-002 creates 1536-dimensional semantic vectors
- **Rate Limiting:** Token bucket algorithm (60 req/min)
- **Cost Tracking:** Records every API call to `openai_usage` table
- **Budget Enforcement:** Blocks requests if daily spend exceeds $50

#### 3. Extraction Utilities (`scripts/lib/extraction-utils.js`)
All local processing (no API calls, $0 cost):
- **URL Canonicalization:** Strip UTM params, normalize protocol
- **Artifact Detection:** Find PDFs, Federal Register docs, press releases
- **Keyphrase Extraction:** TF-IDF algorithm, top 10 phrases
- **Geography Extraction:** Pattern matching for US states, cities, countries
- **Content Cleaning:** Remove boilerplate, normalize quotes

#### 4. Backfill Script (`scripts/backfill-clustering-v2.js`)
- Processes articles OLDEST → NEWEST (builds stable centroids)
- Batches of 25 (rate limit compliance)
- Pauses every 100 articles for index refresh
- Dry-run mode for testing

### Testing Results
- ✅ Migration 022 applied to TEST database
- ✅ Tested on 5 sample articles successfully
- ✅ 4/5 articles extracted with full metadata
- ✅ JSON parsing bug fixed (markdown code fences)
- ✅ Cost tracking operational

### Cost Analysis (Phase 1)

| Operation | Model | Tokens | Cost |
|-----------|-------|--------|------|
| Entity extraction | gpt-4o-mini | ~800 | $0.00020 |
| Embedding | ada-002 | ~200 | $0.00005 |
| **Total per article** | | | **$0.00025** |

**Scaling:**
- Current volume (62 articles/day): **$0.47/month**
- At scale (1000 articles/day): **$7.50/month**
- Budget status: ✅ **Well under $50/month limit**

**Cost Caps & Guards (Expert Review Fix #3):**
- **Pipeline cap (clustering metadata):** $5/day
- **Global project cap:** $50/month
- **Halt job after:** 3 consecutive failures OR when cap reached
- **Require manual resume** after halt
- **Telemetry:** Write per-call tokens/cost to `openai_usage`
- **Dashboard:** Show 24h & 30d totals in admin dashboard

---

## Phase 2: Hybrid Scoring Implementation 🔄 NEXT UP

**JIRA:** TTRC-230  
**Status:** To Do  
**Estimated Time:** 4-5 days  
**Cost:** $0 (scoring logic only, no API calls)

### Objective
Implement weighted scoring formula that determines if articles belong to the same story.

### 1. Weighted Scoring Formula

```javascript
score = 0.40 × cosine_similarity(embeddings)        // Semantic meaning
      + 0.25 × jaccard_similarity(entities)         // Who/what overlap
      + 0.15 × cosine_similarity(title_tfidf)       // Title similarity
      + 0.10 × time_decay_factor                    // Recency bonus
      + 0.05 × jaccard_similarity(keyphrases)       // Topic overlap
      + 0.05 × geo_overlap_score                    // Location match
      + bonuses                                      // Special signals

// Bonuses
+ 0.06 if shared artifacts (same PDF/FR doc)
+ 0.05 if quote matches (presser detection)
+ 0.04 if same media outlet
```

**Rationale for weights:**
- **Embeddings (40%):** Most reliable signal, captures semantic similarity
- **Entities (25%):** Strong indicator of topic overlap (Trump, DOJ, etc.)
- **Title (15%):** Headlines often rewritten, but still useful
- **Time (10%):** Recency matters for breaking news
- **Keyphrases (5%):** Additional topic signal
- **Geography (5%):** Location context

### 2. Adaptive Thresholds by Content Type

Different content types need different clustering sensitivity:

| Content Type | Threshold | Reason |
|--------------|-----------|--------|
| Wire/syndicated | 0.58 | Looser - many rewrites of same event |
| Opinion/analysis | 0.66 | Stricter - unique perspectives |
| Policy docs/EOs | 0.62 | Medium - shared source docs |

**Detection logic:**
```javascript
function getThreshold(article) {
  // Wire services: AP, Reuters, AFP
  if (WIRE_DOMAINS.includes(article.source_domain)) return 0.58;
  
  // Opinion category
  if (article.category === 'opinion') return 0.66;
  
  // Has policy artifacts (PDFs, FR docs)
  if (article.artifact_urls.length > 0) return 0.62;
  
  return 0.60; // Default
}
```

### 3. Candidate Generation (OR-Blocking)

**Goal:** Find 50-200 candidate stories in <100ms

**Strategy:** Use OR-blocking with 3 methods (production-ready SQL)
```sql
-- Production-ready candidate generation query
WITH time_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE time_range && tstzrange(NOW() - INTERVAL '72 hours', NOW())
    AND lifecycle_state IN ('emerging','growing','stable')
),
entity_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE top_entities && :article_entity_ids  -- ARRAY['US-TRUMP','US-DOJ']
),
ann_block AS (
  SELECT id, centroid_embedding_v1, top_entities
  FROM stories
  WHERE centroid_embedding_v1 IS NOT NULL
  ORDER BY centroid_embedding_v1 <=> :article_embedding_v1
  LIMIT 60
)
SELECT DISTINCT ON (id) *
FROM (
  SELECT * FROM time_block
  UNION ALL
  SELECT * FROM entity_block
  UNION ALL
  SELECT * FROM ann_block
) c
LIMIT 200;
```

**Performance:**
- HNSW index provides sub-50ms ANN search
- GIN index enables fast entity overlap queries
- Total candidate generation: <100ms (p95)

### 4. Centroid Tracking

Track story centroids for incremental updates:

```sql
-- New columns in stories table (Migration 022.1)
ALTER TABLE stories ADD COLUMN centroid_embedding_v1 vector(1536);
ALTER TABLE stories ADD COLUMN entity_counter jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stories ADD COLUMN top_entities text[] NOT NULL DEFAULT ARRAY[]::text[];
```

**Dual update strategy:** Running average (real-time) + Nightly exact recompute

**Real-time update (in application):**
```javascript
async function updateCentroid(story, newArticle) {
  // Running average of embeddings (fast, slight drift)
  const n = story.article_count;
  const centroid = story.centroid_embedding;
  const newEmbedding = newArticle.embedding_v1;

  const updatedCentroid = centroid.map((val, i) =>
    (val * n + newEmbedding[i]) / (n + 1)
  );

  // Update entity frequencies
  const entityCounter = story.entity_counter || {};
  for (const entity of newArticle.entities) {
    entityCounter[entity.id] = (entityCounter[entity.id] || 0) + 1;
  }

  // Sync top_entities from entity_counter (for GIN filtering)
  const topEntities = Object.entries(entityCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  await supabase
    .from('stories')
    .update({
      centroid_embedding_v1: updatedCentroid,
      entity_counter: entityCounter,
      top_entities: topEntities
    })
    .eq('id', story.id);
}
```

**Nightly recompute (SQL job at 2am):**
```sql
-- Fixes drift from running averages
CREATE OR REPLACE FUNCTION recompute_story_centroids()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE stories s
  SET
    centroid_embedding_v1 = agg.exact_centroid,
    entity_counter = agg.counter,
    top_entities = agg.top5
  FROM (
    SELECT
      st.id,
      AVG(a.embedding_v1) AS exact_centroid,  -- pgvector supports AVG
      jsonb_object_agg(...) AS counter,
      ARRAY(...) AS top5
    FROM stories st
    JOIN article_story asg ON asg.story_id = st.id
    JOIN articles a ON a.id = asg.article_id
    GROUP BY st.id
  ) agg
  WHERE s.id = agg.id;
END;
$$;
```

### 5. Integration with Job Queue

**Modify `scripts/job-queue-worker.js`:**
- Replace broken `pg_trgm` similarity with hybrid scoring
- Update `story.cluster` job type to use new algorithm
- Ensure enrichment still runs after clustering

### Acceptance Criteria
- [ ] Scoring function returns values 0.0-1.0
- [ ] All 6 scoring components implemented
- [ ] Adaptive thresholds apply correctly
- [ ] Candidate generation <100ms
- [ ] Centroid updates incrementally
- [ ] Unit tests for scoring logic
- [ ] Integration test: 10 articles cluster correctly

---

## Phase 3: Clustering Engine 📋 PLANNED

**JIRA:** TTRC-231  
**Status:** To Do  
**Estimated Time:** 3-4 days  
**Cost:** $0 (uses existing embeddings)

### Objective
Implement online greedy clustering algorithm with story lifecycle management.

### 1. Online Greedy Clustering

**Algorithm:**
```javascript
async function clusterArticle(article) {
  // 1. Generate candidates (50-200 stories)
  const candidates = await generateCandidates(article);
  
  // 2. Score each candidate using hybrid formula
  const scores = candidates.map(story => ({
    story,
    score: hybridScore(article, story)
  }));
  
  // 3. Find best match
  const best = scores.sort((a, b) => b.score - a.score)[0];
  
  // 4. Assign if above threshold, else create new story
  const threshold = getThreshold(article);
  if (best && best.score >= threshold) {
    await attachToStory(article, best.story);
    await updateCentroid(best.story, article);
  } else {
    await createNewStory(article);
  }
}
```

### 2. Story Lifecycle States

**States:**
- **Emerging** (0-6 hours): Breaking news, high activity
- **Growing** (6-48 hours): Developing story, moderate activity
- **Stable** (48-120 hours): Mature story, low activity
- **Stale** (5+ days): Old news, locked unless strong follow-up (score >0.80)

**Automatic transitions:**
```sql
CREATE FUNCTION update_story_lifecycle_states() RETURNS void AS $$
  UPDATE stories SET lifecycle_state = CASE
    WHEN last_updated_at > NOW() - INTERVAL '6 hours' THEN 'emerging'
    WHEN last_updated_at > NOW() - INTERVAL '48 hours' THEN 'growing'
    WHEN last_updated_at > NOW() - INTERVAL '120 hours' THEN 'stable'
    ELSE 'stale'
  END
$$ LANGUAGE sql;
```

### 3. Auto-Split Detection

**When to split:**
- Internal coherence drops below 0.50
- New articles consistently score <0.40 with existing story
- Time gap >10 days (unless strong follow-up)

**Calculation:**
```javascript
async function calculateInternalCoherence(story) {
  const articles = await getArticlesInStory(story.id);
  let totalScore = 0;
  let comparisons = 0;
  
  // Pairwise similarity (sample if >20 articles)
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      totalScore += cosineSimilarity(
        articles[i].embedding_v1,
        articles[j].embedding_v1
      );
      comparisons++;
    }
  }
  
  return totalScore / comparisons;  // Median pairwise score
}
```

### 4. Periodic Merge Detection

**Job:** `story.merge` (runs daily at 2am)

**Merge conditions:**
- Two stories with coherence >0.70
- Share 3+ entities
- Within 5-day time window
- Same primary actor

### New Job Types
- `story.cluster` - Cluster single article (real-time)
- `story.cluster.batch` - Batch clustering (backfill)
- `story.lifecycle` - Update lifecycle states (hourly)
- `story.merge` - Detect and merge stories (daily)
- `story.split` - Auto-split detection (on-demand)

### Acceptance Criteria
- [ ] Articles assign to correct stories (>85% accuracy)
- [ ] New stories created when no match (>90% precision)
- [ ] Story lifecycle states update automatically
- [ ] Auto-split triggers when coherence drops
- [ ] Clustering completes in <500ms (p95)

---

## Phase 4: Admin & Monitoring 📋 PLANNED

**JIRA:** TTRC-232  
**Status:** To Do  
**Estimated Time:** 4-5 days  
**Cost:** $0 (admin tooling only)

### Objective
Build admin tools for manual intervention and quality monitoring.

### 1. Near-Duplicate Detection

**SimHash Hamming distance ≤3 bits ≈ 90%+ similarity:**
```javascript
async function detectDuplicates(article) {
  // Fast exact match on simhash
  const { data: exact } = await supabase
    .from('articles')
    .select('id, source_domain, published_at, text_simhash')
    .eq('text_simhash', article.text_simhash)
    .neq('id', article.id)
    .limit(50);

  // Verify Hamming distance
  const duplicates = exact.filter(c => {
    const hammingDist = countBits(article.text_simhash ^ c.text_simhash);
    return hammingDist <= 3;  // ≤3 bits = 90%+ similar
  });

  return duplicates;
}
```

**Note:** `text_simhash` (full-text duplicate detection) is separate from `quote_hashes` (presser detection)

**Actions:**
- Mark as duplicate in database
- Link to canonical article
- Exclude from story source count

### 2. Manual Admin Actions

**API endpoints:**
```javascript
POST /admin/stories/merge      // Merge two stories
POST /admin/stories/split      // Split story into two
POST /admin/stories/move-article  // Move article between stories
```

**Audit trail:**
```sql
CREATE TABLE story_admin_actions (
  id BIGSERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,  -- 'merge', 'split', 'move'
  story_id BIGINT,
  article_id TEXT,
  reason TEXT,
  performed_by TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. B-cubed F1 Evaluation

**Metrics:**
- **Precision:** Are articles in same story actually related?
- **Recall:** Are related articles clustered together?
- **F1 Score:** Harmonic mean of precision/recall
- **Target:** ≥0.89 (from expert recipe)

**Calculation method:**
```javascript
// Sample 100 random articles
// For each article:
//   - Precision = % of same-story articles that truly belong
//   - Recall = % of true same-story articles that are clustered
// Average across all articles
```

### 4. Quality Dashboard

**Metrics to display:**
- Total stories (by lifecycle state)
- Average articles per story
- Internal coherence distribution
- Manual intervention rate (merges/splits per day)
- B-cubed F1 score (updated weekly)
- Clustering latency (p50, p95, p99)
- API cost per article

### 5. Documentation

**Admin guide:**
- How to merge/split stories
- When to intervene manually
- How to interpret quality metrics

**Developer guide:**
- Clustering algorithm overview
- Scoring formula explained
- How to tune thresholds

### Acceptance Criteria
- [ ] Duplicate detection identifies 90%+ of syndicated content
- [ ] Manual merge/split actions work
- [ ] B-cubed F1 dashboard shows accurate metrics
- [ ] Quality dashboard displays real-time stats
- [ ] Admin documentation complete

---

## Success Metrics

### Clustering Quality
- **Precision:** ≥0.90 (articles in same story truly related)
- **Recall:** ≥0.85 (related articles cluster together)
- **F1 Score:** ≥0.89 (harmonic mean)
- **Manual intervention:** <5% of stories need manual action

### Performance (Operational SLOs)
- **Clustering latency:** p50 <200ms, p95 <500ms, p99 <1000ms per article
- **Candidate generation:** <100ms (p95)
- **Index refresh lag:** <5 minutes (pgvector HNSW)
- **Centroid update latency:** <50ms per article
- **Manual interventions/story (7-day):** <5%
- **Support:** 1000+ articles/day

### Cost
- **Current volume:** $0.47/month (62 articles/day)
- **At scale:** $7.50/month (1000 articles/day)
- **Pipeline cap:** $5/day (clustering metadata only)
- **Global cap:** $50/month (all operations)
- **Budget:** ✅ Well under caps

---

## Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| API costs exceed budget | Low | High | Cache embeddings, daily limits, cost tracking |
| Over-merging (false positives) | Medium | Medium | Start with stricter thresholds, tune based on metrics |
| Under-merging (false negatives) | Medium | Low | Periodic merge job catches missed clusters |
| Performance degradation | Low | Medium | HNSW indexes, candidate limits, profiling |
| Tuning complexity | Medium | Low | Test suite, A/B testing, rollback plan |

---

## Testing Strategy

### Unit Tests
- Scoring function components (cosine, Jaccard, etc.)
- Threshold logic by content type
- Edge cases (null values, empty arrays)

### Integration Tests
- Feed 50 labeled articles
- Verify clustering accuracy
- Check centroid updates
- Measure latency

### Quality Evaluation
- Manual labeling of 300 clusters
- B-cubed F1 calculation
- Precision/recall breakdown

### A/B Testing
- 10% traffic for 1 week
- Compare metrics vs. current system
- Full rollout or rollback based on F1 score

---

## Rollout Plan

### Week 1: Phase 1 (Complete ✅)
- Deploy extraction infrastructure
- Backfill existing 180 articles
- Verify metadata quality

### Week 2: Phase 2
- Deploy hybrid scoring (feature flag)
- Test on sample articles
- Tune thresholds

### Week 3: Phase 3
- Deploy clustering engine
- Monitor story formation
- A/B test 10% traffic

### Week 4: Phase 4
- Deploy admin tools
- Train on labeled clusters
- Full rollout or rollback

---

## Dependencies

### Infrastructure
- ✅ Supabase TEST database (PostgreSQL 15+)
- ✅ pgvector extension installed
- ✅ OpenAI API key configured
- ✅ Node.js 18+ environment

### Data
- ✅ 180 existing articles in TEST
- ✅ 86 active stories (currently all source_count=1)
- ✅ 6 active RSS feeds

### Team Skills
- SQL (for RPC functions, indexes)
- JavaScript/Node.js (for workers, API)
- Vector databases (pgvector, HNSW)
- OpenAI API (embeddings, chat completions)

---

## Files Changed/Created

### Phase 1 (Complete)
- `migrations/022_clustering_v2_schema.sql` ✅
- `scripts/lib/openai-client.js` ✅
- `scripts/lib/extraction-utils.js` ✅
- `scripts/backfill-clustering-v2.js` ✅
- `scripts/inspect-extractions.js` ✅

### Phase 2 (Next)
- `scripts/rss/scoring.js` (new)
- `scripts/rss/candidate-generation.js` (new)
- `scripts/rss/centroid-tracking.js` (new)
- `migrations/023_centroid_tracking.sql` (new)
- `scripts/job-queue-worker.js` (modify)
- `tests/scoring.test.js` (new)

### Phase 3 (Planned)
- `scripts/rss/clustering.js` (new)
- `scripts/rss/lifecycle.js` (new)
- `scripts/rss/auto-split.js` (new)
- `scripts/rss/periodic-merge.js` (new)
- `migrations/024_lifecycle_states.sql` (new)

### Phase 4 (Planned)
- `scripts/admin/detect-duplicates.js` (new)
- `scripts/admin/merge-stories.js` (new)
- `scripts/admin/split-stories.js` (new)
- `scripts/admin/calculate-bcubed.js` (new)
- `public/admin/clustering-dashboard.html` (new)
- `docs/admin-guide.md` (new)

---

## Questions for Review (Answered by Expert Review)

1. **Threshold values:** ✅ **Start stricter (+0.02), relax after tuning**
   - Wire: **0.60** → relax to 0.58 after week 1
   - Opinion: **0.68** → relax to 0.66 after validation
   - Policy: **0.64** → relax to 0.62 if needed

2. **Centroid update strategy:** ✅ **Running average (real-time) + nightly exact recompute**
   - Fast updates during article assignment
   - Nightly job fixes drift from approximations

3. **Stale story exceptions:** ✅ **score ≥0.80 AND (≥2 entities OR shared artifact)**
   - Prevents topical hop-ons
   - Requires strong connection beyond just semantic similarity

4. **B-cubed F1 target:** ✅ **0.85 week 1 target, 0.89 after tuning**
   - More realistic ramp-up
   - Allows for threshold adjustments

5. **Manual intervention rate:** ✅ **<5% acceptable, track per story AND per 100 articles**
   - If >5% sustained for 7 days, tighten thresholds
   - Dashboard shows 24h/7d/30d trends

6. **Candidate generation:** ✅ **≤200 total post-union**
   - Time block: ~40 candidates
   - Entity block: ~100 candidates
   - ANN block: 60 candidates
   - Total: 50-200 depending on overlap
   - Keeps recall high without hurting latency

---

## References

- **Expert Recipe:** `docs/Love this problem. Here's a battle-.md` (external clustering expert)
- **Phase 1 Handoff:** `docs/handoffs/2025-10-12-ttrc-225-phase-1-complete.md`
- **Current Clustering:** `scripts/rss/clustering.js` (broken pg_trgm system)
- **JIRA Epic:** [TTRC-225](https://ajwolfe37.atlassian.net/browse/TTRC-225)
- **Child Stories:** TTRC-229 (Phase 1), TTRC-230 (Phase 2), TTRC-231 (Phase 3), TTRC-232 (Phase 4)

---

**Document Version:** 1.0  
**Last Updated:** 2025-10-12  
**Author:** Claude Code + Josh (PM)  
**Status:** Ready for Review

# TTRC-225 Expert Review Feedback - Required Fixes

**Date:** 2025-10-12  
**Reviewer:** Expert SQL/Clustering Engineer  
**Status:** All feedback incorporated into next working session plan

---

## Executive Summary

Expert review identified **10 critical fixes** needed before Phase 2 implementation. All feedback is valid and improves production-readiness. These should be applied in next session before starting Phase 2 work.

**Status:** ✅ All feedback analyzed and agreed upon  
**Action:** Apply fixes in Migration 022.1 or integrate into Phase 2 kickoff

---

## Top 10 Fixes (All Agreed ✅)

### 1. ✅ Stories Lifecycle SQL - ALREADY FIXED
**Issue:** Lifecycle function references `updated_at` / `last_updated_at` columns that don't exist  
**Status:** **Already correct in Migration 022!**  
- Uses `upper(time_range)` → `MAX(articles.published_at)` → `first_seen_at` fallback
- No action needed ✅

---

### 2. ✅ Add `top_entities` Column to Stories
**Issue:** Candidate generation filters `stories.entities` but only `entity_counter` exists  
**Fix:** Add `top_entities text[]` for fast GIN filtering

```sql
-- Add to Migration 022
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS top_entities text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS ix_stories_top_entities_gin 
  ON stories USING gin (top_entities);
```

**App responsibility:** Keep synced when writing `entity_counter`

---

###3. ✅ Lock Cost Claims with Caps & Guards
**Issue:** Plan shows ranges but no explicit caps or halt logic  
**Fix:** Add explicit guardrails to plan and `openai-client.js`

**Updated Cost Section:**
```markdown
**Costs & Caps**
- Per article (entities + embedding): **$0.0002–$0.0005** (0.02–0.05¢)
- Current volume (≈62/day): **$0.30–$0.90/month**
- At 1000/day: **$6–$15/month**

**Caps & Guards**
- Pipeline cap (clustering metadata): **$5/day**
- Global project cap: **$50/month**
- Halt job after **3 consecutive failures** or when cap reached
- Require manual resume after halt
- Telemetry: write per-call tokens/cost to `openai_usage`
- Show 24h & 30d totals in admin dashboard
```

**Implementation:** Update `openaiClient.checkBudget()` to enforce $5/day pipeline cap

---

### 4. ✅ Make New Columns Safe-by-Default
**Issue:** Columns without DEFAULT will require null checks everywhere  
**Fix:** Add `NOT NULL DEFAULT` to all new array/jsonb columns

```sql
-- Add to Migration 022
ALTER TABLE articles
  ALTER COLUMN entities       SET NOT NULL DEFAULT '[]'::jsonb,
  ALTER COLUMN keyphrases     SET NOT NULL DEFAULT ARRAY[]::text[],
  ALTER COLUMN quote_hashes   SET NOT NULL DEFAULT ARRAY[]::bigint[],
  ALTER COLUMN artifact_urls  SET NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE stories
  ALTER COLUMN entity_counter SET NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN top_entities   SET NOT NULL DEFAULT ARRAY[]::text[];
```

---

### 5. ✅ Version Embeddings Explicitly (Already Done)
**Issue:** Need to clarify v2 strategy  
**Status:** Migration 022 already has `embedding_v1` + `embedding_model_v1`  
**Fix:** Add comment to schema

```sql
-- Add comment to Migration 022
COMMENT ON COLUMN articles.embedding_v1 IS 
  'OpenAI ada-002 embedding (1536 dim). Strategy: Keep v1 forever, add v2/v3 as new columns rather than rewriting';
```

---

### 6. ✅ Candidate Generation Needs Real SQL
**Issue:** Plan shows pseudocode, need production-ready query  
**Fix:** Add complete OR-blocking query with UNION ALL

```sql
-- Production-ready candidate generation
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

**Add to:** `scripts/rss/candidate-generation.js` in Phase 2

---

### 7. ✅ Centroid = Running Avg + Nightly Recompute
**Issue:** Need to handle drift from running averages  
**Fix:** Dual strategy for best of both worlds

**Real-time (in app):**
```javascript
// Fast running average
const updatedCentroid = centroid.map((val, i) => 
  (val * n + newEmbedding[i]) / (n + 1)
);

// Update top_entities from entity_counter
const topEntities = Object.entries(entityCounter)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([id]) => id);
```

**Nightly (SQL job at 2am):**
```sql
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

**Add to:** Phase 3 nightly job configuration

---

### 8. ✅ Add `text_simhash` Column for Duplicates
**Issue:** Plan references `simhash` column that doesn't exist  
**Current:** Only have `quote_hashes bigint[]` for presser detection  
**Fix:** Add separate `text_simhash bigint` for full-text duplicates

```sql
-- Add to Migration 022
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS text_simhash bigint;

CREATE INDEX IF NOT EXISTS ix_articles_text_simhash 
  ON articles (text_simhash) 
  WHERE text_simhash IS NOT NULL;
```

**Duplicate detection:**
```javascript
// Fast exact match
const { data: exact } = await supabase
  .from('articles')
  .select('id, source_domain, published_at')
  .eq('text_simhash', article.text_simhash)
  .neq('id', article.id)
  .limit(50);

// Verify Hamming distance
const duplicates = exact.filter(c => {
  const hammingDist = countBits(article.text_simhash ^ c.text_simhash);
  return hammingDist <= 3;  // ≤3 bits = 90%+ similar
});
```

**Note:** `quote_hashes` is separate - for presser detection, not full-text dedup

---

### 9. ✅ Add Missing Index for Story Queries
**Issue:** Missing `ix_article_story_story_id` needed for lifecycle + merge queries  
**Fix:** Add index

```sql
-- Add to Migration 022
CREATE INDEX IF NOT EXISTS ix_article_story_story_id 
  ON article_story (story_id);
```

**Used by:**
- Lifecycle state updates (LATERAL join to get MAX(published_at))
- Story merge detection
- Internal coherence calculation

---

### 10. ✅ Add Ops SLOs to Success Metrics
**Issue:** Missing operational metrics for monitoring  
**Fix:** Add to success metrics section

**Operational SLOs:**
```markdown
### Performance (Operational SLOs)
- **Clustering latency:** p50 <200ms, p95 <500ms, p99 <1000ms
- **Candidate generation:** <100ms (p95)
- **Index refresh lag:** <5 minutes (pgvector HNSW)
- **Centroid update latency:** <50ms per article
- **Manual interventions/story (7-day):** <5%
- **Support:** 1000+ articles/day
```

**Dashboard additions:**
- p95 assign latency gauge
- Index refresh lag histogram
- Manual intervention rate (per story, per 100 articles)

---

## Answers to "Questions for Review" (From Plan)

### 1. Threshold Values ✅
**Decision:** Start stricter (+0.02), relax after tuning
- Wire: **0.60** → relax to 0.58 after week 1
- Opinion: **0.68** → relax to 0.66 after validation
- Policy: **0.64** → relax to 0.62 if needed

**Rationale:** Easier to relax than fix over-merged stories

---

### 2. Centroid Strategy ✅
**Decision:** Running average (real-time) + nightly exact recompute
- Fast updates during article assignment
- Nightly job fixes drift from approximations

---

### 3. Stale Story Exceptions ✅
**Decision:** score ≥0.80 AND (≥2 entities OR shared artifact)
- Prevents topical hop-ons
- Requires strong connection beyond just semantic similarity

---

### 4. B-cubed F1 Target ✅
**Decision:** 0.85 week 1 target, 0.89 after tuning
- More realistic ramp-up
- Allows for threshold adjustments

---

### 5. Manual Intervention Rate ✅
**Decision:** <5% acceptable, track per story AND per 100 articles
- If >5% sustained for 7 days, tighten thresholds
- Dashboard shows 24h/7d/30d trends

---

### 6. Candidates Cap ✅
**Decision:** ≤200 total post-union
- Time block: ~40 candidates
- Entity block: ~100 candidates
- ANN block: 60 candidates
- Total: 50-200 depending on overlap
- Keeps recall high without hurting latency

---

## Implementation Checklist for Next Session

### Before Starting Phase 2:

- [ ] **Update Migration 022** with all fixes:
  - [ ] Add `top_entities text[]` to stories
  - [ ] Add `text_simhash bigint` to articles
  - [ ] Add NOT NULL DEFAULT to all new columns
  - [ ] Add `ix_stories_top_entities_gin` index
  - [ ] Add `ix_articles_text_simhash` index
  - [ ] Add `ix_article_story_story_id` index
  - [ ] Add comment about embedding versioning strategy

- [ ] **Update Implementation Plan**:
  - [ ] Replace pseudocode with real SQL for candidate generation
  - [ ] Add nightly centroid recompute section
  - [ ] Update cost section with caps & guards
  - [ ] Add ops SLOs to success metrics
  - [ ] Update threshold values (start stricter)
  - [ ] Add stale story exception enhancement
  - [ ] Update "Questions for Review" with decisions

- [ ] **Update `scripts/lib/openai-client.js`**:
  - [ ] Add pipeline-specific daily cap ($5)
  - [ ] Add halt-on-3-failures logic
  - [ ] Update budget check to use pipeline cap

- [ ] **Test Migration 022.1**:
  - [ ] Apply updated migration to TEST database
  - [ ] Verify all indexes created
  - [ ] Verify defaults work correctly
  - [ ] Run backfill script to populate new columns

### During Phase 2:

- [ ] Implement real SQL candidate generation query
- [ ] Add top_entities sync when updating entity_counter
- [ ] Add text_simhash calculation to extraction pipeline
- [ ] Implement duplicate detection with Hamming distance

### During Phase 3:

- [ ] Add nightly centroid recompute job (cron at 2am)
- [ ] Implement lifecycle state updates with new thresholds
- [ ] Add stale story exception logic (score + entities)

---

## Files to Update

1. **`migrations/022_clustering_v2_schema.sql`** - Add all schema fixes
2. **`docs/implementation-plans/ttrc-225-clustering-v2-plan.md`** - Update with all changes
3. **`scripts/lib/openai-client.js`** - Add pipeline cap + halt logic
4. **`scripts/lib/extraction-utils.js`** - Add text_simhash calculation
5. **`scripts/rss/candidate-generation.js`** (Phase 2) - Real SQL query
6. **`scripts/rss/centroid-tracking.js`** (Phase 2) - top_entities sync
7. **`scripts/rss/periodic-recompute.js`** (Phase 3) - Nightly job

---

## Expert Feedback Summary

**Overall Assessment:** Excellent review that significantly improves production-readiness

**Key Themes:**
1. **Safety:** NOT NULL DEFAULT prevents null checks
2. **Performance:** Missing indexes added
3. **Accuracy:** Nightly recompute fixes drift
4. **Operations:** Clear SLOs and monitoring
5. **Cost Control:** Explicit caps and halt logic

**All 10 fixes agreed and ready to implement.**

---

**Next Steps:**
1. Take a break ☕
2. Return to apply Migration 022 fixes
3. Update implementation plan
4. Begin Phase 2 with clean foundation

---

**Document Status:** Ready for next session  
**Estimated Fix Time:** 30-45 minutes to apply all changes  
**Risk Level:** Low (additive changes only, no breaking modifications)

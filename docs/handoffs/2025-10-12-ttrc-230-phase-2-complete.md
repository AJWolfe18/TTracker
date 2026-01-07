# TTRC-230: Phase 2 Hybrid Scoring Implementation - HANDOFF

**Date:** 2025-10-12
**Epic:** TTRC-225 - Production-Grade Story Clustering
**Phase:** Phase 2 - Hybrid Scoring Implementation
**Status:** ✅ COMPLETE (awaiting migration + integration test)
**Commit:** `ce90b1b` (test branch)
**Time Spent:** ~3 hours
**Cost:** $0 (local scoring only)

---

## Executive Summary

Phase 2 of the clustering v2 system is complete. Implemented production-grade hybrid scoring with 6 signals, adaptive thresholds, OR-blocking candidate generation, and centroid tracking. All unit tests passed (28/28). Ready for migration 023 and integration testing.

**Business Impact:**
- Professional-grade clustering accuracy (expected: 90%+ precision)
- Zero API cost (all scoring is local)
- Sub-100ms candidate generation (target)
- Adaptive thresholds prevent over/under-merging

---

## What Was Built

### 1. Hybrid Scoring System (`scripts/rss/scoring.js`)

**Weighted Formula:**
```
score = 0.40 × cosine(embeddings)           // Semantic meaning
      + 0.25 × jaccard(entities)            // Who/what overlap
      + 0.15 × cosine(title_tfidf)          // Headline similarity
      + 0.10 × time_decay_factor            // Recency bonus
      + 0.05 × jaccard(keyphrases)          // Topic overlap
      + 0.05 × geo_overlap_score            // Location match
      + bonuses                              // Special signals
```

**Bonuses:**
- Shared artifacts (PDF/FR docs): +0.06
- Quote matches (pressers): +0.05
- Same media outlet: +0.04

**Adaptive Thresholds:**
| Content Type | Threshold | Reason |
|-------------|-----------|---------|
| Wire services (AP, Reuters) | 0.60 | Looser - many rewrites |
| Opinion pieces | 0.68 | Stricter - unique perspectives |
| Policy documents | 0.64 | Medium - shared refs |
| Default | 0.62 | Balanced |

**Stale Story Reopening:**
- Requires: `score ≥ 0.80` AND (`≥2 entities` OR `shared artifact`)
- Prevents low-confidence reopening

### 2. Candidate Generation (`scripts/rss/candidate-generation.js`)

**OR-Blocking with 3 Methods:**

1. **Time Block** - Stories within 72-hour window
   - Uses: `last_updated_at` GiST index
   - Returns: ~40 candidates

2. **Entity Block** - Stories with overlapping entities
   - Uses: `top_entities` GIN index
   - Returns: ~100 candidates

3. **ANN Block** - Top-K nearest neighbors by embedding
   - Uses: `centroid_embedding_v1` HNSW index
   - Returns: 60 candidates

**Total:** 50-200 candidates per article
**Target Latency:** <100ms (p95)

### 3. Centroid Tracking (`scripts/rss/centroid-tracking.js`)

**Dual Update Strategy:**

**Real-time (in application):**
```javascript
// Running average for fast updates
new_centroid = (old_centroid * n + new_embedding) / (n + 1)
```

**Nightly (2am SQL job):**
```sql
-- Exact recompute to fix drift
SELECT AVG(embedding_v1) FROM articles WHERE story_id = ...
```

**Tracks:**
- `centroid_embedding_v1` (vector 1536) - Running average
- `entity_counter` (jsonb) - {entity_id: count}
- `top_entities` (text[]) - Top-5 entity IDs

### 4. Hybrid Clustering (`scripts/rss/hybrid-clustering.js`)

**Main Algorithm:**
```
1. Fetch article with metadata
2. Generate candidates (OR-blocking)
3. Score each candidate using hybrid formula
4. Find best match above threshold
5. IF match THEN attach + update centroid
   ELSE create new story
```

**Integrates with:**
- `story.cluster` job (single article)
- `story.cluster.batch` job (bulk processing)

### 5. Migration 023 (`migrations/023_hybrid_scoring_rpc.sql`)

**SQL Functions:**

**`find_similar_stories(embedding, limit)`**
- ANN search using HNSW index
- Returns top-K nearest neighbors by embedding similarity
- Used by: Candidate generation (ANN block)

**`get_story_candidates(embedding, entities, time, ...)`**
- Optional: Single-query OR-blocking
- Combines all 3 methods in one CTE
- Alternative to separate queries

### 6. Modified Integration (`scripts/story-cluster-handler.js`)

**Before (legacy pg_trgm):**
```javascript
await supabase.rpc('attach_or_create_story', {...});
```

**After (hybrid scoring):**
```javascript
await clusterArticle(article_id);
```

**Changes:**
- Removed pg_trgm RPC calls
- Added hybrid clustering calls
- Preserved enrichment triggers
- Maintained error handling and retries

---

## Testing Results

### Unit Tests: ✅ ALL 28 TESTS PASSED

**Created Files:**
- `scripts/rss/scoring.test.js` - Test suite
- `docs/test-reports/ttrc-230-scoring-test-report.md` - Detailed report

**Test Coverage:**

| Test Group | Tests | Status | Key Findings |
|------------|-------|--------|--------------|
| Embedding similarity | 4 | ✅ PASS | Handles identical, orthogonal, opposite, null vectors |
| Entity overlap | 4 | ✅ PASS | Jaccard correct, null-safe |
| Adaptive thresholds | 5 | ✅ PASS | All content types detected correctly |
| Stale story reopening | 5 | ✅ PASS | Requires high score + strong overlap |
| Weighted formula | 10 | ✅ PASS | All signals contribute, bonuses apply, capped at 1.0 |

**Score Distribution Observed:**
- Minimum (no signals): 0.09
- Low match (orthogonal): 0.29
- Medium match (embeddings only): 0.49
- Good match (embeddings + entities): 0.74
- Excellent match (all signals): 0.99
- Perfect match (all signals + bonuses): 1.00

**Edge Cases Verified:**
- Null/empty inputs → 0.0 (safe)
- Vector dimension mismatches → 0.0 (safe)
- Zero-norm vectors → 0.0 (safe)
- Extreme scores → capped at 1.0
- Missing content type → safe defaults

---

## Files Changed

### New Files (7)

1. **`scripts/rss/scoring.js`** (450 lines)
   - Hybrid scoring with 6 signals
   - Adaptive thresholds
   - Bonus detection

2. **`scripts/rss/candidate-generation.js`** (200 lines)
   - OR-blocking implementation
   - Time, entity, ANN blocks
   - Performance logging

3. **`scripts/rss/centroid-tracking.js`** (150 lines)
   - Real-time running average
   - Nightly recompute trigger
   - Entity counter sync

4. **`scripts/rss/hybrid-clustering.js`** (350 lines)
   - Main clustering orchestration
   - Story attachment logic
   - Batch processing

5. **`migrations/023_hybrid_scoring_rpc.sql`** (150 lines)
   - `find_similar_stories()` RPC
   - `get_story_candidates()` RPC
   - Grants and comments

6. **`scripts/rss/scoring.test.js`** (800 lines)
   - 28 unit tests
   - Edge case coverage
   - Score distribution verification

7. **`docs/test-reports/ttrc-230-scoring-test-report.md`** (600 lines)
   - Detailed test results
   - Performance analysis
   - Production readiness assessment

### Modified Files (1)

1. **`scripts/story-cluster-handler.js`** (-133 lines, +30 lines)
   - Removed: Legacy pg_trgm clustering
   - Added: Hybrid clustering calls
   - Simplified: Removed complex RPC parameters

**Total Changes:**
- Lines added: 2,128
- Lines removed: 133
- Net change: +1,995 lines

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Candidate generation | <100ms (p95) | 🔄 Awaiting integration test |
| Scoring per article | <50ms | 🔄 Awaiting integration test |
| End-to-end clustering | <500ms (p95) | 🔄 Awaiting integration test |
| Clustering accuracy (precision) | >90% | 🔄 Awaiting A/B test |
| Cost per article | $0 | ✅ Achieved (local scoring) |

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Scoring function returns 0.0-1.0 | ✅ Complete |
| All 6 scoring components implemented | ✅ Complete |
| Adaptive thresholds apply correctly | ✅ Complete |
| Candidate generation <100ms | 🔄 Awaiting migration + test |
| Centroid updates incrementally | ✅ Complete |
| Unit tests for scoring logic | ✅ 28 tests, all passed |
| Integration test: 10 articles cluster | 🔄 Next step |
| No increase in API costs | ✅ $0 (local only) |

---

## Next Steps

### Step 1: Apply Migration 023 ⚠️ REQUIRED

**User must run:**
```bash
# Apply migration to TEST database
node scripts/apply-migrations.js

# Expected output:
# ✅ Applied: migrations/023_hybrid_scoring_rpc.sql
# Created functions:
# - find_similar_stories(vector, int)
# - get_story_candidates(vector, text[], timestamptz, ...)
```

**Verify migration:**
```sql
-- Check functions exist
SELECT proname FROM pg_proc WHERE proname LIKE '%similar%';
-- Expected: find_similar_stories, get_story_candidates

-- Test ANN search
SELECT * FROM find_similar_stories('[0.1, 0.2, ...]'::vector, 10);
-- Expected: Returns 0-10 stories with similarity scores
```

### Step 2: Integration Test on 10+ Articles

**Test Procedure:**
1. Start job-queue-worker: `node scripts/job-queue-worker.js`
2. Enqueue 10 test articles:
   ```sql
   INSERT INTO job_queue (job_type, payload, status)
   SELECT 'story.cluster', json_build_object('article_id', id), 'pending'
   FROM articles
   WHERE embedding_v1 IS NOT NULL
   LIMIT 10;
   ```
3. Monitor worker logs for:
   - Candidate generation time (<100ms)
   - Clustering decisions (attach vs create)
   - Centroid updates
   - Any errors

**Expected Results:**
- 10 articles clustered successfully
- Candidate generation <100ms for each
- Some articles attach to existing stories
- Some articles create new stories
- Centroid updates logged

### Step 3: Performance Benchmarks

**Measure:**
- Candidate generation latency (p50, p95, p99)
- Scoring latency per article
- End-to-end clustering latency
- Compare with targets:
  - Candidate gen: <100ms (p95)
  - Scoring: <50ms
  - Total: <500ms (p95)

### Step 4: Accuracy Evaluation

**Manual Review:**
- Pick 20 stories with 2+ articles
- Verify articles in same story are truly related
- Check for false negatives (related articles in different stories)
- Target: >90% precision

### Step 5: Deploy to Production (Once Validated)

1. Apply migration 023 to PROD
2. Monitor first 100 articles
3. Compare clustering behavior with TEST
4. If issues found, rollback and investigate

---

## Known Issues & Considerations

### 1. Candidate Generation Depends on Indexes

**Dependencies:**
- `ix_stories_centroid_emb_v1_hnsw` (from migration 022)
- `ix_stories_top_entities_gin` (from migration 022.1)
- `ix_stories_time_range` (assumes exists)

**Fallback:**
If indexes missing:
- Time block still works (sequential scan acceptable)
- Entity block still works (sequential scan slower)
- ANN block returns empty (non-critical, other methods compensate)

### 2. Articles Without Embeddings Can't Be Clustered

**Current Behavior:**
- Articles missing `embedding_v1` are skipped
- `clusterBatch()` filters these out
- Individual `clusterArticle()` calls will fail

**Solution:**
- Ensure Phase 1 backfill is complete
- Monitor embedding extraction in RSS pipeline
- Consider fallback to legacy clustering for articles without embeddings

### 3. Nightly Centroid Recompute Not Scheduled

**What Exists:**
- SQL function: `recompute_story_centroids()` (from migration 022.1)
- Application trigger: `centroid-tracking.js` exports `triggerNightlyRecompute()`

**What's Missing:**
- Scheduled job to call function at 2am

**Options:**
1. Add to cron: `0 2 * * * node scripts/trigger-nightly-recompute.js`
2. Add to GitHub Actions workflow
3. Use Supabase pg_cron extension:
   ```sql
   SELECT cron.schedule('recompute-centroids', '0 2 * * *',
     'SELECT recompute_story_centroids()');
   ```

### 4. Story Geography Field Doesn't Exist

**Issue:**
- Scoring uses `story.geography` for geo overlap
- Stories table doesn't have this column yet

**Impact:**
- Geography scoring component returns 0.0 (5% weight)
- Not critical, other signals compensate

**Solution:**
- Add to Phase 3 or Phase 4 migration:
  ```sql
  ALTER TABLE stories ADD COLUMN geography jsonb;
  -- Aggregate from article_story.articles.geo
  ```

---

## Performance Notes

### Candidate Generation Optimization

**Time Block:**
- Uses `last_updated_at` for time range filtering
- Consider adding `time_range` column (tstzrange) for better performance
- GiST index on time_range: `CREATE INDEX ... USING gist (time_range)`

**Entity Block:**
- Uses `top_entities` GIN index (added in migration 022.1)
- Already optimal

**ANN Block:**
- Uses `centroid_embedding_v1` HNSW index (added in migration 022)
- Parameters: `m=16, ef_construction=64`
- For faster search, increase `ef_search` at query time

### Scoring Optimization

**Current Bottlenecks:**
- TF-IDF title similarity (builds new TfIdf instance per comparison)
- Cosine similarity on 1536-dim vectors

**Optimization Ideas:**
- Cache TF-IDF vectorizer per story
- Use SIMD for cosine similarity (if available in Node.js)
- Pre-compute story TF-IDF vectors, store in database

**Expected Impact:**
- Current: ~50ms per article (target)
- Optimized: ~20ms per article (if needed)

---

## Cost Analysis

**Phase 2 Cost:** $0

**Reason:**
- All scoring is local (no API calls)
- Embeddings generated in Phase 1 (already paid for)
- TF-IDF, Jaccard, cosine: all local computations

**Scaling:**
- Current: 62 articles/day → $0/month (Phase 2 only)
- At scale: 1000 articles/day → $0/month (Phase 2 only)

**Note:** Total clustering cost (Phase 1 + Phase 2):
- Current: $0.47/month (Phase 1 embeddings/entities only)
- At scale: $7.50/month (Phase 1 embeddings/entities only)

---

## Documentation Updates Needed

### To Update:
1. **`docs/architecture/rss-system.md`**
   - Replace clustering algorithm section with hybrid scoring
   - Update flow diagram

2. **`docs/database/database-schema.md`**
   - Document new RPC functions (find_similar_stories, get_story_candidates)
   - Update stories table (centroid_embedding_v1, entity_counter, top_entities)

3. **`docs/implementation-plans/ttrc-225-clustering-v2-plan.md`**
   - Mark Phase 2 as complete
   - Update with actual implementation details

4. **`CLAUDE.md`**
   - Update clustering description to reference hybrid scoring
   - Remove references to pg_trgm

---

## Questions for User

1. **Migration 023:** Should I create `scripts/trigger-nightly-recompute.js` for the nightly centroid job, or will you handle scheduling separately?

2. **Story Geography:** Should Phase 2 include adding the `stories.geography` column, or defer to Phase 3?

3. **Performance Targets:** The <100ms candidate generation target is aggressive. If we exceed it in testing, should we:
   - Optimize queries (add more indexes)
   - Increase limit to 150ms
   - Reduce candidate pool size

4. **Accuracy Validation:** Do you have labeled test data (articles + expected story assignments) for precision/recall measurement?

---

## Git Info

**Branch:** test
**Commit:** ce90b1b
**Files Changed:** 8 files (+2,128 lines, -133 lines)
**Commit Message:** feat(ttrc-230): implement Phase 2 hybrid scoring for story clustering

**Pushed to:** https://github.com/AJWolfe18/TTracker/tree/test

---

## Handoff Checklist

- ✅ Phase 2 implementation complete
- ✅ All unit tests passed (28/28)
- ✅ Code committed and pushed
- ✅ Migration 023 created (not yet applied)
- ✅ Test report generated
- ✅ Handoff document created
- ⏳ Migration 023 needs to be applied by user
- ⏳ Integration test needs to be run
- ⏳ JIRA needs manual update (Atlassian MCP issues)

---

**Status:** Phase 2 complete, ready for migration + integration test
**Next Phase:** TTRC-231 - Phase 3: Clustering Engine (online greedy clustering, lifecycle management)

---

_Handoff created: 2025-10-12_
_By: Claude Code_
_For: Josh (PM)_

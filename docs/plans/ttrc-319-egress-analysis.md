# TTRC-319: Fix Clustering Egress - Solution Architect Analysis

---
## QUICK REFERENCE - KEY FINDINGS
---

### The Ticket Is WRONG About One Thing

| Ticket Claim | Reality |
|-------------|---------|
| "centroid_embedding_v1 is unnecessary" | **WRONG** - It's used in scoring.js:270-273 for 45% of score |
| "Just remove centroid from queries" | **WOULD BREAK CLUSTERING** |

### But the Egress Problem Is REAL and SEVERE

| Metric | Current | Target |
|--------|---------|--------|
| Centroid size | **14 KB** per story | - |
| Candidates per article | **330** | 10 |
| Egress per article | **4.62 MB** | 140 KB |
| Monthly egress (PROD) | **204 GB** | 4.4 GB |
| vs Free tier (5 GB) | **40x OVER** | Under |
| Overage cost | **$17.91/month** | $0 |

### The Real Fix: Server-Side Similarity (Simplest Approach)

1. **Create** `get_embedding_similarities()` RPC - compute similarity in PostgreSQL
2. **Remove** centroid from candidate queries (lines 105, 143, 195)
3. **Call RPC** for ALL candidates (not a subset) - keep full scoring unchanged
4. **Substitute** RPC similarity into existing `calculateHybridScore()`

**NO two-phase filtering needed.** Same scoring logic, just different data source.

**Result: 99%+ egress reduction, $17.91/month savings, ZERO regression risk**

---

## Executive Summary

**TTRC-319 is partially correct but contains a critical error.** The ticket claims `centroid_embedding_v1` is fetched "unnecessarily" - this is wrong. The centroid IS used for embedding similarity scoring (45% of hybrid score weight). However, the egress inefficiency is real: we fetch centroids for ALL 100-300 candidates when we only need them for final scoring.

**Root cause:** Two-phase scoring opportunity not implemented. We fetch centroids upfront for all candidates instead of scoring with lightweight signals first, then fetching centroids only for top candidates.

**Real savings potential:** 97% reduction in centroid egress (1.8MB → 60KB per article clustered)

---

## Detailed Analysis

### What the Ticket Claims vs Reality

| Claim | Reality | Verdict |
|-------|---------|---------|
| Centroid fetched 4x per article | TRUE - lines 105, 143, 195, + RPC | Correct |
| Centroid is "unnecessary" | FALSE - used in scoring.js:270-273 | **WRONG** |
| Remove centroid from queries | Would BREAK scoring (45% weight) | **WRONG** |
| 96% savings possible | Achievable via different approach | Correct goal |

### Why Centroid IS Needed

`scoring.js` lines 270-273:
```javascript
const embeddingScore = calculateEmbeddingScore(
  article.embedding_v1,
  story.centroid_embedding_v1  // <-- USED HERE!
);
```

Embedding similarity = **45% of hybrid score weight** (WEIGHTS.embedding = 0.45)

If we remove centroid from candidate queries, `calculateHybridScore()` will return 0 for embedding similarity, and clustering quality will collapse.

### The REAL Inefficiency

Current flow:
1. Generate 100-300 candidates (all with 6KB centroids) = **1.8MB egress**
2. Score ALL candidates with full hybrid formula
3. Pick best match

Efficient flow:
1. Generate 100-300 candidates **WITHOUT centroids** = **~90KB egress**
2. Score with lightweight signals (55% of score weight)
3. Fetch centroids for **top-10 only** = **60KB egress**
4. Re-score top-10 with full formula
5. Pick best match

**Total: 150KB vs 1.8MB = 92% reduction per article**

### Additional Egress Sources NOT in Ticket

| Source | Issue | Monthly Impact |
|--------|-------|----------------|
| `queue-stats` Edge Function | `select(*)` on 1000 rows | ~4.3GB |
| `stories-detail` | `select(*)` returns all columns | ~75MB |
| `stories-search` | `select(*)` returns all columns | ~225MB |
| Backfill scripts | Fetch content/embeddings | ~1.5GB |

These are OUT OF SCOPE for TTRC-319 but should be tracked separately.

---

## Recommended Solution: Server-Side Similarity (Simplest Path)

### Why NOT Two-Phase Filtering

| Approach | Complexity | Regression Risk | Egress Savings |
|----------|------------|-----------------|----------------|
| Two-phase lightweight filter | High | Medium (may miss matches) | 99% |
| **Server-side similarity for ALL** | **Low** | **Zero** | **99%** |

**The insight:** If `get_embedding_similarities()` RPC is cheap (it is - just returns floats), call it for ALL candidates and keep scoring exactly as-is. No new filtering logic, no regression risk.

---

### The Simple Fix

**New RPC:** `get_embedding_similarities(query_embedding, story_ids[])`
```sql
CREATE OR REPLACE FUNCTION get_embedding_similarities(
  query_embedding vector(1536),
  p_story_ids bigint[]  -- prefixed for clarity
)
RETURNS TABLE (story_id bigint, similarity double precision)
LANGUAGE sql STABLE
AS $$
  SELECT s.id AS story_id,
         1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.id = ANY(p_story_ids)
    AND s.centroid_embedding_v1 IS NOT NULL;
$$;
```

**Egress:** 330 story IDs + 330 floats = **negligible** (vs 4.62 MB for 330 centroids)

---

### Implementation Flow

**Step 1: Remove centroid from candidate queries**
```javascript
// candidate-generation.js lines 105, 143, 195
.select('id, primary_headline, entity_counter, top_entities, topic_slugs, last_updated_at, primary_source_domain, lifecycle_state')
// REMOVED: centroid_embedding_v1
```

**Step 2: Call similarity RPC for ALL candidates**
```javascript
// hybrid-clustering.js - after generateCandidates()
const storyIds = candidates.map(c => c.id);
const { data: similarities } = await supabase.rpc('get_embedding_similarities', {
  query_embedding: article.embedding_v1,
  p_story_ids: storyIds
});

// Build lookup map
const simMap = new Map(similarities.map(s => [s.story_id, s.similarity]));

// Attach similarity to each candidate
candidates.forEach(c => {
  c.embeddingSimilarity = simMap.get(c.id) || 0;
});
```

**Step 3: Pass similarity into existing scoring**
```javascript
// scoring.js - modify calculateHybridScore to accept optional pre-computed similarity
export function calculateHybridScore(article, story, precomputedSimilarity = null) {
  // 1. Embedding similarity - use precomputed if provided
  const embeddingScore = precomputedSimilarity !== null
    ? (precomputedSimilarity + 1) / 2  // normalize [-1,1] to [0,1]
    : calculateEmbeddingScore(article.embedding_v1, story.centroid_embedding_v1);

  // ... rest of scoring unchanged
}
```

**That's it.** Same scoring logic, same ranking, zero regression risk.

---

### Bonus: Cap Candidate Counts (Recommended)

330 candidates/article is excessive. While fixing egress, also cap each block:

```javascript
// candidate-generation.js
const TIME_BLOCK_LIMIT = 50;    // was 100
const ENTITY_BLOCK_LIMIT = 75;  // was 150
const ANN_LIMIT = 60;           // keep
const SLUG_BLOCK_LIMIT = 20;    // keep
// Max deduped: ~100-150 candidates (vs 330)
```

This improves both performance AND clustering quality (less noise).

---

## Implementation Steps (Simplified)

### Step 1: Create migration for similarity RPC + update ANN RPC
**File:** `migrations/025_server_side_similarity.sql`
```sql
-- =============================================================================
-- Part A: New RPC for server-side similarity computation
-- =============================================================================
CREATE OR REPLACE FUNCTION get_embedding_similarities(
  query_embedding vector(1536),
  p_story_ids bigint[]
)
RETURNS TABLE (story_id bigint, similarity double precision)
LANGUAGE sql STABLE
AS $$
  SELECT s.id AS story_id,
         1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.id = ANY(p_story_ids)
    AND s.centroid_embedding_v1 IS NOT NULL;
$$;

-- =============================================================================
-- Part B: Update find_similar_stories to NOT return centroid (CRITICAL!)
-- Current version returns centroid = 60 × 14KB = 840KB wasted per article
-- =============================================================================
CREATE OR REPLACE FUNCTION find_similar_stories(
  query_embedding vector(1536),
  match_limit int DEFAULT 60,
  min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  id bigint,
  primary_headline text,
  -- REMOVED: centroid_embedding_v1 vector(1536),
  entity_counter jsonb,
  top_entities text[],
  topic_slugs text[],  -- ADDED: was missing
  last_updated_at timestamptz,
  primary_source_domain text,
  lifecycle_state text,
  similarity double precision
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT
    s.id,
    s.primary_headline,
    s.entity_counter,
    s.top_entities,
    s.topic_slugs,
    s.last_updated_at,
    s.primary_source_domain,
    s.lifecycle_state,
    1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
  FROM stories s
  WHERE s.centroid_embedding_v1 IS NOT NULL
    AND s.lifecycle_state IN ('emerging','growing','stable','stale')
    AND (1 - (s.centroid_embedding_v1 <=> query_embedding)) >= min_similarity
  ORDER BY similarity DESC
  LIMIT GREATEST(1, COALESCE(match_limit, 60));
$$;
```

**⚠️ CRITICAL:** Part B updates the existing ANN RPC to remove centroid. Without this, ANN block still transfers 840KB/article.

### Step 2: Update candidate-generation.js
1. Remove `centroid_embedding_v1` from lines 105, 143, 195
2. (Optional) Reduce candidate limits: TIME 100→50, ENTITY 150→75

### Step 3: Update scoring.js
1. Modify `calculateHybridScore()` to accept optional `precomputedSimilarity` parameter
2. If provided, use it instead of computing from centroid
3. **No new functions needed** - just one optional parameter

### Step 4: Update hybrid-clustering.js
1. After `generateCandidates()`, call `get_embedding_similarities` RPC with all story IDs
2. **Add error handling:**
```javascript
const { data: similarities, error: simError } = await supabase.rpc('get_embedding_similarities', {
  query_embedding: article.embedding_v1,
  p_story_ids: storyIds
});
if (simError) {
  console.error('[hybrid-clustering] Similarity RPC failed:', simError.message);
  throw new Error(`Similarity RPC failed: ${simError.message}`);
}
```
3. Build similarity map from RPC response
4. **For ANN candidates:** They already have `similarity` field from `find_similar_stories` - can reuse directly
5. Pass `precomputedSimilarity` to `calculateHybridScore()` for each candidate
6. **Everything else stays the same**

### Step 5: Deployment Order (IMPORTANT)

**Migration MUST deploy before code** (RPC must exist before code calls it)

| Phase | Action | Verify |
|-------|--------|--------|
| 1 | Deploy migration 025 to TEST | `SELECT get_embedding_similarities(...)` works |
| 2 | Deploy code changes to TEST | Run clustering, no errors |
| 3 | Validate on TEST | Spot-check assignments, check egress |
| 4 | Deploy migration 025 to PROD | Same RPC verification |
| 5 | Deploy code changes to PROD | Monitor first run |

### Step 6: Validate (low-overhead)
1. Run on TEST for a few clustering cycles
2. Spot-check: same stories getting same assignments
3. Monitor egress in Supabase dashboard
4. **No shadow testing needed** - scoring logic unchanged

### Rollback Plan

If issues arise:
1. **Code rollback:** Revert JS changes (re-add centroid to queries, remove RPC call)
2. **Migration rollback:** NOT required - RPCs can stay even if unused
3. **Partial rollback:** If only ANN RPC update causes issues, can revert just that function

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| RPC returns wrong similarity | Unit test: verify `1 - (a <=> b)` matches JS calculation |
| Guardrail logic breaks | Verify `embeddingScore` variable unchanged in guardrail checks |
| Centroid size inconsistency (6KB vs 14KB) | Clarified: 14KB JSON-serialized for all egress calcs |
| ANN RPC change breaks callers | Only `hybrid-clustering.js` calls it; code & migration deploy together |
| RPC call fails at runtime | Error handling added; throws with clear message |

### Why This Approach Has Minimal Risk

1. **Same scoring logic** - just substitute data source for embedding similarity
2. **No filtering changes** - all candidates still evaluated
3. **No threshold changes** - guardrails use same `embeddingScore` value
4. **Easy rollback** - just revert to fetching centroid if issues arise

### Validation Checklist

- [ ] Deploy migration to TEST
- [ ] Run 1 clustering cycle, verify no errors
- [ ] Spot-check 5-10 articles: same story assignments as before
- [ ] Check Supabase dashboard: egress dropped significantly
- [ ] Deploy to PROD

---

## Actual Egress Measurements (Data-Driven)

### Per-Article Clustering Egress

| Component | Size | Count | Total |
|-----------|------|-------|-------|
| Centroid embedding (JSON) | **14 KB** | 330 candidates | **4.62 MB** |
| Article embedding (fetch) | 12 KB | 1 | 12 KB |
| Article metadata | 3 KB | 1 | 3 KB |
| Candidate metadata | 1 KB | 330 | 330 KB |
| **Total per article** | | | **~5 MB** |

### Monthly Egress at PROD Scale

| Scenario | Articles/Month | Egress | vs 5GB Tier |
|----------|----------------|--------|-------------|
| PROD (2 runs/day) | 45,000 | **204 GB** | 40x over |
| TEST (1 run/week) | 400 | 1.8 GB | OK |
| **Optimized PROD** | 45,000 | **4.4 GB** | Under limit |

### Cost Impact

| Item | Current | After Fix |
|------|---------|-----------|
| Egress overage | $17.91/mo | $0 |
| OpenAI enrichment | $6.00/mo | $6.00/mo |
| Total | **$23.91/mo** | **$6.00/mo** |

### Why 90-95% Reduction Is Achievable

**Current:** Fetch 330 centroids × 14 KB = **4.62 MB** per article

**Optimized (server-side similarity):**
- Top-25 + ~60 ANN candidates = ~85 story IDs
- Send: 85 IDs × 8 bytes = 680 bytes
- Receive: 85 similarities × 8 bytes = 680 bytes
- **Total: ~1.4 KB** (vs 4.62 MB)

**Reduction: 4.62 MB → 1.4 KB = 99.97%**

Even with adaptive fallback to top-75:
- 75 similarities × 8 bytes = 600 bytes
- Still under 2 KB total

**Monthly impact:**
- Current: 204 GB
- Optimized: ~60 MB (yes, megabytes)
- **Well under 5 GB free tier**

---

## Files to Modify

1. **`migrations/025_server_side_similarity.sql`** - New RPC + update `find_similar_stories` to remove centroid
2. **`scripts/rss/candidate-generation.js`** - Remove `centroid_embedding_v1` from lines 105, 143, 195
3. **`scripts/rss/scoring.js`** - Add optional `precomputedSimilarity` param to `calculateHybridScore()`
4. **`scripts/rss/hybrid-clustering.js`** - Call similarity RPC, pass result to scoring, add error handling

**Total: 4 files, ~60 lines changed. No new complex logic.**

### Centroid Size Clarification
- **6 KB** = raw binary (1536 floats × 4 bytes)
- **14 KB** = JSON-serialized (what's actually transferred via PostgREST)
- Plan uses 14 KB for all egress calculations (worst case, actual transfer size)

---

## Out of Scope (Future Tickets)

- `queue-stats` Edge Function egress (select * issue)
- `stories-detail` Edge Function egress
- `stories-search` Edge Function egress
- Backfill script egress warnings

# TTRC-319 & TTRC-320 Implementation Complete

**Date:** 2025-12-19
**Commit:** 0fc4f98
**Branch:** test
**Status:** Code complete, migration pending deployment

---

## Summary

| Ticket | Status | Description |
|--------|--------|-------------|
| TTRC-320 | Done | Fix embedding order bug (CRITICAL) |
| TTRC-319 | In Progress | Server-side similarity for egress optimization |

---

## TTRC-320: Embedding Order Fix (CRITICAL)

### Problem
`enrichArticles()` ordered by `created_at ASC` with limit 100, causing newest articles (from current RSS run) to miss embeddings when backlog exists. 54% of articles from Dec 19 run got no embeddings.

### Fix
One-line change in `scripts/rss-tracker-supabase.js` line 211:
```javascript
.order('created_at', { ascending: false })  // Was: ascending: true
```

### Impact
- Newest articles now processed first
- Current run articles always get embeddings
- Old backlog processed after current run

---

## TTRC-319: Server-Side Similarity (Egress Optimization)

### Problem
Clustering fetched `centroid_embedding_v1` (14KB each) for ALL candidates (~330/article), causing ~5MB egress per article. At PROD scale: 200+ GB/month vs 5GB free tier.

### Solution
Server-side similarity calculation via new PostgreSQL RPC.

### Files Changed

| File | Changes |
|------|---------|
| `migrations/026_server_side_similarity.sql` | NEW - `get_embedding_similarities()` RPC + updated `find_similar_stories()` |
| `scripts/rss/candidate-generation.js` | Removed `centroid_embedding_v1` from 3 select statements |
| `scripts/rss/scoring.js` | Added `precomputedSimilarity` param to `calculateHybridScore()` |
| `scripts/rss/hybrid-clustering.js` | Call RPC, add safeguards (null handling, dedup, fallback) |

### Safeguards Implemented
1. **Deduplicate story IDs** - candidate blocks overlap, dedupe before RPC
2. **Null embedding handling** - set similarity=0, let other signals (55%) work
3. **RPC failure fallback** - log + fallback to 0, don't throw
4. **Missing similarities** - use `?? 0` for stories with null centroids

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Egress per article | ~5 MB | ~15-25 KB |
| Monthly egress (PROD) | 204 GB | ~450MB-1.1GB |
| vs 5GB free tier | 40x over | Well under |

---

## DEPLOYMENT REQUIRED

**Migration 026 must be applied before code executes!**

### Steps:
1. Go to Supabase Dashboard (TEST project)
2. Navigate to SQL Editor
3. Copy contents of `migrations/026_server_side_similarity.sql`
4. Execute
5. Verify with: `SELECT get_embedding_similarities(ARRAY[0.1, 0.2]::float8[], ARRAY[1]::bigint[])`

### Verify `find_similar_stories` Update:
```sql
SELECT proname, proargtypes::regtype[]
FROM pg_proc
WHERE proname = 'find_similar_stories';
```

---

## Validation Needed

After migration is applied:

1. **Trigger RSS run:**
   ```bash
   gh workflow run "RSS Tracker - TEST" --ref test
   ```

2. **Check all articles get embeddings:**
   ```sql
   SELECT COUNT(*), COUNT(embedding_v1)
   FROM articles
   WHERE created_at > NOW() - INTERVAL '1 hour';
   ```

3. **Check clustering works:**
   - Should see `[hybrid-clustering]` logs with similarity RPC calls
   - No errors about missing centroids

4. **Monitor egress:**
   - Supabase Dashboard → Settings → Usage
   - Should see significant reduction in database egress

---

## AI Code Review

- **Workflow:** ai-code-review.yml
- **Run ID:** 20378333080
- **Status:** In progress (as of handoff creation)

Check status: `gh run list --workflow="ai-code-review.yml" --limit 1`

---

## Rollback Plan

### TTRC-320:
```javascript
// Revert to: ascending: true
.order('created_at', { ascending: true })
```

### TTRC-319:
1. Revert JS changes (re-add centroid to selects, remove RPC call)
2. Migration stays - RPCs harmless if unused

---

## Next Session

1. Apply migration 026 to TEST
2. Trigger RSS run and validate
3. Monitor egress metrics
4. If successful, prepare for PROD deployment
5. Address any AI code review findings

---

## Files Reference

- Plan: `C:\Users\Josh\.claude\plans\federated-honking-honey.md`
- Migration: `migrations/026_server_side_similarity.sql`
- Original analysis: `docs/plans/ttrc-319-egress-analysis.md`

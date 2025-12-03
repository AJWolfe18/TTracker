# Handoff: TTRC-236 Entity Backfill & Simulation Findings

**Date:** 2025-12-02
**Ticket:** TTRC-236 Phase 2
**Branch:** test
**Session Cost:** ~$0.16 (entity backfill $0.15 + embedding backfill $0.007)

---

## Summary

Attempted to run re-cluster simulation per plan, but discovered **entity scoring was returning 0** for all articles. Investigation revealed multiple data gaps that blocked the simulation from producing meaningful results.

---

## What Was Accomplished

### 1. Embedding Backfill (Plan Step 1) ✅
- **589 articles** backfilled with embeddings
- Cost: **$0.0067**
- Script: `scripts/backfill-article-embeddings-inline.js`

### 2. Entity Backfill (NOT in original plan) ✅
- **1,000 articles** backfilled with entities
- Cost: **$0.1447**
- Script created: `scripts/backfill-article-entities-inline.js`
- Average 2.7 entities per article

### 3. Story Entity Counter Backfill ✅
- **1,232 stories** updated with entity_counter and top_entities
- Cost: $0 (no API calls)
- Script created: `scripts/backfill-story-entity-counters.js`

### 4. Re-Cluster Simulation Script (Plan Step 3) ✅
- Script exists: `scripts/recluster-simulation.js`
- Runs but shows 100% fragmentation due to missing centroids

---

## Key Findings (Blockers)

### Finding 1: Articles Had No Entities
- **Root cause:** Entity extraction only happens at STORY level during enrichment
- **Impact:** Hybrid scoring uses article.entities (25% weight) but they were empty `[]`
- **Fix applied:** Backfilled 1,000 articles with entities via GPT-4o-mini

### Finding 2: Stories Had Empty entity_counter
- **Root cause:** entity_counter is updated when articles are added, but articles had no entities
- **Impact:** Entity overlap score = 0 for all candidates
- **Fix applied:** Recomputed entity_counters from backfilled article entities

### Finding 3: Story Centroids Missing/Timed Out
- **Root cause:** `recompute_story_centroids()` RPC times out
- **Current state:** 711/1463 stories (49%) have centroids
- **Impact:** Embedding similarity score = 0 for stories without centroids
- **Fix needed:** Create inline centroid backfill script (like entity script)

### Finding 4: RSS Pipeline Gap
- **Root cause:** `rss-tracker-supabase.js` doesn't extract entities during article ingestion
- **Impact:** New articles won't have entities, scoring will fail
- **Fix needed:** Add entity extraction to RSS ingestion pipeline

---

## Simulation Results (Current State)

```
Total articles analyzed: 100
Same assignment:         0 (0.0%)
Different assignment:    0 (0.0%)
Would create new:        100 (100.0%)

Score Distribution:
>= 0.80 (high):   0 (0.0%)
0.60-0.79 (med):  0 (0.0%)
< 0.60 (low):     100 (100.0%)
```

**Why:** Without story centroids, embedding score = 0. Max possible score ~0.35 (entities + title + time), but threshold is 0.62.

---

## Files Created This Session

| File | Purpose |
|------|---------|
| `scripts/backfill-article-entities-inline.js` | Extract entities for articles using GPT-4o-mini |
| `scripts/backfill-story-entity-counters.js` | Recompute story entity_counters from articles |

---

## Recommended Next Steps

### Priority 1: Fix Centroid Gap
Create `scripts/backfill-story-centroids-inline.js` similar to entity backfill:
- For each story, average article embeddings to compute centroid
- No API cost (pure math)
- Required for simulation to show meaningful results

### Priority 2: Re-run Simulation
After centroids are fixed:
```bash
node scripts/recluster-simulation.js 100
```
Expect to see actual embedding scores (0.85+) and entity overlap contributing.

### Priority 3: Add Entity Extraction to Pipeline
Modify `rss-tracker-supabase.js` to call entity extraction for each new article:
- Reuse logic from `backfill-article-entities-inline.js`
- Cost: ~$0.00015/article
- Required for ongoing scoring to work

---

## Database State After Session

| Metric | Before | After |
|--------|--------|-------|
| Articles with embeddings | ~1,100 | ~1,689 |
| Articles with entities | ~0 | ~1,000 |
| Stories with entity_counter | ~0 | ~1,232 |
| Stories with centroids | ~711 | ~711 (unchanged, RPC timed out) |

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Embedding backfill (589 articles) | $0.0067 |
| Entity backfill (1,000 articles) | $0.1447 |
| Story entity_counter backfill | $0.00 |
| **Total** | **~$0.16** |

---

## Open Questions for Next Session

1. Should entity extraction be added to TTRC-236 scope or new ticket?
2. Should we create inline centroid backfill or debug the RPC timeout?
3. After fixes, what threshold adjustments (if any) are needed?

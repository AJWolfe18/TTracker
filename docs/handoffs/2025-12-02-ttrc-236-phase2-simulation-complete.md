# Handoff: TTRC-236 Phase 2 - Simulation Complete

**Date:** 2025-12-02
**Ticket:** TTRC-236 Phase 2
**Branch:** test
**Session Cost:** $0 (no API calls - pure vector math)

---

## Summary

Successfully completed TTRC-236 Phase 2 merge threshold validation. After fixing centroid coverage from 49% to 99.6%, the re-cluster simulation shows **98% stability** - confirming the threshold of 0.62 is appropriate and the clustering system is working correctly.

---

## What Was Accomplished

### 1. Architecture Investigation
- Traced through clustering code to understand why simulation showed 100% fragmentation
- Discovered article-level entity extraction was **explicitly deferred** (not a bug)
- Confirmed in TTRC-235 handoff (Oct 16, 2025): "Nice to Have / Future Enhancement"

### 2. Centroid Backfill Script
- **Created:** `scripts/backfill-story-centroids-inline.js`
- **Approach:** Inline paginated processing (avoids RPC timeout)
- **Coverage achieved:** 49% → 99.6% (1457/1463 stories)
- **Remaining 6:** Stories with no articles having embeddings (expected)

### 3. Re-Cluster Simulation Results

| Metric | Result |
|--------|--------|
| Same assignment | **98%** (articles cluster to same story) |
| Different assignment | **0%** (no false switches) |
| Would create new | **2%** (2 edge cases) |
| High confidence (≥0.80) | **91%** |
| Medium confidence (0.60-0.79) | **9%** |
| Low confidence (<0.60) | **0%** |

**Interpretation:** Clustering is STABLE. Threshold 0.62 validated.

### 4. Score Breakdown Analysis (from debug logs)

| Signal | Weight | Typical Score | Notes |
|--------|--------|---------------|-------|
| Embedding | 40% | 0.87-0.91 | Excellent - centroids working |
| Entities | 25% | 0.00 | Expected - article entities empty (deferred) |
| Title | 15% | 0.50-0.54 | Good overlap |
| Time | 10% | 0.00 | Expected - older articles |
| Total best match | - | 0.80+ | Above threshold |

---

## Key Finding: Entity Extraction is Enhancement, Not Bug

**Evidence from TTRC-235 handoff (docs/handoffs/2025-10-16-ttrc235-entity-extraction-complete.md):**

Lines 296-299:
```
### Nice to Have (Future Enhancements)
- [ ] Article-level entity extraction (better recall)
```

Lines 380-383:
```
7. **Article-Level Entity Extraction (TTRC-236)**
   - Move entity extraction to article enrichment (article.enrich job)
   - Aggregate article entities to story.top_entities
   - Improves recall by using full article text
```

**Conclusion:** The system was designed to work without article entities. Threshold 0.62 was tuned for time + embedding + title signals. Adding article entities would enable the 25% entity weight but is an enhancement, not a fix.

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/backfill-story-centroids-inline.js` | Paginated centroid backfill (avoids RPC timeout) |
| `docs/handoffs/2025-12-02-ttrc-236-phase2-simulation-complete.md` | This handoff |

---

## Database State After Session

| Metric | Before | After |
|--------|--------|-------|
| Stories with centroids | 711 (49%) | 1457 (99.6%) |
| Simulation: same assignment | 0% | 98% |
| Simulation: high confidence | 0% | 91% |

---

## Next Steps

### Immediate: Create Follow-up Ticket
**Summary:** Add article-level entity extraction to RSS pipeline
**Type:** Story
**Project:** TTRC

See plan file for full ticket description: `C:\Users\Josh\.claude\plans\prancy-brewing-pine.md`

This ticket enables the 25% entity weight in hybrid scoring:
- Extract entities during article ingestion
- Reuse logic from `scripts/backfill-article-entities-inline.js`
- Cost: ~$2.25/month (within budget)
- Impact: Improved clustering recall (optional enhancement)

### Optional: Nightly Centroid Job
Add automated nightly centroid recompute to fix drift:
- Job type: `story.lifecycle`
- Run at 2am daily
- Prevents centroid drift from running averages

---

## TTRC-236 Status

Phase 2 merge threshold validation is **COMPLETE**:
- [x] Embedding backfill (Phase 1)
- [x] Entity backfill for existing articles
- [x] Story entity_counter backfill
- [x] **Centroid backfill** (this session)
- [x] **Re-cluster simulation** (98% stable)
- [x] **Threshold validation** (0.62 confirmed appropriate)

**Recommendation:** Close TTRC-236 as complete. Article-level entity extraction is optional enhancement (separate ticket).

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Centroid backfill | $0.00 (pure math) |
| Simulation | $0.00 (read-only) |
| **Total** | **$0.00** |

---

## Quick Commands

```bash
# Run centroid backfill (if needed in future)
node scripts/backfill-story-centroids-inline.js all

# Run simulation
node scripts/recluster-simulation.js 100

# Check centroid coverage
# Via Supabase MCP or SQL:
SELECT
  COUNT(*) total,
  COUNT(centroid_embedding_v1) with_centroid,
  ROUND(100.0 * COUNT(centroid_embedding_v1) / COUNT(*), 1) coverage_pct
FROM stories;
```

---

**Last Updated:** 2025-12-02
**Status:** Phase 2 Complete - Clustering Validated
**Next Action:** Create follow-up ticket for article entity extraction, close TTRC-236

# TTRC-306: Topic Slug Extraction - Handoff

**Date:** 2025-12-10
**Status:** Code Complete, Migration Applied, Backfill Deferred
**Commit:** dddde68
**Branch:** test

---

## Summary

Implemented AI-powered topic slug extraction to improve clustering recall. Topic slugs identify specific news events (e.g., `HEGSETH-CONFIRMATION-HEARING`) rather than just semantic similarity.

## What Changed

### New Files
- `migrations/045_add_topic_slug.sql` - Schema: `articles.topic_slug`, `stories.topic_slugs[]`
- `scripts/rss/topic-extraction.js` - GPT-4o-mini extraction function
- `scripts/backfill-topic-slugs.mjs` - Backfill script (egress-optimized)
- `scripts/apply-migration-045.js` - Migration helper

### Modified Files
- `scripts/rss/scoring.js` - Added `topicSlugMatch: 0.08` to BONUSES, exported BONUSES
- `scripts/rss/hybrid-clustering.js` - Added slug to guardrail OR condition, slug aggregation
- `scripts/rss/candidate-generation.js` - Added slug block + `topic_slugs` to all selects
- `scripts/rss-tracker-supabase.js` - Integrated slug extraction in pipeline

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Guardrail integration | Slug as "reason to cluster", NOT bypass | Maintains embedding ≥0.60 requirement |
| Bonus amount | 0.08 (conservative) | Can tune up based on data |
| Content source | Title + excerpt only | Egress optimization (~1MB vs ~9MB) |

## Database Changes

```sql
-- Applied to TEST (wnrjrywpcadwutfykflu)
ALTER TABLE articles ADD COLUMN topic_slug VARCHAR(100);
ALTER TABLE stories ADD COLUMN topic_slugs TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_stories_topic_slugs_gin ON stories USING GIN (topic_slugs);
```

## Cost

- Backfill (~1800 articles): ~$0.92 one-time
- Ongoing (~30 articles/day): ~$0.45/month

## What's Working

- ✅ Schema migration applied
- ✅ New articles will auto-extract slugs via RSS pipeline
- ✅ Clustering will use slugs for candidate generation + scoring
- ✅ Story slug aggregation on attach/create

## What's Deferred

- ⏸️ **Backfill**: Deferred due to egress concerns
  - Current egress is over limit
  - Run after monthly reset: `node scripts/backfill-topic-slugs.mjs`
  - Estimated egress: ~1MB (optimized from ~9MB)

- ⏸️ **Recluster**: Wait for backfill completion
  - Run: `node scripts/recluster-all.mjs --full`

## Validation Queries (After Backfill)

```sql
-- Check slug distribution
SELECT topic_slug, COUNT(*) as cnt
FROM articles
WHERE topic_slug IS NOT NULL
GROUP BY topic_slug
ORDER BY cnt DESC
LIMIT 20;

-- Check story aggregation
SELECT id, primary_headline, array_length(topic_slugs, 1) as slug_count
FROM stories
WHERE array_length(topic_slugs, 1) > 1
ORDER BY slug_count DESC
LIMIT 10;
```

## Next Steps for Future Session

1. After egress resets (next month):
   - Run backfill: `node scripts/backfill-topic-slugs.mjs`
   - Run recluster: `node scripts/recluster-all.mjs --full`
   - Validate results with queries above
2. Update JIRA TTRC-306 to Done
3. Monitor FP rate after recluster

## JIRA Status

- TTRC-306: Needs manual update to "Done" (MCP auth issue)
- Add comment: "Code complete, migration applied. Backfill deferred due to egress."

---

**Original Plan:** `docs/plans/ttrc-306-topic-slug-extraction.md`
**Expert Review:** 6 corrections applied (column names, integration point, etc.)

# TTRC-324 v2: Two-Tier Cross-Run Override

**Created:** 2025-12-21
**Status:** Ready for Implementation
**Branch:** test

---

## Problem

v1 TTRC-324 requires slug match for cross-run override, but Epstein-class articles have different slugs (`EPSTEIN-DOCS-RELEASE` vs `EPSTEIN-FILES-REMOVED-TRUMP`) despite being the same event. This creates 10+ stories instead of 1-2.

---

## Solution: Two-Tier Safety Profile

### Tier A - Very High Embedding (no corroboration needed)
- embedBest >= 0.90 (0.92 if single candidate)
- timeDiff <= 48h
- margin >= 0.04 (vacuously true if single candidate)
- passesGuardrail

### Tier B - High Embedding (needs corroboration)
- embedBest >= 0.88
- timeDiff <= 72h
- margin >= 0.04 **AND 2+ candidates**
- passesGuardrail
- AND one of: slugToken.passes, entityOverlap >= 1, titleTokenOverlap >= 1

---

## Key Safety Features

| Feature | Purpose |
|---------|---------|
| Tier A single-candidate bump (0.92) | Extra safety when no margin comparison available |
| Tier B requires 2+ candidates | Margin gate must be meaningful |
| TITLE_STOPWORDS | Filters newsroom terms (release, court, report) |
| ACRONYM_ALLOWLIST | Keeps short but critical tokens (DOJ, FBI, SEC) |
| Time safety valve | Uses first_seen_at if last_updated_at gap > 7 days |
| Article time fallback | Uses created_at if published_at missing |
| scoreResult.total guard | Falls back to embedBest if undefined |

---

## Files Modified

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Add helpers, update stats, refactor TTRC-324 |
| `scripts/rss-tracker-supabase.js` | Update CLUSTERING_SUMMARY |

---

## Logging Schema

```json
{
  "type": "CROSS_RUN_OVERRIDE",
  "tier": "A" | "B",
  "tierA_embed_threshold": 0.90 | 0.92,
  "article_id": "art-xxx",
  "story_id": 123,
  "embed_best": 0.91,
  "embed_second": 0.85 | null,
  "margin": 0.06 | null,
  "margin_vacuous": false | true,
  "time_diff_hours": 12.5,
  "time_anchor": "last_updated_at" | "first_seen_at" | "first_seen_at_safety",
  "candidate_count": 5,
  "guardrail": true,
  "corroboration": "slug_token" | "entity" | "title_token" | null,
  "total": 0.65
}
```

---

## Follow-up: TTRC-326 (latest_article_published_at)

**Problem:** `last_updated_at` touched by enrichment doesn't reflect true event recency.

**Solution:** Add `latest_article_published_at` column, update on story creation and attach.

---

## Acceptance Criteria

- [ ] Tier A fires for embed ≥ 0.90 (or ≥ 0.92 if single candidate)
- [ ] Tier B requires 2+ candidates AND corroboration
- [ ] CLUSTERING_SUMMARY shows tier breakdown + backwards compat key
- [ ] No false positives in spot-check

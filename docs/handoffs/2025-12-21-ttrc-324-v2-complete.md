# TTRC-324 v2: Two-Tier Cross-Run Override Complete

**Date:** 2025-12-21
**Status:** Implemented, testing in progress
**Branch:** test
**Commit:** be6ac5b

---

## What Was Implemented

### TTRC-324 v2: Two-Tier Cross-Run Override

Replaced v1's slug-gated approach (which blocked valid Epstein-class merges due to different slugs) with a two-tier system:

**Tier A** (no corroboration needed):
- embedBest >= 0.90 (0.92 if single candidate for extra safety)
- timeDiff <= 48h
- margin >= 0.04 (vacuously true if single candidate)
- passesGuardrail

**Tier B** (needs corroboration):
- embedBest >= 0.88
- timeDiff <= 72h
- margin >= 0.04 AND 2+ candidates (margin must be meaningful)
- passesGuardrail
- AND one of:
  - slugToken.passes
  - entityOverlap >= 1
  - titleTokenOverlap >= 1

### Key Safety Features

| Feature | Purpose |
|---------|---------|
| Tier A single-candidate bump (0.92) | Extra safety when no margin comparison available |
| Tier B requires 2+ candidates | Margin gate must be meaningful |
| TITLE_STOPWORDS | Filters newsroom terms (release, court, report, etc.) and opinion pieces |
| ACRONYM_ALLOWLIST | Keeps critical short tokens (DOJ, FBI, SEC) but excludes 'who' (ambiguous) |
| Time safety valve | Uses first_seen_at if last_updated_at gap > 7 days (detects maintenance) |
| Article time fallback | Uses created_at if published_at missing |
| scoreResult.total guard | Falls back to embedBest if undefined |
| embedSecond/margin as null | Logs null (not 0) for single candidate |
| margin_vacuous flag | Explicitly tracks single-candidate cases |
| tierA_embed_threshold in logs | Enables analysis of threshold decisions |
| Backwards compat in summary | Keeps attached_324_slug_embed key |

---

## Files Modified

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Added TITLE_STOPWORDS, ACRONYM_ALLOWLIST, getTitleTokenOverlap(), updated runStats, replaced TTRC-324 block with v2 two-tier logic |
| `scripts/rss-tracker-supabase.js` | Updated CLUSTERING_SUMMARY with tier breakdown + backwards compat |

---

## Testing Status

- [x] RSS workflow triggered (run 20415959023)
- [ ] AI code review (run 20415955622) - in progress
- [ ] Spot-check CROSS_RUN_OVERRIDE logs for false positives
- [ ] Verify attach rate improvement

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

## JIRA Status

- **TTRC-324:** Comment added with v2 implementation details

---

## Follow-up Work

### TTRC-326 (deferred): Add latest_article_published_at

**Problem:** `last_updated_at` touched by enrichment doesn't reflect true event recency.

**Solution:**
1. Add column: `public.stories.latest_article_published_at` (timestamptz, nullable)
2. On story creation: set to `article.published_at`
3. On `attachToStory`: update to GREATEST(existing, article.published_at)
4. Update clustering recency gating to prefer this field

**Parent ticket:** TTRC-225

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-21-ttrc-324-v2-complete.md

## Task: Validate TTRC-324 v2 Results

1. Check AI code review results: `gh run view 20415955622`
2. Check RSS workflow logs for CROSS_RUN_OVERRIDE events
3. Spot-check 5-10 overrides for false positives
4. If review passes and no false positives, consider merging to main

## If Issues Found:
- Review AI code review feedback
- Adjust thresholds if false positives detected
- Create follow-up JIRA ticket if needed
```

---

## Key Context

- Cloud ID: `f04decff-2283-43f1-8e60-008935b3d794`
- RSS workflow: `gh workflow run "RSS Tracker - TEST" --ref test`
- AI code review runs automatically on push

# TTRC-321: Ready for Implementation

**Date:** 2025-12-19
**Status:** Plan Complete - Ready to Code
**Branch:** test

---

## Session Summary

### Phase 0 Diagnostics Complete
- Ran RSS workflow with `LOG_PHASE0_DIAGNOSTICS=true`
- **79 new stories created** - many duplicates (Epstein 6+, Stefanik 3, Bongino 4+)
- **Key finding:** Same-run stories ARE found (embedding 0.90+), but scoring doesn't reach 0.700 threshold due to empty entity_counter on newborn stories

### Solution Designed: Safe High-Embedding Attach Override

Override triggers when ALL:
- `embedding >= 0.90`
- `story.created_at >= runStart` (same-run)
- `total < threshold`
- `passesGuardrail` (keep existing safety!)

AND at least ONE safety gate:
- Margin: `(best - secondBest) >= 0.04`
- Slug: `slugTokenSimilarity(article.topic_slug, story.topic_slugs).passes`
- Time: `|published_at - created_at| < 2 hours`

### Pre-Implementation Fixes Required
1. Verify `created_at` in all candidate sources (including ANN RPC)
2. Track `secondBestEmbedding` in scoring loop
3. Use correct slugTokenSimilarity signature (slugs, not titles!)
4. Consistent `bestMatch.story` shape

---

## Files Modified This Session

- `.github/workflows/rss-tracker-test.yml` - Added `LOG_PHASE0_DIAGNOSTICS: 'true'`
- `docs/plans/ttrc-321-same-run-override.md` - Full implementation spec
- `docs/handoffs/2025-12-19-ttrc-321-diagnostic-results.md` - Analysis

## JIRA Note

JIRA MCP auth failed. Manually add comment to TTRC-321:
```
Implementation plan finalized. Solution: Safe High-Embedding Attach Override.
Override triggers when: embedding >= 0.90 AND same-run AND belowThreshold AND
passesGuardrail AND (margin >= 0.04 OR slugOverlap.passes OR timeWindow < 2hr).
Plan doc at docs/plans/ttrc-321-same-run-override.md. Ready for implementation.
```

---

## Next Session Prompt

```
We're implementing TTRC-321 Same-Run High-Embedding Override.

Read the plan doc: docs/plans/ttrc-321-same-run-override.md

Then create a todo list and implement:

1. PRE-IMPLEMENTATION CHECKS:
   - Verify created_at exists in all candidate sources (time/entity/slug blocks in candidate-generation.js)
   - Check if ANN RPC (find_similar_stories) returns created_at - if not, add it
   - Verify slugTokenSimilarity signature uses slugs not titles

2. IMPLEMENTATION:
   - Track secondBestEmbedding in scoring loop (hybrid-clustering.js)
   - Add override logic after scoring, before creating new story
   - Log all gates that passed (not just single reason)
   - Keep passesGuardrail check - only bypass threshold, not safety system

3. TESTING:
   - Trigger RSS workflow: gh workflow run "RSS Tracker - TEST" --ref test
   - Search logs for [SAME_RUN_OVERRIDE] entries
   - Validate merges are correct (Epstein/Stefanik/Bongino should cluster)

4. CLEANUP:
   - After validation, remove LOG_PHASE0_DIAGNOSTICS from workflow

Key corrections from review:
- Use slugTokenSimilarity(article.topic_slug, story.topic_slugs) NOT titles
- Use story.created_at for same-run check (not last_updated_at)
- Keep passesGuardrail in override condition
- Log reasonsPassed array (all gates), not single reasonUsed
```

---

## Commits This Session

- `19022f6` - chore(ci): enable Phase 0 diagnostic logging for TTRC-321

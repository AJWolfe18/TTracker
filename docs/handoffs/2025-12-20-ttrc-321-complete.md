# TTRC-321: Same-Run High-Embedding Override - Complete

**Date:** 2025-12-20
**Status:** Implementation Complete - Ready for Testing
**Branch:** test

---

## Summary

Implemented the "Safe High-Embedding Attach Override" to fix same-run duplicate story creation. The root cause: same-run stories ARE found via ANN (embedding 0.90+), but total score falls below 0.700 threshold because newborn stories have empty `entity_counter`.

## Solution

Override bypasses threshold when ALL conditions met:
- `embedding >= 0.90`
- `story.created_at >= runStart` (same-run)
- `total < threshold`
- `passesGuardrail` (keeps existing safety!)

AND at least ONE safety gate:
- Margin: `(best - secondBest) >= 0.04`
- Slug: `slugTokenSimilarity().passes`
- Time: `|published_at - created_at| < 2 hours`

---

## Commits

| Commit | Description |
|--------|-------------|
| `63707f2` | feat(clustering): TTRC-321 Same-Run High-Embedding Override |
| `3137c6f` | fix(scoring): address AI code review blocker - validate precomputedSimilarity |

---

## Files Modified

| File | Changes |
|------|---------|
| `migrations/027_add_created_at_to_ann_rpc.sql` | NEW: Adds created_at to find_similar_stories RPC |
| `scripts/rss/hybrid-clustering.js` | Added passesClusteringGuardrail helper, secondBestEmbedding tracking, override logic |

---

## AI Code Review

**Status:** Blocker found and fixed

**Blocker:** Using `story.precomputedSimilarity` for top-by-embedding selection could be undefined/stale for non-ANN candidates.

**Fix:** Changed to use `scoreResult.embeddingScore` (source of truth) everywhere.

---

## Next Steps (Manual)

1. **Apply migration 027** via Supabase dashboard SQL editor:
   - File: `migrations/027_add_created_at_to_ann_rpc.sql`
   - Project: TrumpyTracker-Test

2. **Trigger RSS workflow:**
   ```bash
   gh workflow run "RSS Tracker - TEST" --ref test
   ```

3. **Validate logs:**
   - Search for `[SAME_RUN_OVERRIDE]` entries
   - Verify Epstein/Stefanik/Bongino articles cluster instead of creating duplicates

4. **Cleanup after validation:**
   - Remove `LOG_PHASE0_DIAGNOSTICS` from `.github/workflows/rss-tracker-test.yml`

---

## JIRA

- Ticket: TTRC-321
- Status: In Progress
- Comment added with implementation details and next steps

---

## Next Session Prompt

```
Continue TTRC-321 validation.

1. Apply migration 027 via Supabase dashboard (file: migrations/027_add_created_at_to_ann_rpc.sql)
2. Trigger RSS workflow: gh workflow run "RSS Tracker - TEST" --ref test
3. Search logs for [SAME_RUN_OVERRIDE] entries
4. Validate correct clustering behavior
5. If successful, cleanup Phase 0 diagnostic logging
6. Transition TTRC-321 to Done
```

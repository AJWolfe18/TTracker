# TTRC-321 Phase 0: Diagnostic Logging Implementation

**Date:** 2025-12-19
**Status:** Ready for Test
**Commit:** `d33edd1`
**Branch:** test

---

## Summary

Implemented Phase 0 diagnostic logging to prove/disprove hypothesis that stories created earlier in same RSS run aren't visible to candidate generation for later articles.

## Changes Made

### 1. rss-tracker-supabase.js
- Set `globalThis.__RUN_START__` at run start
- Import and call `resetRunState()` from hybrid-clustering.js

### 2. candidate-generation.js
- Added `created_at` to ALL select statements (TEMPORARY - remove after Phase 0)
- Added `getRunStart()` dynamic resolver function
- Attach `__candidateIds` as non-enumerable property
- Attach `__blockResults` with per-block story IDs (time, entity, ann, slug)
- Added `[CANDIDATES]` log showing from_this_run count

### 3. hybrid-clustering.js
- Added `LOG_PHASE0` environment flag (`LOG_PHASE0_DIAGNOSTICS=true`)
- Added `seenTitlesThisRun` Map for duplicate detection (stores FIRST occurrence only)
- Added `normalizeTitle()` function
- Added `resetRunState()` export
- Added diagnostic logs:
  - `[DECISION]` - before creating new story, shows best match details
  - `[ABOUT_TO_DUP]` - when about to create duplicate (pre-creation)
  - `[STORY_CREATED]` - after story creation
  - `[DUP_IN_RUN]` - confirmed duplicate with `expected_in_candidates` field
  - `[DUP_IN_RUN_DETAIL]` - per-block visibility breakdown

### 4. docs/plans/ttrc-321-batch-dedup.md
- Full implementation plan with Phase 0, 1, 2 details

## How to Test

```bash
LOG_PHASE0_DIAGNOSTICS=true gh workflow run "RSS Tracker - TEST" --ref test
```

## What to Look For

### Smoking Gun (Confirms Hypothesis)
```
[DUP_IN_RUN] article_id=X normalized_title="epstein files" created_story=15301 first_seen_story=15300 expected_in_candidates=false candidate_count=45
[DUP_IN_RUN_DETAIL] time_has_expected=false entity_has_expected=false ann_has_expected=false slug_has_expected=false
```

`expected_in_candidates=false` proves the story wasn't visible.

### Alternative Result (Scoring Issue)
```
[DUP_IN_RUN] ... expected_in_candidates=true ...
[DECISION] ... best_story_id=15300 best_total=0.650 ...
```

`expected_in_candidates=true` means story WAS visible but didn't score high enough.

## Next Steps

| Result | Action |
|--------|--------|
| `expected_in_candidates=false` | Confirms hypothesis - proceed to Phase 1 (same-run dedup safety net) |
| `expected_in_candidates=true` | Scoring/guardrail issue - investigate why story didn't match |
| No `[DUP_IN_RUN]` logs | Either no duplicates in run, or need more test data |

## Cleanup Required After Phase 0

1. Remove `created_at` from SELECT statements in candidate-generation.js
2. Set `LOG_PHASE0_DIAGNOSTICS=false` (or remove env var)

## JIRA Status

- **Ticket:** TTRC-321
- **Status:** Ready for Test
- **Comment:** Implementation details added

## Files Modified

- `scripts/rss-tracker-supabase.js`
- `scripts/rss/candidate-generation.js`
- `scripts/rss/hybrid-clustering.js`
- `docs/plans/ttrc-321-batch-dedup.md`

## AI Code Review

**Result:** PASSED (no blockers)

## Related Documentation

- Plan: `docs/plans/ttrc-321-batch-dedup.md`
- Previous work: TTRC-302, TTRC-315, TTRC-319, TTRC-320

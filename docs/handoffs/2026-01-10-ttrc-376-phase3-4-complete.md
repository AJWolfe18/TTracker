# Handoff: TTRC-376 Phase 3 & 4 Complete

**Date:** 2026-01-10
**Ticket:** TTRC-376
**Status:** DONE

---

## Summary

Completed full database index cleanup and merge/split feature removal across both TEST and PROD.

---

## What Was Done

### Phase 3 (PR #41)
- Added 2 FK indexes on `openai_usage` (article_id, story_id)
- Dropped 21 unused indexes:
  - 10 job queue indexes (deprecated per TTRC-369)
  - 2 geo indexes (never deployed)
  - 2 experimental indexes (simhash, tfidf)
  - 7 merge/split indexes (dormant since Oct 2025)

### Phase 4 (PR #42)
- Dropped `idx_stories_status` (redundant - covered by `ix_stories_status_first_seen`)
- Dropped `story_merge_actions` table (empty)
- Dropped `story_split_actions` table (empty)
- Dropped `merged_into_story_id` column from stories
- Updated CHECK constraint (removed 'merged_into' status)
- Archived 9 merge/split scripts to `scripts/archive/merge-split/`
- Removed dead imports from `job-queue-worker.js`

---

## Files Changed

### Migrations Created
- `migrations/053_add_fk_indexes.sql`
- `migrations/054_drop_unused_indexes.sql`
- `migrations/055_phase4_final_cleanup.sql`

### Scripts Archived
```
scripts/archive/merge-split/
├── analyze-recent-merges.mjs
├── auto-split.js
├── check-would-have-merged.mjs
├── enqueue-merge-job.js
├── filter-new-merge-candidates.js
├── merge-logic.js
├── merge-thresholds.js
├── periodic-merge.js
└── validate-merge-quality.js
```

### Code Modified
- `scripts/job-queue-worker.js` - Removed dead imports and methods

---

## Verification

| Environment | QA Tests | RSS Tracker |
|-------------|----------|-------------|
| TEST | ✅ 4/4 passed | ✅ Success |
| PROD | N/A | ✅ Success |

---

## Known Issue

AI code review workflow has configuration issue (fails with 0s execution). Not blocking - unrelated to code changes.

---

## Next Steps

TTRC-376 is complete. No remaining phases.

Optional future work:
- Fix AI code review workflow configuration
- Consider dropping `job_queue` table entirely (deprecated per TTRC-369)

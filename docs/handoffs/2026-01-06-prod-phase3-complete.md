# PROD Deployment Phase 3 - COMPLETE

**Date:** 2026-01-06
**Status:** COMPLETE (with fixes applied)
**JIRA:** TTRC-361

---

## Summary

Phase 3 is complete. First RSS run on PROD succeeded after fixing multiple gaps between test and main branches.

---

## What Was Completed

### 1. PR Merged to Main
- PR #23: Workflow guards + rss-enqueue security (squash merged)
- PR #24: upload-artifact v3 → v4 fix
- PR #25: package.json sync (missing openai, rss-parser, etc.)
- PR #26: scripts/rss/, scripts/lib/, scripts/enrichment/ sync
- PR #27: scripts/utils/ sync

### 2. Feeds Copied to PROD
- 18 active feeds copied from TEST to PROD
- All feeds include `filter_config` for article filtering
- Added missing columns: `filter_config`, `last_response_time_ms`, `consecutive_successes`, `source_tier`

### 3. Pipeline Validated
- `claim_next_job('fetch_feed')` works ✅
- Enqueue/claim/delete cycle verified ✅

### 4. First RSS Run
- Workflow `RSS Tracker - PROD` succeeded at 2026-01-06T23:50:33Z
- Run ID: 20765767016

---

## Critical Issues Found & Fixed

### Issue 1: Migration Numbering Collision
**Root Cause:** Multiple migrations share same number prefix (024, 025, 026, 027). Runbook applied wrong variants.

| Number | Runbook Applied | Actually Needed |
|--------|-----------------|-----------------|
| 024 | `024_include_stale_in_candidate_generation.sql` | `024_ttrc_255_feed_updates.sql` (adds filter_config) |
| 026 | `026_story_split_audit.sql` | `026_backfill_filter_configs.sql` |

**Fix:** Manually added missing columns via SQL Editor.

**Lesson:** Use unique migration numbering (timestamps) in future.

### Issue 2: Main Branch Missing Files
**Root Cause:** test branch had evolved significantly but package.json and scripts/ weren't synced to main.

**Missing on main:**
- `openai`, `rss-parser`, `jsdom`, and 7 other npm packages
- `scripts/rss/` folder (entire RSS pipeline)
- `scripts/lib/` folder (embedding config, entity normalization)
- `scripts/utils/` folder (network, retry helpers)
- `scripts/enrichment/` folder

**Fix:** Created PRs #25, #26, #27 to sync from test.

### Issue 3: Deprecated GitHub Action
**Error:** `actions/upload-artifact@v3` deprecated and blocked by GitHub.

**Fix:** PR #24 upgraded to `@v4`.

---

## Verification Checklist

- [x] PR merged to main
- [x] Feeds copied (18 active feeds with filter_config)
- [x] Pipeline validated (enqueue/claim/delete)
- [x] First RSS run succeeded
- [ ] Verify trumpytracker.com loads (user to check)
- [ ] Verify stories/articles created in PROD (user to check)

**SQL to verify data:**
```sql
SELECT
  (SELECT COUNT(*) FROM stories) as story_count,
  (SELECT COUNT(*) FROM articles) as article_count,
  (SELECT COUNT(*) FROM article_story) as junction_count;
```

---

## Still TODO (Next Session)

1. **Verify frontend** - Check trumpytracker.com displays stories
2. **Monitor for 1 hour** - Watch for errors in subsequent runs
3. **Fix runbook documentation**:
   - Change `claim_runnable_job()` → `claim_next_job()`
   - Add note about test/main script sync requirement
   - Add note about migration numbering collision issue
4. **Update JIRA TTRC-361** with final completion
5. **Consider:** RSS_TRACKER_RUN_ENABLED was showing `false` in logs - may need to check GitHub vars

---

## Files Modified/Created This Session

### PRs Merged to Main
| PR | Title |
|----|-------|
| #23 | PROD Phase 3: Workflow guards + rss-enqueue security |
| #24 | fix(workflow): upgrade upload-artifact to v4 |
| #25 | fix(deps): sync package.json with test branch |
| #26 | feat: sync RSS scripts from test to main |
| #27 | feat: sync scripts/utils from test |

### PROD Database Changes
- Added columns to `feed_registry`: `filter_config`, `last_response_time_ms`, `consecutive_successes`
- Inserted 18 feeds with filter configurations

---

## JIRA Comments Added

Added to TTRC-361:
- Migration numbering collision discovery
- Phase 3 progress update

---

## Resume Prompt for Next Session

```
Resume from docs/handoffs/2026-01-06-prod-phase3-complete.md

Phase 3 is COMPLETE. First RSS run succeeded.

Remaining tasks:
1. Verify trumpytracker.com loads and shows stories
2. Check PROD database has stories/articles created
3. Monitor next scheduled RSS run (every 2 hours)
4. Update runbook documentation with lessons learned
5. Update JIRA TTRC-361 with final status
6. Consider Phase 5 (key rotation) if needed
```

---

## Quick Reference

- **PROD Supabase:** https://supabase.com/dashboard/project/osjbulmltfpcoldydexg
- **PROD Site:** https://trumpytracker.com
- **GitHub Actions:** https://github.com/AJWolfe18/TTracker/actions
- **Successful RSS Run:** https://github.com/AJWolfe18/TTracker/actions/runs/20765767016

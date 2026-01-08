# PROD Audit Session Complete

**Date:** 2026-01-07
**Status:** ✅ Critical fix applied, hardening pending
**JIRA:** TTRC-362

---

## Session Summary

Comprehensive PROD audit after deployment. Found and fixed the critical missing RPC. Identified remaining hardening tasks.

---

## What Was Done

### 1. Documentation Sync
- **53 docs committed to test** (38 handoffs + 15 plans)
- **PR #30 created** - Docs + CLAUDE.md sync to main
  - URL: https://github.com/AJWolfe18/TTracker/pull/30
  - Includes `CLAUDE.md` (was missing from main)
  - Includes `docs/plans/2026-01-07-prod-audit-plan.md`

### 2. PROD Reality Check (Phase 0 Queries)

| Query | Result |
|-------|--------|
| 0a: RSS tables | ✅ All 6 exist (stories, articles, article_story, job_queue, feed_registry, budgets) |
| 0b: Migration history | No tracking table (migrations applied manually) |
| 0c: Sentinels | 3/4 pass (`articles.guid` column missing) |
| 0d: Activity | ✅ All timestamps from TODAY - RSS is actively running |

**Verdict:** PROD IS LIVE RSS - not ghost hunting. Missing RPCs are real issues.

### 3. RPC Signature Audit

| RPC | Status |
|-----|--------|
| `find_similar_stories` | ✅ EXISTS |
| `claim_next_job` | ✅ EXISTS |
| `finish_job` | ✅ EXISTS (2 overloads) |
| `get_embedding_similarities` | ❌ **WAS MISSING** → ✅ **FIXED** |
| `increment_story_entities` | ✅ EXISTS |
| `update_story_latest_article_published_at` | ✅ EXISTS |
| `recompute_story_centroids` | ✅ EXISTS |
| `update_story_lifecycle_states` | ✅ EXISTS |
| `upsert_article_and_enqueue_jobs` | ✅ EXISTS |
| `get_unclustered_articles` | ✅ EXISTS |
| All budget/lock RPCs | ✅ EXISTS |

**Key finding:** Only ONE RPC was missing (not 9+ as initially explored).

### 4. Critical Fix Applied

**Migration 050** created and applied to PROD:
- File: `migrations/050_get_embedding_similarities.sql`
- Function: `get_embedding_similarities(double precision[], bigint[])`
- Permissions granted to anon, authenticated, service_role
- **Verified working** in PROD

**Impact:** Clustering should now use embedding similarity (45% of score) instead of falling back to 0.

---

## Schema Gap Identified

### `articles.guid` Column

| Environment | Status |
|-------------|--------|
| TEST | Has dedicated `guid` column |
| PROD | Stores guid in `metadata` JSONB |

**Impact:** Low - RSS is functioning. GUID is captured in metadata.
**Recommendation:** Add column to PROD for parity (not urgent).

---

## Remaining Hardening Tasks

From `docs/plans/2026-01-07-prod-audit-plan.md`:

### P0 - Stop the Bleeding
1. [ ] **Create `lib/env-validation.js`** - Centralized TARGET_ENV + project ref validation
2. [ ] **Remove PROD fallbacks** - Fail closed with banner (UI) / throw (scripts)
3. [ ] **Add workflow branch guards** - All scheduled workflows
4. [ ] **Universal kill-switch** - `vars.ENABLE_PROD_SCHEDULES` on all workflows

### P1 - Prevention
5. [ ] **Create CI lint** - `.github/workflows/lint-prod-refs.yml`
6. [ ] **Add `articles.guid` column** - Schema parity with TEST

### Optional
7. [ ] **GitHub Environments** - Lock secrets to prod/test environments

---

## Files Changed This Session

| File | Change |
|------|--------|
| `docs/handoffs/*.md` (38 files) | Added to test |
| `docs/plans/*.md` (15 files) | Added to test |
| `docs/plans/2026-01-07-prod-audit-plan.md` | Created - comprehensive audit plan |
| `migrations/050_get_embedding_similarities.sql` | Created and applied to PROD |

---

## Key Documents

- **Audit Plan:** `docs/plans/2026-01-07-prod-audit-plan.md`
- **PR #30:** https://github.com/AJWolfe18/TTracker/pull/30
- **Migration 050:** `migrations/050_get_embedding_similarities.sql`

---

## Verification Commands

```bash
# Check clustering improvement after next RSS run
# Look for "embedding similarity" in logs instead of "fallback to 0"

# Trigger RSS manually to test
gh workflow run "RSS Tracker - PROD" --ref main
```

```sql
-- Verify RPC exists in PROD
SELECT has_function_privilege('anon', 'public.get_embedding_similarities(double precision[], bigint[])', 'execute');
-- Should return: true
```

---

## Resume Prompt

```
Resume from docs/handoffs/2026-01-07-prod-audit-session.md

PROD audit complete. Critical fix applied.

Done:
- get_embedding_similarities RPC added to PROD (migration 050)
- PR #30 open for docs + CLAUDE.md sync to main
- Audit plan documented at docs/plans/2026-01-07-prod-audit-plan.md

Remaining hardening:
1. Create lib/env-validation.js (TARGET_ENV + project ref validation)
2. Remove hardcoded PROD fallbacks (fail closed)
3. Add workflow branch guards + kill-switch
4. Create CI lint-prod-refs.yml
5. Add articles.guid column for schema parity

See audit plan for detailed implementation patterns.
```

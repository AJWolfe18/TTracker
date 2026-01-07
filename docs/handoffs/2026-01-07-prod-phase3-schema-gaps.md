# PROD Deployment - Schema Gaps Found

**Date:** 2026-01-07
**Status:** BLOCKED - Schema gaps preventing data creation
**JIRA:** TTRC-361

---

## Session Summary

Phase 3 backend is complete (PRs #23-28 merged), but RSS tracker creates 0 articles due to multiple schema gaps between TEST and PROD.

---

## What Was Fixed This Session

### 1. Kill Switch (PR #28) ✅
- Changed `RSS_TRACKER_RUN_ENABLED: 'false'` → `'true'`
- Uncommented cron schedule (every 2 hours)
- **Merged and working**

### 2. pgcrypto Extension ✅
- Added: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
- Located in `extensions` schema (correct per Supabase best practice)

### 3. digest() Function Fix ✅
- Ran migration `032_fix_digest_migration_028.sql`
- Changed `digest()` → `extensions.digest(convert_to(...))`
- **Verified working**

---

## BLOCKING: Schema Gaps Found

### Gap 1: `articles.excerpt` column missing

**Error:**
```
column "excerpt" of relation "articles" does not exist
```

**Fix Required:**
```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS excerpt TEXT;
```

### Gap 2: Possibly more columns missing

After fixing `excerpt`, there may be more. Run this to compare:

```sql
-- In PROD, check articles columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'articles'
ORDER BY ordinal_position;
```

Compare with TEST schema.

---

## Root Cause Analysis

The Phase 1 handoff said "Groups A-F (001-045) applied" but several schema elements are missing:
- `pgcrypto` extension wasn't enabled
- Migration 032 (`extensions.digest()` fix) wasn't applied or was overwritten
- `articles.excerpt` column missing

**Theory:** Either migrations were applied out of order, or some failed silently.

---

## Verified Working

| Component | Status |
|-----------|--------|
| RSS workflow trigger | ✅ Works |
| Kill switch | ✅ Enabled |
| Cron schedule | ✅ Active (every 2 hours) |
| 18 feeds configured | ✅ Present |
| `upsert_article_and_enqueue_jobs` function | ✅ Uses extensions.digest() |

---

## Still Blocked

| Issue | Status | Fix |
|-------|--------|-----|
| `articles.excerpt` missing | ❌ | `ALTER TABLE articles ADD COLUMN excerpt TEXT` |
| Frontend not synced | ❌ | PR #29 needed - copy public/ from test |
| Old UI showing | ❌ | Blocked by frontend sync |

---

## Recommended Next Steps

### 1. Fix Schema (5 min)
```sql
-- Run in PROD SQL Editor
ALTER TABLE articles ADD COLUMN IF NOT EXISTS excerpt TEXT;

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'articles' AND column_name = 'excerpt';
```

### 2. Re-run RSS Tracker
```bash
gh workflow run "RSS Tracker - PROD" --ref main
```

### 3. Check for More Gaps
If more errors appear, compare PROD vs TEST schema systematically.

### 4. Frontend Sync (After Data Works)
Create PR #29 to sync `public/` folder with URL fixes.

---

## Files Changed This Session

| File | Change |
|------|--------|
| `.github/workflows/rss-tracker-prod.yml` | PR #28: Kill switch + cron enabled |
| PROD DB: pgcrypto | Created extension |
| PROD DB: upsert function | Applied migration 032 |

---

## Resume Prompt

```
Resume from docs/handoffs/2026-01-07-prod-phase3-schema-gaps.md

PROD RSS is BLOCKED by schema gaps.

Immediate fix needed:
1. Run: ALTER TABLE articles ADD COLUMN IF NOT EXISTS excerpt TEXT;
2. Re-run RSS tracker
3. Check for more errors

After data flows:
- Frontend sync (PR #29) still needed
```

---

## Quick Reference

- **PROD Supabase:** https://supabase.com/dashboard/project/osjbulmltfpcoldydexg
- **GitHub Actions:** https://github.com/AJWolfe18/TTracker/actions
- **Last RSS Run:** 20767248393 (failed: excerpt missing)
- **Plan File:** `C:\Users\Josh\.claude\plans\gentle-fluttering-mccarthy.md`

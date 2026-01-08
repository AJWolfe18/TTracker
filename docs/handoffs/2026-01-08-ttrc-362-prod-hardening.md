# PROD Hardening Complete

**Date:** 2026-01-08
**Status:** ✅ Complete
**JIRA:** TTRC-362
**Commit:** 5eac7a7

---

## Summary

Implemented "fail closed" pattern for PROD safety. Scripts now throw on misconfiguration instead of falling back to PROD. Added global kill-switch for scheduled workflows.

---

## What Was Done

### 1. Centralized Environment Validation
**File:** `lib/env-validation.js` (NEW)

- Validates `TARGET_ENV` or `ENVIRONMENT` is exactly "prod" or "test" (catches typos)
- Validates `SUPABASE_URL` matches expected project ref for the declared environment
- Optional checks for `SUPABASE_SERVICE_KEY` and `SUPABASE_ANON_KEY`
- Throws immediately on misconfiguration (fail closed)

### 2. Removed PROD Fallbacks

| File | Change |
|------|--------|
| `scripts/daily-tracker-supabase.js` | Removed hardcoded PROD URL/key fallbacks |
| `config/supabase-config-node.js` | Removed hardcoded PROD URL/key fallbacks |

Both now import `validateEnv()` and throw if environment isn't properly configured.

### 3. Kill-Switch for Scheduled Workflows

Added `ENABLE_PROD_SCHEDULES` repo variable check to 4 workflows:

| Workflow | Effect |
|----------|--------|
| `rss-tracker-prod.yml` | Scheduled runs blocked unless `ENABLE_PROD_SCHEDULES=true` |
| `job-scheduler.yml` | Both jobs blocked on schedule |
| `story-merge.yml` | Scheduled runs blocked |
| `executive-orders-tracker.yml` | Scheduled runs blocked |

**Key feature:** `workflow_dispatch` (manual runs) still work when kill-switch is off. You're not locked out during an outage.

### 4. CI Lint for PROD Refs
**File:** `.github/workflows/lint-prod-refs.yml` (NEW)

Scans `public/`, `scripts/`, `config/`, `.github/` for hardcoded PROD project ref or hostname. Fails PR if found outside allowlist.

**Allowlist:**
- `lib/env-validation.js` (constants)
- `public/supabase-browser-config.js` (browser env detection)
- `legacy/` directory
- `*-backup*` files
- `dashboard-*.js` (legacy, not used by main site)
- `data-health-monitor.js` (intentional PROD monitoring)
- `batch/` directory (legacy Windows scripts)

### 5. Migration 051 (Schema Parity)
**File:** `migrations/051_articles_guid_column.sql` (NEW)

Adds `guid` column to `articles` table with partial index (`WHERE guid IS NOT NULL`).
- For TEST/PROD schema parity
- Low impact (RSS works fine with guid in metadata JSONB)

---

## User Actions Required

### 1. Enable PROD Schedules
Go to GitHub repo → Settings → Secrets and variables → Variables

Add variable:
- **Name:** `ENABLE_PROD_SCHEDULES`
- **Value:** `true`

Without this, scheduled workflows on main won't run.

### 2. Apply Migration 051 to PROD
Go to Supabase PROD dashboard → SQL Editor

Run contents of `migrations/051_articles_guid_column.sql`

---

## Files Changed

| Action | File |
|--------|------|
| CREATE | `lib/env-validation.js` |
| EDIT | `scripts/daily-tracker-supabase.js` |
| EDIT | `config/supabase-config-node.js` |
| EDIT | `.github/workflows/rss-tracker-prod.yml` |
| EDIT | `.github/workflows/job-scheduler.yml` |
| EDIT | `.github/workflows/story-merge.yml` |
| EDIT | `.github/workflows/executive-orders-tracker.yml` |
| CREATE | `.github/workflows/lint-prod-refs.yml` |
| CREATE | `migrations/051_articles_guid_column.sql` |

---

## Verification

```bash
# Check PROD refs are removed from key files
grep -n "osjbulmltfpcoldydexg" scripts/daily-tracker-supabase.js config/supabase-config-node.js
# Should return nothing

# AI code review passed
gh run list --workflow="ai-code-review.yml" --limit 1
# Status: completed, success
```

---

## Files Still Flagged by Lint (Intentional)

These will be flagged if modified but are allowlisted or expected:
- `scripts/check-missing-eo-fields.js` - One-off diagnostic utility
- `config/supabase-config.js` - Legacy config (superseded by supabase-config-node.js)

---

## Resume Prompt

```
Resume from docs/handoffs/2026-01-08-ttrc-362-prod-hardening.md

PROD hardening complete.

Done:
- lib/env-validation.js created (centralized validation)
- PROD fallbacks removed from scripts (fail closed)
- Kill-switch added to 4 scheduled workflows
- CI lint created for PROD refs
- Migration 051 created (articles.guid)

User must:
1. Set ENABLE_PROD_SCHEDULES=true in GitHub repo variables
2. Apply migration 051 to PROD via Supabase SQL Editor
```

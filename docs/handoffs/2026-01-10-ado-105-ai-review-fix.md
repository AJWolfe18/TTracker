# Handoff: ADO-105 AI Code Review Fix

**Date:** 2026-01-10
**Ticket:** ADO #105 (Closed)
**Status:** Complete

## What We Fixed

### 1. AI Code Review YAML Parse Error
**Root Cause:** Heredoc content at column 0 inside `run: |` block caused YAML parser to think block ended. The next `{` was interpreted as YAML flow syntax.

**Fix Applied:**
- Replaced heredoc with printf statements (no indentation issues)
- Added `shell: bash` + `set -euo pipefail` for robustness
- Added null-safe jq extraction (`// ""` prevents null string)
- Replaced Unicode chars (`≤` → `<=`, `⚠️` → `WARNING:`)
- Added `.gitattributes` to enforce LF line endings for workflows

**PR:** #43 (merged to main)

### 2. Legacy Frontend Files with Hardcoded PROD URLs
**Issue:** Lint workflow was failing because old frontend files had hardcoded PROD Supabase URLs.

**Files Deleted:**
- `public/legacy/*` (on main) - 19 files with hardcoded PROD refs
- `scripts/archive/legacy-frontend/*` (on test) - same files, different location

**Why Different Locations:** Test branch had reorganized files in TTRC-370, but that commit was never promoted to main.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| **No push trigger on AI review** | PR-only is sufficient; push trigger would need pr.json handling fix |
| **Delete legacy files (not allowlist)** | Files had hardcoded PROD URLs and were deployed to public/ |
| **Keep GPT-5 for now** | AI review caught a real bug; evaluate Codex as alternative later |

## Current State

| Item | Status |
|------|--------|
| AI Code Review workflow | ✅ Working (PR-only trigger) |
| Lint PROD References | ✅ Passing on all branches |
| ADO #105 | ✅ Closed |
| Main branch | ✅ Clean |
| Test branch | ✅ Clean |

## What the Red X's Meant

The workflow failures for the past 1-2 days were:
1. **YAML parse errors** - GitHub couldn't parse the workflow file (now fixed)
2. **Lint failures** - Hardcoded PROD URLs in legacy files (now deleted)

**Important:** These were warnings only - main branch has NO required status checks, so:
- Merges still worked
- Deploys still happened
- Bad code could reach prod

**Recommendation:** Add required status checks to main branch.

---

## UPDATE: Unpromoted Commits Investigation (Complete)

### Investigation Results

**Key Finding:** Main and test are much more in sync than the 555 commit count suggests.

| Category | % | Explanation |
|----------|---|-------------|
| Same code, different hash | ~80% | PRs create merge commits with different hashes |
| Documentation/handoffs | ~15% | Intentionally test-only |
| Dead file cleanup | ~5% | Now addressed via PR #44 |

### Verified: All Critical Code Already on Main

| Component | Status |
|-----------|--------|
| Workflows | ✅ Identical (AI review fix merged) |
| Edge Functions | ✅ Identical (security fixes already deployed) |
| Migrations | ✅ Identical (DB changes promoted) |
| Core scripts | ✅ Identical |

### What Was Actually Different

**Dead backup files (now fixed):**
- 19 old backup/test files existed on main but were cleaned up on test (TTRC-370)
- PR #44 created to delete these (~6,400 lines of dead code)

### PR #44: Dead Backup Files Cleanup

**Files deleted from main:**
```
backups/dashboard-backup-before-noresults-fix.js
public/audit-dates.js
public/dashboard-backup-20250828.js
public/dashboard-backup-before-final-refactor.js
public/dashboard-backup-phase3-before.js
public/dashboard-backup-tabs.js
public/dashboard-cards-updated.js
public/dashboard-components.js
public/dashboard-corrupted.js
public/dashboard-refactored.js
public/dashboard-test-refactored.js
public/dashboard-ui-improvements.js
public/dashboard-utils.js
public/dashboard.js
public/move-tabs-script.js
public/refactoring-guide.js
public/spicy-summary-card.js
test-runs/check-eo-status.js
test-runs/check-political-status.js
```

---

## Files Changed This Session

- `.github/workflows/ai-code-review.yml` - heredoc → printf fix
- `.gitattributes` - new file, LF enforcement
- `public/legacy/*` - deleted (main via PR #43)
- `scripts/archive/legacy-frontend/*` - deleted (test)
- 19 backup files - deleted (main via PR #44)

## Summary

| PR | Description | Status |
|----|-------------|--------|
| #43 | AI review YAML fix + legacy file deletion | ✅ Merged |
| #44 | Dead backup files cleanup | ⏳ Open |

**Main and test are now in sync** for all critical code. The only differences are:
- Documentation/handoffs (intentionally test-only)
- Claude config additions (optional to promote later)

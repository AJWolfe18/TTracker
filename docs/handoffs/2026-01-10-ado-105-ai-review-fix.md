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

## NEXT SESSION: Investigate Unpromoted Commits

### The Problem
**555 commits on test that aren't on main.** Many are docs/handoffs, but some are real code:

### Priority Commits to Review

| Commit | Description | Should Promote? |
|--------|-------------|-----------------|
| `5eac7a7` | PROD hardening - fail closed (TTRC-362) | ⚠️ Review - security |
| `bfc21d4` | EDGE_CRON_TOKEN auth (TTRC-361) | ⚠️ Review - security |
| `d573652` | Remove hardcoded prod url, use env vars | ⚠️ Review |
| `8975d95` | upload-artifact v4 (deprecated v3) | ✅ Probably yes |
| `36e0f58` | Enhanced ARTICLE_DECISION logs | ✅ Probably yes |
| `7b674ca` | UTC year fix (timezone off-by-one) | ✅ Probably yes |
| `fad84ef` | TTRC-376 phase 4 (index cleanup) | ❓ DB already done? |
| `5701160` | TTRC-376 FK indexes | ❓ DB already done? |

### Key Questions to Answer

1. **DB migrations (TTRC-376, TTRC-366):** Were these run directly in prod? If so, the commits are just documentation and don't need PRs.

2. **Security changes (TTRC-362, TTRC-361):** Were Edge Functions deployed to prod separately? Check if prod has the token auth.

3. **Workflow changes:** Some are test-only (disable schedules), some should go to main (artifact v4).

### How to Investigate

```bash
# See all code changes on test not on main
git log --oneline origin/main..origin/test -- "*.js" "supabase/functions/**" ".github/workflows/**"

# Check a specific commit
git show <commit> --stat

# Check if Edge Function is deployed to prod
supabase functions list --project-ref osjbulmltfpcoldydexg
```

### Recommended Approach

1. **Categorize commits:** test-only vs should-promote
2. **Verify prod state:** Check if security/DB changes are already live
3. **Create focused PRs:** One per ticket (TTRC-362, TTRC-361, etc.)
4. **Add branch protection:** Require lint to pass before merge to main

---

## Files Changed This Session

- `.github/workflows/ai-code-review.yml` - heredoc → printf fix
- `.gitattributes` - new file, LF enforcement
- `public/legacy/*` - deleted (main)
- `scripts/archive/legacy-frontend/*` - deleted (test)

## Commands for Next Session

```bash
# Check what's on test not main (code only)
git log --oneline origin/main..origin/test -- "*.js" "*.ts" "supabase/functions/**"

# Check prod Edge Functions
supabase functions list --project-ref osjbulmltfpcoldydexg

# Create PR for specific commits
git checkout -b deploy/ttrc-XXX origin/main
git cherry-pick <commit>
gh pr create --base main
```

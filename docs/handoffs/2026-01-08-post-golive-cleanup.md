# Post-Go-Live Repository Cleanup Handoff

**Date:** 2026-01-08
**Ticket:** N/A (Housekeeping)
**Branch:** test
**Status:** COMPLETE (with follow-up items)

---

## Summary

Comprehensive repository cleanup after PROD go-live (TTRC-361/362). Resolved CI blockers, cleaned git state, merged branches, and closed stale PRs.

---

## What Was Done

### Phase 1-9: Core Cleanup (COMPLETE)

| Phase | Action | Status |
|-------|--------|--------|
| 0 | Pre-flight PROD ref searches | Done |
| 1 | Fix CI blocker (config/supabase-config.js) - lazy getter pattern | Done |
| 2 | Delete garbage files (_ul*) | Done |
| 3 | Update .gitignore (idempotent) | Done |
| 4 | Commit handoff + move schema to docs/ | Done |
| 5 | Close PR #21 (stale Mozilla Readability) | Done |
| 6 | Extract stash patches, clear stashes | Done |
| 7 | Merge main→test (27 conflicts resolved) | Done |
| 8 | Prune 6 stale local branches | Done |
| 9 | Verify CI passing | Done |

### Additional Actions

| Action | Status |
|--------|--------|
| Close PR #18 (stale test→main) | Done |
| Merge PR #30 (docs sync to main) | Done |
| Fix lint-prod-refs for main branch (PR #32) | Done |

---

## Key Decisions Made

### 1. PR #18 Closure (519 commits "missing" from main)
**Analysis:** The 519 commits on test not on main are NOT missing production code. They are:
- Test environment configuration (TEST_BRANCH_MARKER.md, etc.)
- Development iterations (same code, different SHAs from cherry-picks)
- Documentation/handoffs
- 531 files that exist only on test (intentionally not deployed)

**Proof:**
- Critical scripts (rss-tracker-supabase.js, etc.) are IDENTICAL (SHA256 verified)
- PROD workflows succeed (19/20 success rate)
- Site returns HTTP 200

### 2. lint-prod-refs Workflow Fix
**Problem:** The workflow was designed to catch PROD refs on test branch, but ran on ALL branches including main where PROD refs are correct.

**Fix:** Added `branches-ignore: main` to skip the check on production branch.

### 3. Schema Divergence is Intentional
- **PROD (main):** Uses stories/articles (new) + political_entries (legacy) + executive_orders
- **TEST:** Has enhanced deduplication in daily-tracker (not yet deployed to PROD)

---

## Current State

### Git Status
- **Branch:** test (up to date)
- **Open PRs:** 0
- **Stashes:** Empty
- **Untracked:** Only `.claude/settings.local.json`

### CI Status
| Workflow | Status | Notes |
|----------|--------|-------|
| lint-prod-refs | Passing on test | Now skips main branch |
| rss-tracker-prod | Passing | 19/20 success |
| AI code review | Mixed | See follow-up section |

---

## Follow-Up Items (Check in Morning)

### 1. AI Code Review Workflow Failures
**Observation:** Multiple AI code review runs showing as "failure" with 0s runtime.

**Hypothesis:** The workflow only triggers on `pull_request` events, but GitHub Actions UI shows them as `push` events. This may be a display quirk, not actual failures.

**Action:**
- Check if new PRs get reviews
- Verify the one successful run (20804651297) vs failed ones
- May need to investigate workflow configuration

### 2. Verify Main Branch CI
After the lint-prod-refs fix (PR #32), verify:
```bash
gh run list --workflow="lint-prod-refs.yml" --branch main --limit 3
```
Should show the workflow no longer runs on main (or shows as skipped).

### 3. JIRA Status
The Atlassian MCP was returning 401 errors during this session. When it's working:
- Verify TTRC-211 epic status (should have 17 open tickets)
- Check if any tickets need closing based on this cleanup

---

## Files Modified

| File | Change |
|------|--------|
| `config/supabase-config.js` | Removed hardcoded PROD URL, added lazy getter pattern |
| `.github/workflows/lint-prod-refs.yml` | Added branches-ignore for main |
| `.gitignore` | Added `_ul*`, `_UL*`, `tmp/` patterns |
| `docs/schema/prod_base_schema_REFERENCE.sql` | Moved from migrations/ |

---

## Verification Commands

```bash
# Check CI status
gh run list --limit 5

# Verify branch sync
git log test..origin/main --oneline  # Should be empty
git log origin/main..test --oneline  # Shows test-ahead commits

# Check for PROD refs (should only be allowlisted files)
rg -n "osjbulmltfpcoldydexg" .

# Verify stashes cleared
git stash list

# Verify PRs
gh pr list --state open  # Should be empty
```

---

## Rollback Plan

If issues arise from the changes:

1. **lint-prod-refs fix:** Revert PR #32 if it causes issues
2. **config/supabase-config.js:** The original is preserved in git history
3. **Docs sync:** Pure documentation, no functional impact

---

## Session Stats

- **Duration:** ~2 hours
- **Commits:** 8 commits to test, 2 PRs to main
- **PRs Closed:** #18, #21
- **PRs Merged:** #30, #32
- **Conflicts Resolved:** 27 (merge main→test)
- **Branches Pruned:** 6

---

**Next Session:** Check AI code review workflow, verify JIRA status, continue with TTRC-211 remaining work.

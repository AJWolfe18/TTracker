# Handoff: Dev Process Improvements

**Date:** 2026-01-24
**Branch:** test
**No ADO ticket** - Infrastructure/process session

---

## Summary

Major overhaul of dev process: simplified ADO states, established ADO as source of truth, implemented feature flags, and switched PR code review to OpenAI Codex.

---

## Changes Made

### 1. Fixed CI Failures
- **Issue:** "Lint PROD References" failing on every test push
- **Cause:** `scripts/scotus/enrich-scotus.js` had PROD URL for detection (legitimate)
- **Fix:** Added to allowlist in `.github/workflows/lint-prod-refs.yml`

### 2. Closed Stale PR
- **PR #64** had 748 commits (entire test→main delta)
- Closed as unmergeable - future PRs should be small, focused cherry-picks

### 3. Feature Flag System
- **Files:** `public/shared/feature-flags.js`, `flags-test.json`, `flags-prod.json`
- **Guide:** `docs/guides/feature-flags.md`
- Auto-detects environment, supports URL overrides (`?ff_scotus=true`)
- **Not yet wired up** to actual code - ready for use when needed

### 4. Simplified ADO States
- **Before:** New → Todo → Active (Doing/Done) → Review → Testing → Ready for Prod → Closed
- **After:** New → Todo → Active → Testing → Ready for Prod → Closed
- Removed: Review (rarely used), Done sub-columns (not used)
- Updated `docs/guides/ado-workflow.md`

### 5. ADO as Source of Truth
- Status lives in ADO only (not plans, not handoffs)
- Plans are ephemeral (implementation details during active dev)
- Handoffs are brief (1 paragraph max)
- Issues/blockers go in ADO comments
- Updated CLAUDE.md TLDR and workflow sections

### 6. Pre-Commit Validation
- Updated `.claude/commands/validate.md`
- Now requires: code review (unless trivial) + ADO update
- Flags user if uncertain about ticket or scope

### 7. Codex Code Review
- **Setup:** OpenAI Codex now handles PR reviews (included in ChatGPT Plus $20/mo)
- **Trigger:** Comment `@codex review` on PR, or auto-reviews enabled
- **Config:** `AGENTS.md` defines review guidelines (P0/P1/P2 priorities)
- **Test:** PR #66 confirmed working - Codex responded
- **Old workflow:** Kept for now (running in parallel for comparison)
- Updated `docs/guides/pr-workflow.md`

---

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/lint-prod-refs.yml` | Added enrich-scotus.js to allowlist |
| `CLAUDE.md` | ADO source of truth, Codex for PRs, simplified workflow |
| `docs/guides/ado-workflow.md` | Simplified states, Testing definition |
| `docs/guides/pr-workflow.md` | Codex usage instead of custom GPT-5 |
| `docs/guides/prod-deployment-checklist.md` | Added feature flag sections |
| `docs/guides/feature-flags.md` | NEW - full feature flags guide |
| `.claude/commands/validate.md` | Added code review + ADO requirements |
| `public/shared/feature-flags.js` | NEW - flag loader |
| `public/shared/flags-test.json` | NEW - test env flags |
| `public/shared/flags-prod.json` | NEW - prod env flags |
| `AGENTS.md` | NEW - Codex review guidelines |

---

## Open Items

1. **PR #66** - Decide: merge (gets AGENTS.md to main) or close (test only)
2. **Delete old workflow** - Once confident in Codex, remove `.github/workflows/ai-code-review.yml`
3. **Wire up feature flags** - Integrate into actual frontend pages when ready
4. **Apply Codex suggestions** - Old GPT-5 found improvements for AGENTS.md (secrets in logs, RLS, idempotent jobs)

---

## Process Changes for Future Sessions

| Before | After |
|--------|-------|
| Track status in plans + handoffs | Track status in ADO only |
| Code review on 3+ files | Code review on any non-trivial change |
| GPT-5 API for PR reviews | `@codex review` (included in ChatGPT Plus) |
| Detailed handoffs | Brief handoffs (1 paragraph + ADO link) |

---

## Commands Reference

```bash
# Trigger Codex review on PR
gh pr comment <PR#> --body "@codex review"

# Check feature flags in browser
# Add ?ff_flagname=true to URL

# Pre-commit validation
/validate
```

---

**Token usage:** ~105K input, ~16K output

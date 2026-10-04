# PR Workflow & Code Review Guide

## Overview

This document covers the complete PR workflow for TrumpyTracker:
1. Branch protection rules
2. Claude Code development workflow
3. Code review (local only)
4. Deployment order for large features

---

## 1. Branch Protection

### Main Branch Rules
- **Direct pushes blocked** - All changes require PRs
- **PR required** - Even admins must use PRs
- **Squash merges only** - the repo disallows merge commits (`gh pr merge --squash`)
- **Auto-deploy** - Merged PRs deploy to trumpytracker.com

### GitHub Configuration
Settings → Branches → Add rule for `main`:
- ✅ Require pull request before merging
- ✅ Dismiss stale approvals
- ✅ Include administrators

---

## 2. Claude Code Workflow

### Standard Development Flow

```bash
# 1. Always work on test branch (or feature branch from test)
git checkout test

# 2. Make changes, commit
git add <files>
git commit -m "fix: description of change"

# 3. Push to test
git push origin test
# → Auto-deploys to Netlify TEST site

# 4. For PROD deployment: review locally first, then create the PR
git checkout -b deploy/feature-name main
git cherry-pick <commit-from-test>
git push origin deploy/feature-name
gh pr create --base main --title "feat: description"
```

### Branch Naming
| Type | Pattern | Example |
|------|---------|---------|
| Deployment | `deploy/feature-name` | `deploy/ttrc-376-indexes` |
| Hotfix | `hotfix/issue-name` | `hotfix/auth-bug` |

---

## 3. Code Review (all local)

Nothing reviews PRs on GitHub anymore:
- GitHub `@codex review` comments and automatic Codex PR reviews were retired August 25, 2026. Do not comment `@codex review` on a PR.
- The GPT API review workflow (`.github/workflows/ai-code-review.yml`) was deleted August 24, 2026.

Review happens **before** the PR is opened:
1. **In-session two-pass review** by Claude Code: pattern compliance and bugs, then production readiness. State the level run (medium or higher for non-trivial work).
2. **Josh runs Codex locally** on the change. Codex reads `AGENTS.md` at the repo root for the P0/P1/P2 rules.

Fix P0 and P1 findings before the PR. A PR to `main` is opened only after both passes are clean.

**Cost:** $0 extra. Codex runs on Josh's ChatGPT subscription and the Claude review on the Claude plan; neither uses API credits.

---

## 4. Large Feature Deployment Strategy

### Problem: Big PRs are hard to review and to roll back

Large PRs (migrations + edge functions + frontend + scripts in one) are slow to review and hard to revert piece by piece.

### Solution: Split PRs by Layer

**Key Insight:** Backend components can deploy to PROD before the feature is "live" because:
- Migrations don't affect users until code uses them
- Edge functions don't affect users until frontend calls them
- Only the **frontend** "activates" the feature for users (behind a feature flag, see `docs/guides/feature-flags.md`)

### Recommended Deployment Order

```
PR #1 - Migrations (invisible)
        └── Tables exist but nothing uses them

PR #2 - Edge Functions (invisible)
        └── Endpoints exist but nothing calls them

PR #3 - Backend Scripts (invisible)
        └── Scripts exist but data pipeline hasn't run

PR #4 - Frontend (ACTIVATES feature)
        └── Nav tab appears, users can access feature
        └── Run data pipeline after this merges
```

### Benefits

| Benefit | Why |
|---------|-----|
| **Easier review** | Smaller diffs for the local review passes |
| **Easier debugging** | If something fails, smaller scope to fix |
| **Incremental progress** | Backend ready before frontend complete |
| **Lower risk** | Each PR is smaller, easier to revert |

### When NOT to Split

- **Tightly coupled changes** - If migration + function must deploy together
- **Tiny features** - <5 files, just do one PR
- **Hotfixes** - Speed matters more than splitting

---

## 5. Configuration

| Item | Location |
|------|----------|
| Review guidelines (local Codex) | `AGENTS.md` (repo root) |
| PROD checklist | `docs/guides/prod-deployment-checklist.md` |
| Test-only files to skip on cherry-pick | `.claude/test-only-paths.md` |

---

**Last Updated:** 2026-10-04
**Related:** CLAUDE.md, `/docs/guides/security-checklist.md`

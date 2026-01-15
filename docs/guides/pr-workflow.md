# PR Workflow & AI Code Review Guide

## Overview

This document covers the complete PR workflow for TrumpyTracker:
1. Branch protection rules
2. Claude Code development workflow
3. AI code review system (automated GPT-5 reviews)

---

## 1. Branch Protection

### Main Branch Rules
- **Direct pushes blocked** - All changes require PRs
- **PR required** - Even admins must use PRs
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
git add .
git commit -m "fix: description of change"

# 3. Push to test
git push origin test
# → Auto-deploys to Netlify TEST site
# → AI review triggers (if risky files changed)

# 4. For PROD deployment: Create PR
git checkout -b deploy/feature-name
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

## 3. AI Code Review System

### How It Works

**Automatic Reviews** run when PRs modify risky files:
- `scripts/**/*.js` - Backend scripts
- `supabase/functions/**/*.js` - Edge Functions
- `migrations/**/*.sql` - Database changes
- `.github/workflows/**` - CI/CD
- `.github/scripts/**` - Automation

**Skipped Files** (never auto-reviewed):
- Documentation (`**/*.md`)
- Assets (`**/*.png`, `**/*.jpg`)
- Tests (`**/*test*`)

### Manual Trigger

For files not auto-reviewed (frontend, docs):
```
Add "ai:review" label to PR in GitHub UI
```

### Thorough Review Mode

For complex/critical changes:
```
Add BOTH labels:
1. "ai:review" (trigger)
2. "thorough" (deeper analysis)
```

---

## 4. Cost Optimization

| Review Type | Effort | Tokens | Cost | When to Use |
|-------------|--------|--------|------|-------------|
| **Default** | low | 2000 | ~$0.30 | Normal changes |
| **Thorough** | medium | 6000 | ~$1.00 | Complex/critical |

**Monthly Estimate:** $1-2/month (90% savings from path filtering)

**For unlimited analysis:** Paste PR link directly to Claude Code

---

## 5. Review Output

### PR Comment
- Posted by `github-actions` bot
- Formatted findings in markdown
- Link to workflow run

### GitHub Annotations
- Blockers appear as errors in Files Changed tab
- Inline at specific line numbers

### Workflow Logs
- Full review in Actions → workflow output
- Fallback if comment fails

---

## 6. Security Features

| Feature | Purpose |
|---------|---------|
| Fork Protection | Untrusted PRs require `ai:review` label |
| Concurrency Control | Cancels duplicate runs on rapid pushes |
| Size Guard | Skips trivial diffs (<5 lines) |
| Findings Cap | ≤10 total, ≤3 per file |

---

## 7. Examples

### Backend Change (Auto-Review)
```bash
# Edit scripts/rss-tracker-supabase.js
git commit -m "fix: handle empty feed response"
git push origin test
# ✅ AI reviews automatically
```

### Frontend Change (Manual Review)
```bash
# Edit public/index.html
git commit -m "feat: add dark mode"
gh pr create --title "Feature: Dark mode"
# ❌ Not auto-reviewed
# ✅ Add "ai:review" label in GitHub UI
```

### Complex Migration (Thorough Review)
```bash
# Edit migrations/056_new_schema.sql
gh pr create --title "feat(db): new schema"
# ✅ Auto-reviews (SQL in path filter)
# ✅ Add "thorough" label for deeper analysis
```

---

## 8. Large Feature Deployment Strategy

### Problem: Big PRs = Slow Reviews

| PR Size | Files | Review Time |
|---------|-------|-------------|
| Small | 3-5 files | ~3-5 min |
| Medium | 6-10 files | ~8-12 min |
| Large | 15+ files | 15-20+ min |

Large PRs (like a full feature with migrations + edge functions + frontend + scripts) can take 15-20 minutes to review, creating bottlenecks.

### Solution: Split PRs by Layer

**Key Insight:** Backend components can deploy to PROD before the feature is "live" because:
- Migrations don't affect users until code uses them
- Edge functions don't affect users until frontend calls them
- Only the **frontend** "activates" the feature for users

### Recommended Deployment Order

```
Week 1: PR #1 - Migrations (invisible)
        └── Tables exist but nothing uses them

Week 1: PR #2 - Edge Functions (invisible)
        └── Endpoints exist but nothing calls them

Week 2: PR #3 - Backend Scripts (invisible)
        └── Scripts exist but data pipeline hasn't run

Week 2: PR #4 - Frontend (ACTIVATES feature)
        └── Nav tab appears, users can access feature
        └── Run data pipeline after this merges
```

### Benefits

| Benefit | Why |
|---------|-----|
| **Faster reviews** | 3-5 min each vs 15-20 min combined |
| **Easier debugging** | If review fails, smaller scope to fix |
| **Incremental progress** | Backend ready before frontend complete |
| **Lower risk** | Each PR is smaller, easier to revert |

### Example: Pardons Feature (What We Should Have Done)

Instead of 1 PR with 17 files:

| PR | Contents | Review Time | Can Deploy |
|----|----------|-------------|------------|
| #1 | 5 migrations | ~3 min | Day 1 |
| #2 | 3 edge functions | ~4 min | Day 2 |
| #3 | 4 enrichment scripts | ~4 min | Day 3 |
| #4 | 2 frontend files + nav | ~3 min | Day 4 (LIVE) |

**Total review time:** ~14 min (but spread across days, not blocking)

### When NOT to Split

- **Tightly coupled changes** - If migration + function must deploy together
- **Tiny features** - <5 files, just do one PR
- **Hotfixes** - Speed matters more than review time

---

## 9. Troubleshooting

### Review Not Posting
1. Check workflow run in Actions tab
2. Verify `pull-requests: write` permission
3. Check for `review.md` in workflow logs

### Review Too Shallow
1. Add `thorough` label
2. Or paste PR link to Claude for unlimited analysis

### Fork PR Not Reviewing
1. Add `ai:review` label (required for forks)
2. Maintainer approval needed before secrets exposed

---

## 10. Configuration

| Item | Location |
|------|----------|
| Workflow | `.github/workflows/ai-code-review.yml` |
| Script | `.github/scripts/ai_review.sh` |
| API Key | Repository secret: `OPENAI_API_KEY` |
| Model | GPT-5 via OpenAI Responses API |

---

## 11. Setup Checklist

### GitHub
- [ ] Branch protection on `main`
- [ ] `OPENAI_API_KEY` in repo secrets
- [ ] AI review workflow committed

### Claude Code
- [ ] Supabase MCP connected
- [ ] Azure DevOps MCP configured
- [ ] PR workflow understood

---

**Last Updated:** 2026-01-12
**Related:** CLAUDE.md, `/docs/guides/security-checklist.md`

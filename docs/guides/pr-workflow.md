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

## 8. Troubleshooting

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

## 9. Configuration

| Item | Location |
|------|----------|
| Workflow | `.github/workflows/ai-code-review.yml` |
| Script | `.github/scripts/ai_review.sh` |
| API Key | Repository secret: `OPENAI_API_KEY` |
| Model | GPT-5 via OpenAI Responses API |

---

## 10. Setup Checklist

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

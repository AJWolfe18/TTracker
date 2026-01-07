# Claude Code PR-Only Workflow & AI Review System

## Overview
This document describes the PR-only workflow for Claude Code and the automated AI code review system using ChatGPT.

## 1. Branch Protection Setup

### Enforcing PR-Only Workflow
To prevent direct commits to main, configure branch protection:

1. Go to GitHub → Settings → Branches
2. Add branch protection rule for `main`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require approvals (1)
   - ✅ Dismiss stale pull request approvals
   - ✅ Include administrators
   - ✅ Require status checks to pass (optional)

This ensures ALL changes go through PRs, even from admins.

## 2. Claude Code Workflow

### Standard Development Flow
```bash
# 1. Create feature branch
git checkout -b fix/ttrc-145-description

# 2. Make changes
# Claude Code edits files...

# 3. Commit changes
git add .
git commit -m "fix: resolve issue description"

# 4. Push to feature branch
git push origin fix/ttrc-145-description

# 5. Create PR
gh pr create --title "Fix: Issue description (TTRC-145)" \
  --body "Detailed description of changes"

# 6. Trigger AI review (optional)
gh workflow run ai-code-review.yml -f pr_number=<PR_NUMBER>
```

### Claude Code Commands
When using Claude Code, instruct it to:
```
> Always work on a feature branch, never on main
> Create descriptive branch names like fix/issue-name
> Write clear commit messages
> Create PRs with detailed descriptions
> Never force push or bypass PR requirements
```

## 3. AI Code Review System

### How It Works

**Automatic Reviews** (90% cost reduction via path filtering):
- Triggered ONLY when risky files change:
  - `scripts/**/*.js` (Edge functions, workers)
  - `supabase/functions/**/*.js` (Supabase Edge Functions)
  - `migrations/**/*.sql` (Database schema changes)
  - `.github/workflows/**` (CI/CD changes)
  - `.github/scripts/**` (Build/automation scripts)
- Skips:
  - Documentation (*.md)
  - Assets (images, media)
  - Tests (*test*)
- **Cost**: ~$0.30 per review (low effort mode)

**Manual Trigger** (label-based):
- Add `ai:review` label to ANY PR to force review
- Add `thorough` label for deeper analysis (medium effort mode)
  - Costs ~$1.00 per review
  - Higher token limit (6000 vs 2000)
  - More comprehensive analysis
- Use for:
  - Frontend changes not in auto-review paths
  - Complex refactors needing extra scrutiny
  - When you want AI second opinion on any code

**Review Process**:
1. Computes diff between PR commits
2. Splits diff into chunks if needed
3. Sends to GPT-5 via Responses API
4. Generates GitHub annotations for blockers
5. Posts formatted review as PR comment
6. Auto-removes `ai:review` label after completion

**Additional Safeguards**:
- Fork protection (requires `ai:review` label for untrusted contributors)
- Size guard (skips reviews <5 lines changed)
- Concurrency control (cancels duplicate runs on rapid pushes)
- Findings cap (≤10 total, ≤3 per file)

### Review Focus Areas
- Security vulnerabilities
- Performance issues
- Code quality
- Potential bugs
- Best practices
- TrumpyTracker-specific patterns (cost optimization, cursor pagination, etc.)

### Cost Estimation (Optimized)

**With path filtering + size guards:**
- Auto-reviews triggered: ~2-5/month (only risky changes)
- Manual reviews: ~10-15/month (via `ai:review` label)
- **Total monthly cost: $1-2/month**

**Breakdown:**
- Low effort review: $0.30 each
- Medium effort (thorough): $1.00 each
- Previous cost (no filtering): $10-15/month
- **Savings: 90%**

**For unlimited analysis:** Paste PR link to Claude directly (no cost limit)

## 4. Setup Checklist

### GitHub Configuration
- [ ] Branch protection enabled on `main`
- [ ] OPENAI_API_KEY added to repo secrets
- [ ] AI review workflow committed
- [ ] GitHub token generated for Claude Code

### Claude Code Configuration
- [ ] GitHub MCP server added
- [ ] JIRA/Atlassian MCP configured (optional)
- [ ] Supabase TEST MCP connected
- [ ] PR-only workflow understood

---

*Last Updated: October 2025*

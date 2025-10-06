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
1. **Automatic Trigger**: Reviews run on every PR open/update
2. **Manual Trigger**: Can be triggered via workflow_dispatch
3. **Review Process**:
   - Extracts PR diff (up to 15KB)
   - Sends to ChatGPT for analysis
   - Posts review as PR comment
   - Adds "ai-reviewed" label

### Review Focus Areas
- Security vulnerabilities
- Performance issues
- Code quality
- Potential bugs
- Best practices
- TrumpyTracker-specific patterns

### Cost Estimation
- GPT-4: ~$0.03-0.10 per review
- GPT-3.5-turbo: ~$0.01 per review
- Monthly estimate (50 PRs): $1.50-$5.00

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

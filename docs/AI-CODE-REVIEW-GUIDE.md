# AI Code Review System Guide

## Overview
Automated GPT-5 code review with smart triggers to optimize costs while maintaining quality.

## How It Works

### Automatic Reviews (No Action Needed)
AI automatically reviews PRs that modify **risky files:**
- Backend: `scripts/**/*.js`, `supabase/functions/**/*.js`
- Database: `migrations/**/*.sql`
- CI/CD: `.github/workflows/**`, `.github/scripts/**`

### Skipped Files (Never Auto-Reviewed)
- Documentation: `**/*.md`
- Assets: `**/*.png`, `**/*.jpg`, `public/assets/**`
- Tests: `**/*test*`

### Manual Trigger
For files that don't auto-review (docs, frontend, etc.), add label:
```bash
# In GitHub UI, add "ai:review" label to PR
# AI reviews and automatically removes label after posting
```

### Thorough Review Mode
For complex changes needing deeper analysis:
```bash
# Add BOTH labels:
# 1. "ai:review" (trigger)
# 2. "thorough" (upgrade to medium effort + 6000 tokens)
```

## Cost Optimization

| Review Type | Effort | Tokens | Cost | When to Use |
|-------------|--------|--------|------|-------------|
| **Default** | low | 2000 | ~$0.30 | Normal code changes |
| **Thorough** | medium | 6000 | ~$1.00 | Complex/critical changes |

**Monthly Estimate:**
- Before optimization: ~$10-15 (30 PRs × $0.50)
- After optimization: ~$1-2 (3 auto + 2 manual × $0.30-1)
- **Savings: 90%**

## Review Output

### 1. PR Comment
- Posted automatically by `github-actions` bot
- Formatted markdown with findings
- Link to full workflow run

### 2. GitHub Annotations
- Blockers appear as errors in Files Changed tab
- Inline with code at specific line numbers
- Visible in workflow summary

### 3. Workflow Logs
- Full review always in workflow output
- Fallback if comment posting fails

## Security Features

### Fork Protection
- Untrusted PRs from forks **require** `ai:review` label
- Prevents secret leaks to external contributors

### Concurrency Control
- Cancels duplicate runs on rapid pushes
- Only latest review matters

### Size Guard
- Skips trivial diffs (<5 lines)
- Saves costs on typo fixes

## Workflow Triggers

### Automatic (Path-Based)
```yaml
paths:
  - 'scripts/**/*.js'
  - 'supabase/functions/**/*.js'
  - 'migrations/**/*.sql'
  - '.github/workflows/**'
  - '.github/scripts/**'
```

### Manual (Label-Based)
- Add `ai:review` label → triggers on ANY file
- Add `thorough` label → upgrades to medium effort

### Events
- **PR opened/updated:** Auto-review if paths match
- **PR labeled:** Review when `ai:review` added
- **Push to test:** Reviews unless docs-only (skips `docs/**`, `*.md`, `*.txt`)

## Examples

### Example 1: Backend Change (Auto-Review)
```bash
# Edit: scripts/job-queue-worker.js
git add scripts/job-queue-worker.js
git commit -m "fix: resolve job claim race condition"
git push origin fix/job-race

gh pr create --title "Fix: Job claim race condition"
# ✅ AI reviews automatically (matches path filter)
```

### Example 2: Frontend Change (Manual Review)
```bash
# Edit: public/index.html
git add public/index.html
git commit -m "feat: add dark mode toggle"
git push origin feat/dark-mode

gh pr create --title "Feature: Dark mode toggle"
# ❌ Not auto-reviewed (HTML not in path filter)
# ✅ Add "ai:review" label in GitHub UI to trigger
```

### Example 3: Complex Migration (Thorough Review)
```bash
# Edit: migrations/020_complex_schema_change.sql
git add migrations/020_complex_schema_change.sql
git commit -m "feat(db): add multi-tenant support"
git push origin feat/multi-tenant

gh pr create --title "Feature: Multi-tenant support"
# ✅ Auto-reviews (SQL in path filter)
# ✅ Add "thorough" label for deeper analysis
```

## Troubleshooting

### Review Not Posting
1. Check workflow run in Actions tab
2. Verify `pull-requests: write` permission
3. Check for `review.md` in workflow logs

### Review Too Shallow
1. Add `thorough` label to PR
2. Or paste PR link to Claude for unlimited analysis

### Review Too Expensive
1. Remove `thorough` label (defaults to low effort)
2. Let path filter skip non-critical files

### Fork PR Not Reviewing
1. Add `ai:review` label (required for forks)
2. Verifies maintainer approval before exposing secrets

## Configuration

### Workflow File
`.github/workflows/ai-code-review.yml`

### Script
`.github/scripts/ai_review.sh`

### Environment Variables
- `OPENAI_API_KEY`: Secret (required)
- `LLM_MODEL`: `gpt-5` (configured)
- `LLM_API_BASE`: OpenAI Responses API endpoint

## Cost Tracking

Monitor monthly costs:
1. GitHub Actions → Workflows → "AI Code Review"
2. Count successful runs
3. Estimate: (runs × $0.30) for low, (runs × $1.00) for thorough

**Budget Alert:** If costs exceed $5/month, review frequency or consider:
- Tightening path filters
- Using `ai:review` label more selectively
- Reducing `thorough` label usage

---

**Last Updated:** November 30, 2025
**Related:** [TTRC-203](https://ajwolfe37.atlassian.net/browse/TTRC-203), [PR #12](https://github.com/AJWolfe18/TTracker/pull/12)

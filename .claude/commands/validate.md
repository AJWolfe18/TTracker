---
description: Run pre-commit validation checklist via subagent
---

# Pre-Commit Validation Command

Launch a Task tool (general-purpose) subagent to validate current changes before committing.

## Validation Checklist

Please validate the current changes by executing the following checks:

### 1. Code Quality
- [ ] No `console.log` statements in final code
- [ ] No commented-out code blocks
- [ ] All error handling uses try-catch for async operations
- [ ] All functions have proper error messages (user-friendly)

### 2. Patterns Compliance (see `/docs/code-patterns.md`)
- [ ] Pagination uses cursor-based (NEVER OFFSET)
- [ ] Timestamps use `timestamptz` (not `timestamp`)
- [ ] Migrations include `IF NOT EXISTS`
- [ ] Foreign keys specify `ON DELETE` behavior
- [ ] CORS headers present in Edge Functions

### 3. Testing
- [ ] Run relevant QA test suite:
  - `npm run qa:smoke` (general smoke tests)
  - `npm run qa:boundaries` (if clustering changes)
  - `npm run qa:integration` (if article/story flow changes)
  - `npm run qa:idempotency` (if job queue changes)
  - `npm run qa:concurrency` (if clustering concurrency changes)
- [ ] Test edge cases manually (list at least 3 scenarios)
- [ ] Verify no regressions in existing functionality

### 4. Database Changes
- [ ] Check for potential SQL injection vulnerabilities
- [ ] Verify indexes exist for new query patterns
- [ ] Confirm migration is reversible (if applicable)
- [ ] Test migration on TEST database first

### 5. Cost Implications
- [ ] Calculate OpenAI API cost impact (if using AI features)
- [ ] Verify daily budget not exceeded: `SELECT spent_usd FROM budgets WHERE day = CURRENT_DATE`
- [ ] Confirm feature stays within $50/month limit
- [ ] State cost clearly if proposing new AI features

### 6. Documentation
- [ ] Update `/docs/code-patterns.md` if new pattern introduced
- [ ] Update `/docs/common-issues.md` if fixing a bug
- [ ] Update JIRA ticket via `/jira` command (don't say "needs update")

### 7. Security
- [ ] No secrets or API keys in code
- [ ] No SQL injection vulnerabilities
- [ ] Proper input validation/sanitization
- [ ] CORS properly configured

## Report Format

After validation, provide a summary:

```
✅ VALIDATION COMPLETE

Code Quality: ✅ Pass
Patterns: ✅ Pass
Testing: ✅ Pass (ran qa:smoke, tested 4 edge cases)
Database: ✅ Pass
Cost: ✅ $0.01 impact (well under budget)
Documentation: ✅ Updated code-patterns.md
Security: ✅ Pass

READY TO COMMIT: YES

Recommended commit message:
[Generated message based on changes]
```

## Usage

Simply type `/validate` before committing any code changes.

**Note:** This command launches a subagent to perform validation, keeping your main conversation focused on implementation.

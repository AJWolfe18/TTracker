---
name: validate
description: Pre-commit validation gatekeeper. Use when the user is ready to commit, push, or open a PR, or asks to validate/verify changes ("ready to commit", "let's push this", "is this good?"). Runs two-pass code review, pattern compliance, QA tests, security and cost checks, and the ADO status update before any commit.
---

# Pre-Commit Validation Skill

Run checks **directly** (no subagent — validation outputs are small). This is the gatekeeper: don't commit without it.

**Do NOT trigger when:** user explicitly wants a quick commit ("just commit it"), just discussing validation concepts, or still actively coding.

## MANDATORY Before Committing

### 1. Code Review — Two-Pass (Required unless trivial)

**Run BOTH code reviews for ANY non-trivial change:**
```
Pass 1: Task(feature-dev:code-reviewer): "Review changes for bugs, security, and pattern compliance"
Pass 2: Agent(superpowers:code-reviewer): "Review for production readiness, architecture, requirements alignment"
```

**Skip BOTH only for:** typo fixes, single-line changes, config tweaks
**If issues found:** Fix Critical/Important findings before proceeding.

### 2. ADO Status Update (Required)

**Update ADO via the `ado` skill:**
- If work complete → move to `Testing`
- If work in progress → keep at `Active`, add comment on progress
- If blocked → add blocker comment, flag user

**If you don't have the ADO ticket number:** Ask the user before committing.

### 3. Flag User If Uncertain

If ANY of these are true, **STOP and ask the user:**
- [ ] Not sure what ADO ticket this relates to
- [ ] Changes are larger than expected
- [ ] Code review found issues you can't resolve
- [ ] Not sure if this should go to PROD

---

## Validation Checklist

### Code Quality
- [ ] No `console.log` statements in production code (ok in scripts/)
- [ ] No commented-out code blocks
- [ ] All error handling uses try-catch for async operations
- [ ] All functions have proper error messages

### Patterns Compliance (see `/docs/code-patterns.md`)
- [ ] Pagination uses cursor-based (`lt('id', cursor)`), NEVER OFFSET
- [ ] Timestamps use `timestamptz` (not `timestamp`)
- [ ] Migrations include `IF NOT EXISTS`
- [ ] Foreign keys specify `ON DELETE` behavior
- [ ] CORS headers present in Edge Functions

### Testing
- [ ] Run relevant QA suite: `npm run qa:smoke` (always) plus the specific suite if clustering/article-flow/job-queue changes (`npm run qa:*` in package.json)
- [ ] Test edge cases manually (identify at least 2-3 scenarios)
- [ ] Verify no regressions in existing functionality

### Database (if migrations/schema changes)
- [ ] No SQL injection vulnerabilities (all SQL parameterized, no string concatenation)
- [ ] RLS policies verified for changed tables/queries
- [ ] Indexes exist for new query patterns
- [ ] Migration tested on TEST database

### Security
- [ ] No secrets or API keys in code
- [ ] Proper input validation/sanitization on user-facing endpoints
- [ ] CORS properly configured

### Cost (if AI changes)
- [ ] `SELECT spent_usd FROM budgets WHERE day = CURRENT_DATE;` — verify under $5/day limit
- [ ] Calculate and state OpenAI API cost impact for new features

---

## Report Format

```
✅ PRE-COMMIT VALIDATION

Code Review: ✅ Ran feature-dev:code-reviewer + superpowers:code-reviewer (or ⏭️ Skipped - trivial change)
ADO Update: ✅ ADO-XXX moved to Testing (or ❌ Need ticket number)
QA Tests: ✅ npm run qa:smoke passed
Patterns: ✅ Compliant
Security: ✅ No issues
Cost Impact: $X.XX (within budget) | ⚠️ Over budget | N/A

READY TO COMMIT: YES / NO (reason)
```

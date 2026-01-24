---
description: Run pre-commit validation checklist via subagent
---

# Pre-Commit Validation Command

Launch a Task tool (general-purpose) subagent to validate current changes before committing.

## MANDATORY Before Committing

### 1. Code Review (Required unless trivial)

**Run code review for ANY non-trivial change:**
```
Task(feature-dev:code-reviewer): "Review changes for bugs, security, and pattern compliance"
```

**Skip ONLY for:** typo fixes, single-line changes, config tweaks

**If issues found:** Fix them before proceeding.

### 2. ADO Status Update (Required)

**Update ADO via `/ado` command:**
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
- [ ] No `console.log` statements in production code
- [ ] No commented-out code blocks
- [ ] All error handling uses try-catch for async operations
- [ ] All functions have proper error messages

### Patterns Compliance (see `/docs/code-patterns.md`)
- [ ] Pagination uses cursor-based (NEVER OFFSET)
- [ ] Timestamps use `timestamptz` (not `timestamp`)
- [ ] Migrations include `IF NOT EXISTS`
- [ ] Foreign keys specify `ON DELETE` behavior
- [ ] CORS headers present in Edge Functions

### Testing
- [ ] Run relevant QA test suite: `npm run qa:smoke`
- [ ] Test edge cases manually (identify at least 2-3 scenarios)
- [ ] Verify no regressions in existing functionality

### Security
- [ ] No secrets or API keys in code
- [ ] No SQL injection vulnerabilities
- [ ] Proper input validation/sanitization

### Cost (if AI changes)
- [ ] Calculate OpenAI API cost impact
- [ ] Verify daily budget not exceeded
- [ ] State cost clearly for new AI features

---

## Report Format

After validation, provide:

```
✅ PRE-COMMIT VALIDATION

Code Review: ✅ Ran feature-dev:code-reviewer (or ⏭️ Skipped - trivial change)
ADO Update: ✅ ADO-XXX moved to Testing (or ❌ Need ticket number)
QA Tests: ✅ npm run qa:smoke passed
Patterns: ✅ Compliant
Security: ✅ No issues

READY TO COMMIT: YES / NO (reason)
```

---

## Usage

Type `/validate` before committing any code changes.

**This is the gatekeeper.** Don't commit without running this.

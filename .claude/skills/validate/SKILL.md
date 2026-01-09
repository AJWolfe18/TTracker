# Pre-Commit Validation Skill

## Description

Automatically use this skill when user is **ready to commit or wants validation**.

**Trigger when user says things like:**
- "Ready to commit"
- "Let's commit this"
- "Done with changes"
- "Validate before I push"
- "Check my changes"
- "Ready for PR"
- "Let's push this"
- "Verify everything is good"
- "Run validation"
- "Is this ready to commit?"

**Do NOT trigger when:**
- User explicitly wants a quick commit ("just commit it", "quick commit")
- Just discussing validation concepts
- Reading/exploring code without making changes
- User is still actively coding (wait until they say they're done)

---

## Purpose

Comprehensive pre-commit validation to catch issues before they're committed. Run checks directly (no subagent needed - validation outputs are small).

---

## Instructions

Execute these checks **directly** (not via subagent). Report results in summary format.

### 1. Code Quality

Check changed files for:
- [ ] No `console.log` in production code (ok in scripts/)
- [ ] No large commented-out code blocks
- [ ] Async functions have try-catch error handling
- [ ] Error messages are user-friendly

### 2. Pattern Compliance

Per `/docs/code-patterns.md`:
- [ ] Pagination uses cursor-based (`lt('id', cursor)`), NEVER OFFSET
- [ ] Timestamps use `timestamptz` not `timestamp`
- [ ] Migrations have `IF NOT EXISTS` for idempotency
- [ ] Foreign keys specify `ON DELETE` behavior
- [ ] Edge Functions have CORS headers

### 3. Testing

Run appropriate test suite:
```bash
npm run qa:smoke          # General (always run)
npm run qa:boundaries     # If clustering changes
npm run qa:integration    # If article/story flow changes
npm run qa:idempotency    # If job queue changes
npm run qa:concurrency    # If clustering concurrency changes
```

Identify 3+ edge cases and verify they're handled.

### 4. Database (if migrations/schema changes)

- [ ] No SQL injection vulnerabilities
- [ ] Indexes exist for new query patterns
- [ ] Migration tested on TEST database

### 5. Cost Impact

If changes involve OpenAI/AI features:
```sql
SELECT spent_usd FROM budgets WHERE day = CURRENT_DATE;
```
- Verify under $5/day limit
- State cost impact of new features

### 6. Security

- [ ] No secrets/API keys in code
- [ ] Input validation on user-facing endpoints
- [ ] CORS properly configured

### 7. JIRA Update

After validation passes, update the relevant JIRA ticket:
- Transition status if appropriate
- Add comment summarizing changes

---

## Response Format

```
VALIDATION RESULTS

Code Quality:    ✅ Pass | ❌ Fail [details]
Patterns:        ✅ Pass | ❌ Fail [details]
Testing:         ✅ Pass | ❌ Fail [suite ran, edge cases tested]
Database:        ✅ Pass | ❌ N/A | ❌ Fail [details]
Cost Impact:     $X.XX (within budget) | ⚠️ Over budget
Security:        ✅ Pass | ❌ Fail [details]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READY TO COMMIT: ✅ YES | ❌ NO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[If YES]
Recommended commit message:
feat/fix/chore(scope): description

Co-Authored-By: Claude <noreply@anthropic.com>

[If NO]
Blockers:
1. [Issue to fix]
2. [Issue to fix]
```

---

## Notes

- This skill runs checks **directly** (not via subagent) since outputs are small
- Always run `qa:smoke` at minimum
- After validation, JIRA update happens via the JIRA skill if a ticket is associated

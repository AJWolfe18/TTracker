# TrumpyTracker - Session Startup Prompt

## SESSION START CHECKLIST

**Before starting work, Claude asks:**
1. "Any specific handoffs I should review?" (reads from `/docs/handoffs/YYYY-MM-DD-name.md`)
2. "What's our goal this session?"
3. "Any time or budget constraints?"
4. Explicitly state: "Working on TEST environment" (or PROD if applicable)

**Reference:** Full details in `/docs/SESSION_PROTOCOL.md`

---

## JOSH'S ROLE & PREFERENCES

**Role:** Product Manager (non-developer background)
- Explain business impact first, technical details second
- Use simple language, avoid jargon
- Single directive recommendation, not multiple options
- Challenge assumptions and present unbiased facts
- Get agreement before executing to save time/context

**Working Setup:**
- Direct file access: `C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker`
- GitHub Desktop for commits (simple messages only)
- Budget constraint: <$50/month total (current: ~$35/month)

---

## PROJECT CURRENT STATE

**Migration In Progress:** Articles → Story Clustering (RSS) Frontend
- **Production:** `main` branch (old system still live)
- **Test:** `test` branch (RSS development active)
- **Implementation Plan:** https://ajwolfe37.atlassian.net/wiki/x/A4AlAg
- **JIRA Board:** https://ajwolfe37.atlassian.net/jira/software/c/projects/TTRC/boards/35

---

## WORKFLOW RULES

### Before Any Work
1. **Check project knowledge** for existing solutions/patterns
2. **Verify tool access** - NEVER claim "I can't" without checking available tools
3. **Confirm environment** - Explicitly state TEST or PROD
4. **Work on TEST branch only** (unless explicitly told otherwise)

### Standard Flow
1. **Propose** → Present plan with cost/risk assessment
2. **Confirm** → Get Josh's approval
3. **Implement** → Execute the plan
4. **Auto-QA** → Run quality checks (see below)
5. **Report** → Share findings, await approval before fixing non-critical issues

### After Changes
6. **Update JIRA** (use Atlassian tools directly)
7. **Update Confluence** (use Atlassian tools directly)
8. **Create Handoff** (save to `/docs/handoffs/`, NOT project knowledge)

---

## AUTO-QA PROTOCOL

After implementing ANY change, automatically check:
- **Edge cases:** How does it handle unusual inputs?
- **Regressions:** Did we break existing functionality?
- **Cost impact:** Still under $50/month total?
- **Production-like data:** Tested with realistic scenarios?
- **Console errors:** Any JavaScript errors?

**Report findings to Josh** - don't auto-fix unless critical.

---

## DEFINITION OF DONE

A task is only "done" when ALL these are true:
- ✅ Feature implemented and working
- ✅ Edge cases handled
- ✅ No regressions introduced
- ✅ Cost impact assessed (<$50/month)
- ✅ Test checklist provided
- ✅ Issues reported (not silently fixed)
- ✅ JIRA/Confluence updated
- ✅ Handoff document created

---

## TECHNICAL STACK

**Architecture:**
- Supabase (Edge Functions, Postgres RLS)
- Netlify (static hosting, auto-deploy)
- NO separate server, NO Redis, NO traditional backend

**Key Constraints:**
- Use cursor pagination (NO offset pagination)
- GIN indexes for full-text search
- All timestamps in UTC
- URL uniqueness is composite (url + feed_id)

**Schema Reference:** See `database_schema_snapshot.md`

---

## DEPLOYMENT RULES

### Cherry-Pick from TEST → MAIN
- Cherry-pick stable commits only
- **NEVER merge** test branch into main
- **NEVER cherry-pick** these files:
  - `TEST_BRANCH_MARKER.md`
  - `supabase-config-test.js`
  - Any `test-*` files

### Netlify Auto-Deploy
- Push to `test` → Deploys to TEST environment
- Push to `main` → Deploys to PRODUCTION
- Wait ~2-3 minutes for deployment

---

## CLAUDE'S CAPABILITIES REMINDER

### I CAN Do (Verify Before Claiming I Can't)
- ✅ Update JIRA tickets directly (Atlassian tools)
- ✅ Update Confluence pages directly (Atlassian tools)
- ✅ Read/write files in repo (filesystem tools)
- ✅ Execute SQL on Supabase TEST (supabase-test tools)
- ✅ Search web for current information
- ✅ Read project knowledge base
- ✅ Create comprehensive documentation

### I CANNOT Do
- ❌ Deploy to Netlify (Josh pushes, Netlify auto-deploys)
- ❌ Access production Supabase directly (only through scripts)
- ❌ Make breaking changes without approval
- ❌ Spend money without cost assessment

**When Josh Challenges "I Can't":**
1. Stop and check available tools immediately
2. Try the task instead of defending
3. Apologize if wrong
4. Complete the task

---

## INTERACTION GUIDELINES

### What Josh Values
- **Directive** - Pick the best option and explain why
- **Business-focused** - Impact over technical details
- **Cost-aware** - Always mention $ implications
- **Proactive** - Catch issues early, suggest improvements
- **Honest** - Flag limitations or risks clearly

### What Wastes Time
- Providing options instead of recommendation
- Claiming "I can't" without verifying tools
- Over-explaining technical details
- Asking permission for standard tasks
- Verbose responses when brevity works

### Always State Explicitly
- **Environment:** "Working on TEST environment"
- **Cost:** "This adds $X/month" or "No cost impact"
- **Risk:** "LOW/MEDIUM/HIGH risk" with reasoning
- **Breaking Changes:** Flag immediately if any

---

## SESSION TYPES

**Exploration:** Research solutions → Recommendation document  
**Implementation:** Build feature → Working code + tests + handoff  
**Bug Fix:** Diagnose issue → Fix + root cause analysis  
**Planning:** Design approach → Implementation plan + JIRA tickets

---

## COST TRACKING

**Current Baseline:** ~$35/month
- Supabase: ~$25/month
- Netlify: ~$10/month

**Hard Limit:** $50/month total

**Every session:** Check if changes affect cost, flag increases, propose alternatives if over budget.

---

_Reference full protocol: `/docs/SESSION_PROTOCOL.md`_  
_Last Updated: October 2, 2025_

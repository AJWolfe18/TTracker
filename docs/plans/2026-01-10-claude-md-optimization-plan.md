# CLAUDE.md Optimization & Dev Process Enhancement

**Date:** 2026-01-10
**Status:** Ready to Execute
**Goal:** Optimize CLAUDE.md for efficiency, update tooling references, and improve multi-session workflows

---

## Context from Today's Session

**Key learnings that inform this plan:**

1. **Main/test sync is good** - 555 commit difference was mostly PR merge hash differences, not actual code divergence. PRs #37-#44 all promoted code correctly.

2. **Promotion tracking exists** - `.claude/test-only-paths.md` already tracks what shouldn't go to prod

3. **ADO already set up** - `.claude/skills/ado/` and `.claude/commands/ado.md` exist but CLAUDE.md still references JIRA

4. **Token savings opportunity** - CLAUDE.md is 13KB (~5,200 tokens), can reduce by 25-30%

---

## Phase 1: Critical Updates (CLAUDE.md)

### 1.1 Update JIRA → ADO References

**Current:** 17 JIRA references in CLAUDE.md
**Action:** Replace all with ADO

**TLDR Section (line 12):**
```markdown
# Before
**Tools Available**: Supabase MCP, Atlassian (JIRA) MCP, Filesystem MCP

# After
**Tools Available**: Supabase MCP, Azure DevOps MCP, Filesystem MCP
```

**Session Workflow (line 22):**
```markdown
# Before
- [ ] Query JIRA via subagent (if ticket-based work)

# After
- [ ] Query ADO via subagent (if ticket-based work): Use `/ado` command
```

**Critical Rule 4 (lines 94-100):**
```markdown
# Before - JIRA Operations via Subagent...

# After
4. **ADO Operations via Subagent** - Use `/ado` command to isolate 20K+ context cost
   - ADO MCP tools return full work item dumps
   - Use subagent pattern: `Task(general-purpose): "Query ADO work item #XXX, return summary only"`
   - Alternative: Use `/ado` command
   - **Context savings: 99.5% (20K → 100 tokens)**
```

**MCP Tools Section (lines 460-472):**
```markdown
# After
**Azure DevOps Integration:** Direct work item operations
- **Use `/ado` command** for all work item queries
- Use for: Work item updates, status transitions, comments
- See `/docs/guides/ado-workflow.md` for full details
```

**JIRA Workflow Section (lines 484-570):**
- **Rename to "ADO Workflow"**
- Keep structure (Epic → Feature → Story hierarchy)
- Update status workflow: Backlog → In Progress → Done (ADO states)
- Reference `/ado` command instead of `/jira`

### 1.2 Add Python Error Prevention

**Add to Anti-Patterns section (after line 168):**
```markdown
### Language/Runtime
- ❌ **Using Python in this project** - NO PYTHON IN THIS REPO
  - This is a Node.js/JavaScript project
  - Never run `python3`, `pip`, or Python scripts
  - For data processing: Use `node -e "..."`, `jq`, or SQL via MCP
  - **Fix:** `node -e "console.log(JSON.stringify({foo:'bar'}))"` instead of Python
```

### 1.3 Add Multi-Session Planning Section

**Add after Session Workflow Checklist (after line 45):**
```markdown
## 📋 Working with Plans

### Decision Tree: Plan or No Plan?

| Situation | Action |
|-----------|--------|
| Handoff references existing plan | **EXECUTE** that plan (don't create new) |
| Complex feature (3+ files, multi-phase) | **CREATE** new plan in `/docs/plans/` |
| Simple task (1-2 files, clear scope) | **JUST DO IT** (no plan needed) |
| Bug fix with known cause | **JUST DO IT** |
| Research/exploration task | **JUST DO IT** (handoff captures findings) |

### EXECUTION MODE (When Plan Exists):
1. ✅ Open plan file at specified line number
2. ✅ Check STATUS at top → identifies current phase
3. ✅ Execute tasks sequentially → check off items
4. ✅ Update STATUS when phase completes
5. ✅ Create handoff pointing to next phase

### DON'T DO THIS:
- ❌ "Let me create a session plan based on the main plan"
- ❌ "I'll summarize this into smaller steps"
- ❌ Create new plan when one already exists

**Red Flag:** If saying "Let me plan..." when plan exists, STOP. Execute the existing plan.
```

### 1.4 Add Promotion Tracking Section

**Add after Git Workflow section (after line 77):**
```markdown
## 🚀 Promotion to PROD

### Before Creating PR to Main (Checklist):
- [ ] Changes tested on TEST environment
- [ ] `npm run qa:smoke` passes
- [ ] AI code review passed (no blockers)
- [ ] Check `.claude/test-only-paths.md` - skip any test-only files

### Test-Only Tracking:
**File:** `.claude/test-only-paths.md`

**Add to this file when:**
- Creating one-time scripts (migration helpers, data fixes)
- Adding debug/monitoring tools not needed in prod
- Temporary config changes for testing

**What goes to prod:**
- `.claude/skills/` and `.claude/commands/` - work in both envs
- `docs/` - documentation is fine everywhere
- Core code changes (scripts/, supabase/functions/, migrations/)

**Quick sync check:**
```bash
git diff origin/main..origin/test --stat -- "*.js" "*.ts" "supabase/functions/**"
```
```

---

## Phase 2: Condense for Token Savings

### 2.1 Database Schema Section (lines 316-367)

**Before:** 50 lines of detailed schema
**After:** 15 lines with link to full docs

```markdown
### Database Schema (Summary)

**Core tables:** `stories`, `articles`, `article_story`, `feed_registry`, `job_queue`, `budgets`

**Key constraints:**
- Articles: UNIQUE(url_hash, published_date)
- Stories: UNIQUE(story_hash), status: 'active' | 'closed' | 'archived'

**Critical RPCs:**
- `attach_or_create_article()` - Idempotent article insertion
- `claim_runnable_job()` - Atomic job claiming
- `get_stories_needing_enrichment()` - Find unenriched stories

**Full schema:** `/docs/database/database-schema.md`
**Latest migration:** 055 (Jan 2026) - Dropped merge/split feature
```

**Token savings:** 50 → 15 lines = 70%

### 2.2 JIRA/ADO Hierarchy Section (lines 508-570)

**Keep but condense:** Epic → Feature → Story structure is valuable
**Remove:** Detailed SCOTUS example (too specific)
**Result:** ~30 lines saved

---

## Phase 3: Add File Map & Templates Reference

### 3.1 File Map Section

**Add after TLDR (after line 14):**
```markdown
## 📁 Quick Reference

**First 3 commands every session:**
1. `git branch --show-current` → Must be `test`
2. Read `/docs/handoffs/[latest].md`
3. Check if handoff references a plan → EXECUTE it

**Key files:**
- `scripts/rss-tracker-supabase.js` - Main RSS pipeline
- `supabase/functions/` - Edge Functions
- `migrations/*.sql` - Database migrations
- `public/` - Frontend

**Key docs:**
- `/docs/plans/` - Implementation plans (EXECUTE, don't re-plan)
- `/docs/handoffs/` - Session handoffs
- `/docs/code-patterns.md` - Reusable patterns
- `/docs/common-issues.md` - Known bugs/solutions

**Before schema changes:** Check `/docs/database/database-schema.md`
```

### 3.2 Create Templates Folder

**Create:** `docs/templates/` with 2 files (no migration template - reference existing migrations)

#### A. Plan Template (`docs/templates/plan-template.md`)

```markdown
# [TICKET]: [Feature Name] Implementation Plan

**STATUS:** Phase 0 - Not Started | Phase 1 - In Progress | etc.
**CREATED:** YYYY-MM-DD
**MODE:** EXECUTION (Follow checklist, do NOT re-plan)

---

## ⚠️ How to Use This Plan

**This is an EXECUTION PLAN.** When you see this plan:
1. Check STATUS above → identifies current phase
2. Jump to current phase section
3. Execute tasks sequentially → check off items
4. Update STATUS when phase completes
5. Create handoff pointing to next phase

**DO NOT:** Create a new plan, summarize into smaller steps, or "plan the plan"

---

## Overview

**Goal:** [One sentence]
**Success Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

**Cost Impact:** [Monthly cost change if any]

---

## Phase 0: Pre-Validation ⏳ CURRENT

**Purpose:** Verify prerequisites

- [ ] Task 1
  - Details: [What to do]
  - Validation: [How to verify]

- [ ] Task 2
  - Details: [What to do]
  - Validation: [How to verify]

**Phase 0 Complete When:** All tasks checked, ready for Phase 1

---

## Phase 1: [Name] ⏸️ NOT STARTED

**Purpose:** [Phase goal]

- [ ] Task 1
- [ ] Task 2

---

## Phase 2: [Name] ⏸️ NOT STARTED

[Tasks...]

---

## Testing Checklist

- [ ] `npm run qa:smoke` passes
- [ ] No regressions
- [ ] Cost impact verified

---

**Last Updated:** YYYY-MM-DD by [who]
```

#### B. Handoff Template (`docs/templates/handoff-template.md`)

```markdown
# Session Handoff: YYYY-MM-DD - [TICKET] - [Topic]

**Date:** YYYY-MM-DD
**Ticket:** ADO #XXX or TTRC-XXX
**Status:** In Progress | Complete | Blocked

---

## What Was Done

### Completed:
- ✅ Task 1
- ✅ Task 2

### In Progress:
- ⏳ Task 3 (X% complete)

### Blocked:
- 🚫 Task 4 - reason

---

## Next Session

### If Plan Exists:
**Plan:** `docs/plans/YYYY-MM-DD-ticket-feature.md`
**Current Phase:** Phase X (lines XX-YY)
**Next Action:** [Specific task at line XX]

⚠️ **EXECUTION MODE** - Open plan, execute tasks, do NOT re-plan

### If No Plan:
**Action Items:**
1. [Task 1]
2. [Task 2]

---

## Context

**Decisions Made:**
- Decision 1: [rationale]

**Files Modified:**
- `path/file.js` - [what changed]

**ADO Updates:**
- #XXX: [status change]

---

**Next Session Starts:** [One sentence immediate action]
```

**For migrations:** Reference existing files in `migrations/` as examples (55+ established patterns)

---

## Phase 4: Archive JIRA Command

**Action:** Move `.claude/commands/jira.md` to `.claude/commands/archive/jira.md`

**Reason:** Prevents confusion, keeps for reference if needed

---

## Files to Modify

| File | Changes |
|------|---------|
| `CLAUDE.md` | Update JIRA→ADO, add Python anti-pattern, add multi-session planning, add promotion tracking, condense schema, add file map |
| `.claude/commands/jira.md` | Move to `archive/` |
| `docs/plans/2026-01-10-claude-md-optimization-plan.md` | Copy from branch to test |

---

## Expected Impact

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| CLAUDE.md size | 13KB | ~9.5KB | 27% |
| Tokens per session | 5,200 | ~3,800 | 1,400 |
| JIRA references | 17 | 0 | 100% |
| Re-planning waste | ~5K tokens | ~0 | 90%+ |

---

## Verification

After implementation:
1. **File size:** `wc -c CLAUDE.md` → should be ~9,500 bytes (down from 13,234)
2. **JIRA references:** `grep -i jira CLAUDE.md | wc -l` → should be 0
3. **ADO references:** `grep -i ado CLAUDE.md` → should find new references
4. **Templates exist:** `ls docs/templates/` → should show 2 files
5. **Test fresh session:** Start new conversation, verify:
   - ADO commands work
   - Multi-session planning instructions clear
   - No Python errors in next 5 sessions

---

## Implementation Order

1. **Copy optimization plan** from branch to test (reference doc)
2. **Update CLAUDE.md** - All Phase 1-3 changes
3. **Create templates folder** - Plan + Handoff templates
4. **Archive JIRA command** - Move to archive/
5. **Push to test**
6. **Verify with fresh session**

---

## Key Design Decisions

### Plan Template
- **EXECUTION MODE marker** at top - prevents re-planning
- **STATUS line** - makes current phase obvious
- **Phase markers** (⏳ CURRENT, ⏸️ NOT STARTED) - visual scanning
- **No rollback section** - test thoroughly, fix forward if issues
- **Testing checklist** - ensures QA before completion

### Handoff Template
- **Plan reference with line numbers** - direct navigation
- **EXECUTION MODE reminder** - reinforces behavior
- **ADO Updates section** - ensures ticket tracking
- **"Next Session Starts"** - single actionable sentence

### Why No Migration Template
- 55+ existing migrations establish clear patterns
- Reference existing files instead of template overhead
- Migrations vary too much for one template to fit all

---

## Expert Review Summary

**Improvements added during review:**

1. **Decision Tree** - Clarifies when to create new plan vs execute existing vs just do it
2. **First 3 Commands** - Branch verification now prominent in Quick Reference
3. **PR Checklist** - Concrete 4-item checklist before creating PR to main
4. **Test-Only Tracking Criteria** - Explicit "add to file when..." guidance
5. **Verification Commands** - Actual shell commands to verify changes worked
6. **Schema Reference Trigger** - "Before schema changes" reminder in Quick Reference

**Risk mitigations:**
- Plan decision tree prevents both over-planning and under-planning
- Branch verification at top of Quick Reference catches wrong-branch work early
- PR checklist ensures consistent promotion quality
- No rollbacks = simpler mental model, fix forward if issues

# Getting Started - Desktop + Code Workflow

## Quick Start for Josh

This is your guide for working with Claude Desktop (planning) and Claude Code (implementation).

---

## Setup (One-Time)

### 1. Give Each Claude Their Instructions
**Claude Desktop (this chat):**
```
Use /docs/CLAUDE_DESKTOP_STARTUP.md as your session startup guide
```

**Claude Code (terminal/IDE):**
```
Use /docs/CLAUDE_CODE_STARTUP.md as your session startup guide
```

### 2. Enable GitHub Branch Protection (Optional)
Follow `/docs/CLAUDE-CODE-PR-WORKFLOW.md` to:
- Require PRs for main branch
- Set up ChatGPT review GitHub Action
- Configure auto-deploy triggers

---

## Daily Workflow

### When You Have a Feature to Build

**1. Planning Session with Desktop**
```
You: "Let's plan TTRC-XXX [feature description]"

Desktop will:
✓ Review handoffs
✓ Check schema/pattern docs if needed
✓ Design solution
✓ Create implementation plan → /docs/plans/YYYY-MM-DD-ttrc-xxx.md
✓ Update JIRA
✓ Tell you it's ready for Code
```

**2. Hand to Code**
```
You → Claude Code: "Execute /docs/plans/YYYY-MM-DD-ttrc-xxx.md"

Code will:
✓ Review plan for issues (schema, patterns, known problems)
✓ Ask Desktop if it finds issues
✓ Implement feature using existing patterns
✓ Run quality checklist
✓ Update docs (schema/patterns/issues)
✓ Create PR with quality report
✓ Update JIRA to "In Review"
```

**3. You Review & Merge**
```
1. Check ChatGPT review comment on PR
2. Verify changes look good
3. Approve PR
4. Merge to test branch
5. Netlify auto-deploys (~2 min)
6. Test on TEST site
```

**4. End of Feature - Desktop Creates Handoff**
```
Desktop creates: /docs/handoffs/YYYY-MM-DD-feature-name.md
Summarizes: Decisions, PRs merged, next priorities
```

---

## When You Have a Bug

**Option A: Code Handles It (Simple Bugs)**
```
You → Code: "Fix bug: [description]"

Code will:
- Reproduce bug
- Check /docs/common-issues.md for similar
- Fix on feature branch
- Document solution in common-issues.md
- Create PR
```

**Option B: Desktop Investigates (Complex Bugs)**
```
You → Desktop: "Debug why [X is broken]"

Desktop will:
- Root cause analysis
- Design fix approach
- Create plan for Code
- Hand to Code for implementation
```

---

## When You Need to Change Schema

**Always go through Desktop first:**
```
You → Desktop: "We need to add table X"

Desktop will:
- Check /docs/database-standards.md
- Check /docs/database-schema.md for conflicts
- Design migration
- Create plan with schema validation steps
- Hand to Code

Code will:
- Review schema against standards
- Flag issues to Desktop if found
- Create migration with IF NOT EXISTS
- Test on TEST
- Update /docs/database-schema.md
```

---

## Key Files & Their Purpose

### You Use Directly:
- **PROJECT_INSTRUCTIONS.md** - Main rules (in your Claude project)
- **CLAUDE_DESKTOP_STARTUP.md** - Give to Desktop at start
- **CLAUDE_CODE_STARTUP.md** - Give to Code at start

### Desktop Uses:
- `/docs/plans/` - Creates implementation plans for Code
- `/docs/handoffs/` - Creates end-of-feature summaries
- `/docs/database-standards.md` - References when planning schema
- `/docs/database-schema.md` - Checks existing tables
- `/docs/code-patterns.md` - References in plans for Code
- `/docs/common-issues.md` - References when planning fixes

### Code Uses:
- `/docs/plans/` - Reads plans to execute
- `/docs/database-standards.md` - Checks before migrations
- `/docs/database-schema.md` - Checks existing schema, UPDATES after migrations
- `/docs/code-patterns.md` - Follows patterns, UPDATES when creating new ones
- `/docs/common-issues.md` - Checks for gotchas, UPDATES after fixing bugs

### Both Use:
- JIRA (via Atlassian MCP) - Status updates
- Confluence (via Atlassian MCP) - Documentation

---

## The Division of Labor

| Task | Who Does It | Why |
|------|-------------|-----|
| Architecture decisions | Desktop | Strategic thinking |
| Schema design | Desktop | Requires standards knowledge |
| Implementation plans | Desktop | Defines what/why |
| Code implementation | Code | Fast execution |
| PR creation | Code | Part of implementation |
| Quality checks | Code | Catches issues before PR |
| Doc maintenance | Code | Updates as it works |
| Bug investigation | Desktop (complex) or Code (simple) | Depends on complexity |
| Cost analysis | Desktop | Requires business judgment |
| JIRA updates | Both | Whoever touches the ticket |

---

## What Happens Automatically

**Without You:**
- Netlify deploys on push to test/main
- ChatGPT reviews every PR
- Code updates docs after changes

**With You:**
- PR approval (for now)
- Merge to test
- Test on TEST site
- Eventually merge to main

---

## Troubleshooting

### "Desktop is running out of context"
**Solution:** End session, Desktop creates handoff, start new session

### "Code made a mistake"
**Solution:** Desktop reviews PR, requests changes in PR comments, Code fixes

### "Schema drift happened anyway"
**Solution:** Add to /docs/common-issues.md, improve standards doc

### "Code ignored existing pattern"
**Solution:** Make pattern more visible in /docs/code-patterns.md

### "Code is asking too many questions"
**Solution:** Desktop's plan wasn't detailed enough, revise planning approach

---

## Best Practices

### For Efficient Sessions:
✅ Batch plan 3-5 features with Desktop  
✅ Hand all plans to Code at once  
✅ Code executes autonomously  
✅ You review PRs in batch  
✅ Desktop creates one handoff at end  

### For Better Plans:
✅ Desktop references docs for Code to follow  
✅ Desktop includes schema validation steps  
✅ Desktop lists specific edge cases to test  
✅ Desktop specifies which docs Code should update  

### For Quality PRs:
✅ Code runs full pre-PR checklist  
✅ Code tests 3+ edge cases  
✅ Code updates relevant docs  
✅ Code provides detailed test results  

---

## Cost Tracking

**Budget:** <$50/month hard limit (currently ~$35)

**Every change Desktop makes:**
- Desktop states: "This adds $X/month" or "No cost impact"

**If approaching limit:**
1. Desktop analyzes current spend
2. Desktop proposes optimizations
3. You decide which to implement

---

## When to Deviate from This

**Use Desktop for implementation when:**
- Learning new architecture patterns
- One-off custom solutions
- Debugging requires deep investigation

**Use Code for planning when:**
- Simple bug fix (Code can diagnose + plan + fix)
- UI polish (Code can identify issues + implement)
- Refactoring (Code spots pattern + proposes + executes)

**Key principle:** Desktop = thinking, Code = doing. But they can overlap for simple tasks.

---

## Success Metrics

**Good workflow = All these are true:**
- ✅ Desktop context rarely runs out (under 70% most sessions)
- ✅ Code rarely asks for clarification (plan was clear)
- ✅ Schema drift is rare (docs prevent it)
- ✅ Code reuses patterns (not reinventing)
- ✅ PRs pass review first try (quality checklist works)
- ✅ You approve PRs quickly (confident in process)

**If any are false:** Iterate on the process.

---

## Quick Command Reference

### Desktop Session Start:
```
"Any handoffs to review?"
"Goal: Plan TTRC-XXX"
"Working on TEST environment"
```

### Code Session Start:
```
"Execute /docs/plans/YYYY-MM-DD-ttrc-xxx.md"
```

### End Desktop Session:
```
"Create handoff for today's work"
```

### Check Docs:
```
Desktop: "Show me database-schema.md"
Code: "Check code-patterns.md for pagination"
```

---

## Getting Help

**If workflow isn't working:**
1. Review this guide
2. Check if Claudes have their startup prompts
3. Verify docs are being maintained
4. Ask Desktop to audit the process

**If tools aren't working:**
- Check MCP servers connected: `/mcp`
- Verify Supabase/Atlassian credentials
- Check GitHub token for Code

---

_Last Updated: October 5, 2025_  
_Keep this guide updated as workflow evolves_

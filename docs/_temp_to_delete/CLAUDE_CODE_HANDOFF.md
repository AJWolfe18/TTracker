# Claude Code - Session Handoff Template

## For Claude Code Sessions Only
Use this template when ending a Claude Code implementation session.

---

```markdown
# Claude Code Handoff - [Date Time] - [Implementation Focus]

## SESSION SUMMARY
**Tool:** Claude Code  
**Mode:** Implementation/Testing/Bug Fix  
**Duration:** ~[X] hours  
[1-2 sentences of what was built/fixed]

---

## IMPLEMENTATION COMPLETE

### Branch & Commits
**Working Branch:** `[feature/fix branch name]`  
**Commits Made:**
- `[short hash]`: [commit message]
- `[short hash]`: [commit message]

### Pull Request
**PR #[number]:** [Title]  
**Status:** [Open/Ready for Review/AI Reviewed]  
**JIRA Reference:** TTRC-XXX  
**Link:** https://github.com/ajwolfe37/TTracker/pull/[number]

### Files Modified
- `path/to/file.js` - [what changed]
- `path/to/file.css` - [what changed]
- `path/to/file.md` - [what changed]

---

## TESTING PERFORMED

### Automated Tests
- ✅ Puppeteer UI tests: [what was tested]
- ✅ Console errors: None found / [list if any]
- ✅ Performance: [page load times if tested]

### Manual Verification  
- ✅ Feature works as specified in plan
- ✅ Edge cases handled: [list key ones]
- ✅ Mobile responsive: [Yes/No/Not tested]

### Issues Found
- ⚠️ [Any non-critical issues discovered]
- ❌ [Any blockers that need Desktop attention]

---

## STATUS AGAINST PLAN

**Plan Document:** `/docs/plans/YYYY-MM-DD-plan.md`

### Completed Tasks
- [x] Task 1 from plan
- [x] Task 2 from plan
- [x] Task 3 from plan

### Not Completed (Why)
- [ ] Task 4 - [Blocked by: reason]
- [ ] Task 5 - [Needs Desktop: architecture decision]

---

## HANDOFF TO DESKTOP

### Needs Architecture Review
- [Decision needed about X approach]
- [Unclear requirement in ticket TTRC-XXX]

### Needs Debugging Help
- [Complex issue beyond execution scope]
- [Root cause analysis needed for Y]

### Ready for Review
- PR #[number] ready for approval
- All acceptance criteria met
- Tests passing

---

## MCP TOOLS USED

### Database Queries (Supabase TEST)
- Verified [what data]
- Checked [what conditions]

### GitHub Operations
- Created PR #[number]
- Branch management successful

### JIRA Updates
- TTRC-XXX moved to "In Review"
- Added implementation notes

---

## NEXT STEPS

### For Desktop Review:
1. Review PR #[number]
2. Decide on [architecture question]
3. Debug [complex issue]

### For Next Code Session:
1. Continue with remaining plan items
2. Address PR feedback once reviewed
3. Implement TTRC-[next ticket]

---

## ENVIRONMENT STATUS
**TEST Site:** [Working/Deployed/Has issues]  
**Build Status:** [Passing/Failed]  
**Console Errors:** [None/Listed above]

---

_Created: [ISO timestamp]_
_Tool: Claude Code_
_Plan Executed: /docs/plans/[plan-file].md_
```

---

## CHECKLIST BEFORE SAVING

- [ ] PR created (not direct to main)
- [ ] All commits on feature branch
- [ ] JIRA ticket updated
- [ ] Tests documented
- [ ] Blockers clearly stated
- [ ] Next steps identified
- [ ] Save to: `/docs/handoffs/YYYY-MM-DD-code-[description].md`

---

## What NOT to Include

- Architecture decisions (that's Desktop's job)
- Long technical explanations
- Alternative approaches considered
- Planning for future features
- Cost analysis (unless issue found)

Keep it factual, brief, and execution-focused.

---

_Reference: `/docs/CLAUDE-DESKTOP-VS-CODE-GUIDE.md`_
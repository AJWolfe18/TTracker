# Claude Desktop - Session Handoff Template

## For Claude Desktop Sessions Only
Use this template when ending a Claude Desktop planning/architecture session.

---

```markdown
# Claude Desktop Handoff - [Date Time] - [Planning/Architecture Focus]

## SESSION SUMMARY
**Tool:** Claude Desktop  
**Mode:** Planning/Architecture/Debugging/Review  
**Duration:** ~[X] hours  
[1-2 sentences of key decisions made and why]

---

## PLANNING & DECISIONS

### Architecture Decisions Made
**Decision 1:** [What was decided]
- **Rationale:** [Why this approach]
- **Alternative Rejected:** [What we didn't do and why]
- **Cost Impact:** [$ change or No impact]

**Decision 2:** [What was decided]
- **Rationale:** [Why this approach]
- **Implementation:** [How Code will execute it]

### Implementation Plan Created
**Document:** `/docs/plans/YYYY-MM-DD-[topic]-plan.md`
**Ready for Code:** [YES/NO]
**Estimated Code Time:** [X hours]
**Priority Order:**
1. TTRC-XXX: [Most important task]
2. TTRC-XXX: [Next task]
3. TTRC-XXX: [Following task]

---

## JIRA & CONFLUENCE UPDATES

### JIRA Updates (via MCP)
- **Created:** TTRC-XXX - [New ticket title]
- **Updated:** TTRC-XXX - [What changed]
- **Transitioned:** TTRC-XXX from [Status] to [Status]
- **Linked:** TTRC-XXX blocks TTRC-YYY

### Confluence Updates (via MCP)
- **[Page Name]:** Updated with [what]
- **[Page Name]:** Created new section for [what]
- **Link:** https://ajwolfe37.atlassian.net/wiki/x/[id]

---

## DOCUMENTATION CREATED

### Guides Written
- `/docs/[filename].md` - [Purpose of guide]
- `/docs/[filename].md` - [Purpose of guide]

### For Claude Code
- `/docs/plans/YYYY-MM-DD-plan.md` - Ready to execute
- Clear acceptance criteria defined
- Test cases included
- Edge cases documented

---

## CODE REVIEW (If Applicable)

### PRs Reviewed
**PR #[number]:** [Title]
- **Decision:** [Approved/Changes Requested]
- **Feedback:** [Key points]
- **Cost Impact:** [Verified no increase]

### Issues Found
- [Issue 1 and resolution]
- [Issue 2 and resolution]

---

## HANDOFF TO CLAUDE CODE

### Ready for Implementation
**Plan:** `/docs/plans/YYYY-MM-DD-plan.md`
**Tickets:** TTRC-XXX, TTRC-YYY, TTRC-ZZZ
**Branch Strategy:** Create `feature/ttrc-xxx-description`

### Specific Instructions for Code
1. Start with TTRC-XXX (highest priority)
2. Use cursor pagination (not offset)
3. Test with Puppeteer after each component
4. Create separate PRs for each ticket

### Success Criteria
- [ ] All items in plan completed
- [ ] No console errors
- [ ] Tests pass
- [ ] PRs created with JIRA references

---

## ANALYSIS & INSIGHTS

### Cost Analysis
**Current Burn:** $[X]/month
**After Changes:** $[Y]/month
**Budget Status:** [OK/Concern/Need optimization]

### Risk Assessment
**Technical Risks:**
- [Risk 1]: [Mitigation plan]
- [Risk 2]: [Mitigation plan]

**Timeline Risks:**
- [Blocker]: [What could delay progress]

### Performance Considerations
- [Metric]: [Current] → [Target]
- [Optimization]: [Planned approach]

---

## NEXT PRIORITIES

### For Claude Code (Immediate)
1. Execute `/docs/plans/YYYY-MM-DD-plan.md`
2. Focus on TTRC-XXX first
3. Create PRs for review

### For Next Desktop Session
1. Review Code's PRs
2. Plan next migration phase
3. Address [complex technical decision]

### Blocked Items
- TTRC-XXX: Waiting on [what]
- Decision needed: [what from Josh]

---

## SESSION METRICS

### Efficiency Notes
- **Worked Well:** [Process that saved time]
- **Improvement:** [What could be better]
- **Tool Usage:** [How MCP tools helped]

### Token Usage
- Started: [X]K tokens
- Ended: [Y]K tokens  
- Efficiency: [Good/Heavy/Need new conversation]

---

## ENVIRONMENT STATUS

**TEST:** 
- Status: [Stable/Issues]
- URL: https://test--taupe-capybara-0ff2ed.netlify.app/
- Last Deploy: [time]

**PROD:**
- Status: [Stable/Issues]
- URL: https://trumpytracker.com/
- Changes Pending: [None/List]

**Database:**
- Migrations: [Current/Needed]
- Schema: [Stable/Changes made]

---

_Created: [ISO timestamp]_
_Tool: Claude Desktop_
_Next: Claude Code should execute plan_
```

---

## CHECKLIST BEFORE SAVING

- [ ] JIRA updated via MCP tools
- [ ] Confluence updated via MCP tools
- [ ] Implementation plan created for Code
- [ ] Cost impact assessed
- [ ] Risks documented
- [ ] Clear handoff to Code
- [ ] Save to: `/docs/handoffs/YYYY-MM-DD-desktop-[description].md`

---

## What TO Include

- Strategic decisions and rationale
- Architecture choices
- Implementation plans for Code
- Cost and risk analysis
- Clear priorities

## What NOT to Include

- Detailed code implementations
- Step-by-step instructions Code already knows
- Repetition of standard procedures

Keep it strategic, clear, and actionable for Code.

---

_Reference: `/docs/CLAUDE-DESKTOP-VS-CODE-GUIDE.md`_
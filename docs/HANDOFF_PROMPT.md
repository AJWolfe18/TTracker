# TrumpyTracker - Session Handoff Prompt

## BEFORE CREATING HANDOFF

**Execute these actions using tools (NOT manual instructions):**

1. **Update JIRA** (use Atlassian tools)
   - Transition tickets to correct status
   - Add progress comments
   - Create new tickets if needed
   - Link related tickets

2. **Update Confluence** (use Atlassian tools)
   - Update implementation plan if status changed
   - Update relevant status pages
   - Add links to new documentation

3. **Verify Test Environment**
   - Check deployed code works (if applicable)
   - Verify no console errors
   - Test critical paths

---

## HANDOFF ARTIFACT

**Create artifact titled:** "Project Handoff - [Date Time] - [Focus Area]"  
**Save location:** `/docs/handoffs/YYYY-MM-DD-descriptive-name.md`  
**DO NOT add to project knowledge** - it lives in git only

---

## TEMPLATE

```markdown
# Project Handoff - [Date + Time] - [Focus Area]

## SESSION SUMMARY
[1-2 sentences: what we accomplished + business impact]

---

## WHAT GOT DONE

### Code Changes
**Branch:** [test/main]  
**Commit Message:** `[type]: [description]`  
**Files Changed:**
- `path/to/file.js` - [one-line description]
- `path/to/file.md` - [one-line description]

### Testing Status
- ✅ **Verified:** [what's tested and confirmed working]
- ⏳ **Pending:** [needs testing/review/deployment]
- ❌ **Issues:** [broken/blocked items with TTRC-XXX numbers]

---

## UPDATES COMPLETED (Via Tools)

### JIRA
- **Transitioned:** TTRC-XXX from [Status A] → [Status B]
- **Updated:** TTRC-XXX with [what was added to comments]
- **Created:** TTRC-XXX for [new work identified]
- **Blocked:** TTRC-XXX - [reason + what's needed to unblock]

### Confluence
- **[Page Name]**: [What changed] - [link]
- **[Page Name]**: [What changed] - [link]

### Documentation
- `/docs/[file]`: [What changed]

---

## TECHNICAL CONTEXT

### Key Decisions Made
**Decision:** [What we chose]  
**Rationale:** [Why this is the best option]  
**Alternatives Considered:** [What we didn't choose + why not]  
**Cost Impact:** [$X/month change OR "No cost impact"]

### Watch Out For
- **Gotcha:** [Technical limitation or edge case to be aware of]
- **Dependency:** [What needs to happen before next steps]
- **Risk:** [Potential issue + how we're mitigating it]

---

## NEXT SESSION PRIORITIES

### Immediate Actions
1. **TTRC-XXX:** [Most urgent task - explain why it's urgent]
2. **TTRC-XXX:** [Next important task]
3. **Verify:** [Any pending tests, checks, or validations]

### Blocked/Waiting
- **TTRC-XXX:** Blocked by [specific reason] - needs [specific resolution]
- **Waiting On:** [External dependency or Josh's decision]

### Questions for Josh
- **Decision Required:** [What needs PM approval or input]
- **Clarification Needed:** [Any ambiguity that should be resolved]

---

## ENVIRONMENT STATUS

**TEST Environment:**
- Status: [Deployed/Pending/Issues]
- URL: https://test--taupe-capybara-0ff2ed.netlify.app/
- Notes: [Any relevant details]

**PROD Environment:**
- Status: [Stable/Changes Pending/Issues]
- URL: https://trumpytracker.com/
- Notes: [Any relevant details]

**Cost:** $X/month [↑ increased / ↓ decreased / → unchanged]

**Database:**
- [Any schema changes, migrations, or data concerns]

---

## COMMIT READY

**Commit command for Josh:**
```bash
git add [list files]
git commit -m "[type]: [description]

[optional body with details]"
git push origin [branch]
```

---

_Created: [ISO timestamp]_  
_Environment: [TEST/PROD]_  
_Session Duration: [~X hours]_
```

---

## HANDOFF QUALITY CHECKLIST

Before finalizing handoff, verify:
- [ ] All JIRA tickets updated (with tools, not "needs update")
- [ ] All Confluence pages updated (with tools, not "needs update")
- [ ] Files saved to correct location (`/docs/handoffs/`, not project knowledge)
- [ ] Testing status clear (what works, what needs testing, what's broken)
- [ ] Next priorities ranked by urgency
- [ ] Cost impact stated explicitly
- [ ] Commit command ready to copy/paste
- [ ] Environment status accurate

---

## WHAT NOT TO INCLUDE

**Don't include:**
- Implementation details Josh already approved
- Verbose code explanations (file changes list is enough)
- Options or alternatives (decision already made)
- Apologies or hedging language
- Process descriptions (Josh knows the workflow)

**Keep it:**
- Actionable
- Factual
- Concise
- Business-focused

---

_Reference: `/docs/SESSION_PROTOCOL.md` for full details_  
_Last Updated: October 2, 2025_

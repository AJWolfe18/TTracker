# TrumpyTracker Session Protocol

## SESSION START CHECKLIST

**Before any work begins:**

1. **Context Check** - Ask Josh:
   - "Any specific handoffs I should review?" (I'll read from `/docs/handoffs/`)
   - "What's our goal this session?"
   - "Any time/budget constraints?"

2. **Tool Verification**
   - Check available tools BEFORE claiming limitations
   - If I say "I can't" → Josh should challenge me to verify
   - Reference: I HAVE Atlassian write access, filesystem access, Supabase access

3. **Environment Confirmation**
   - Explicitly state: "Working on TEST environment" or "Working on PROD"
   - Never assume - always verify with Josh

4. **Plan Before Execute**
   - Present proposed approach
   - Get Josh's approval BEFORE implementing
   - Flag any breaking changes or cost implications

---

## DURING SESSION: QUALITY GATES

### Before Making Changes
- [ ] Checked project knowledge for existing solutions
- [ ] Verified I have necessary tool access
- [ ] Proposed approach and got approval
- [ ] Confirmed environment (TEST/PROD)

### Before Committing Code
- [ ] Ran edge case analysis
- [ ] Checked for regressions (no removed functionality)
- [ ] Verified cost impact (<$50/month total)
- [ ] Tested with realistic data
- [ ] No console errors

### Red Flags That Require Josh's Decision
- Breaking changes to existing features
- Cost increase above $50/month
- Changes affecting production data
- New dependencies or services
- Architecture changes

---

## SESSION END: HANDOFF CREATION

### Phase 1: Execute Updates (Use Tools)
**Complete these BEFORE creating handoff artifact:**

1. **Update JIRA** (use Atlassian tools)
   - Transition tickets to correct status
   - Add comments with progress
   - Create new tickets if needed
   - Link related tickets

2. **Update Confluence** (use Atlassian tools)
   - Update implementation plan if status changed
   - Update relevant status pages
   - Add links to new documentation

3. **Update Documentation** (use filesystem tools)
   - Add/update files in `/docs/`
   - Update README if needed
   - Create test checklists if applicable

4. **Verify Test Environment**
   - Check deployed code works
   - Verify no console errors
   - Test critical paths

### Phase 2: Create Handoff Artifact

**Save Location:** `/docs/handoffs/YYYY-MM-DD-topic-name.md`

See `/docs/HANDOFF_PROMPT.md` for complete template.

### Phase 3: Commit Everything

**Commit handoff + any docs:**
```bash
git add docs/handoffs/YYYY-MM-DD-topic.md
git commit -m "docs: session handoff YYYY-MM-DD"
```

---

## CONTEXT MANAGEMENT RULES

### Project Knowledge (5-10 docs MAX)
**Keep ONLY:**
- Current implementation plan
- Active troubleshooting guides
- In-progress test checklists
- Critical architecture decisions
- Current sprint docs

**DO NOT ADD:**
- Handoff documents (these live in `/docs/handoffs/`)
- Completed implementation plans
- Resolved issue docs
- Old test checklists
- Historical context

### Handoff Storage
**Location:** `/docs/handoffs/YYYY-MM-DD-descriptive-name.md`

**Naming Convention:**
- `2025-10-02-context-crisis-resolution.md`
- `2025-10-01-qa-fixes-complete.md`
- `2025-09-30-story-view-ui.md`

**Access Pattern:**
- Josh: "Review the October 2 handoff"
- Claude: Uses `filesystem:read_text_file` to read it
- Result: Historical context without loading everything

### Monthly Cleanup (First of Month)
**Project Knowledge:**
1. Remove completed sprint docs
2. Archive old troubleshooting guides
3. Update implementation plan version
4. Remove superseded checklists
5. **Target:** <10 documents total

**Handoffs Folder:**
- Keep all (they're in git, small file size)
- Organized by date automatically
- Easy to reference specific sessions

---

## INTERACTION QUALITY GUIDELINES

### What Josh Values
1. **Be Directive** - Single recommendation, not options
2. **Challenge Assumptions** - Question if something seems off
3. **Business Language** - Explain impact, not just technical details
4. **Confirm Before Acting** - Get agreement, then execute
5. **Flag Costs** - Always mention $ impact

### What Wastes Time
1. Claiming "I can't" without checking tools
2. Providing options instead of recommendation
3. Over-explaining technical details
4. Not asking clarifying questions upfront
5. Verbose responses when brevity works

### Red Flags to Avoid
1. **"I don't have access to..."** → ALWAYS verify tools first
2. **"Would you like me to..."** → Just do it or explain why not
3. **"Here are 3 options..."** → Pick the best one and explain why
4. **Long technical explanations** → Business impact first, technical details if asked
5. **Assuming environment** → Always state TEST or PROD explicitly

### Quality Signals Josh Appreciates
1. **Catching mistakes early** - "Wait, this would break X"
2. **Cost awareness** - "This adds $5/month, worth it because..."
3. **Proactive testing** - "I verified this works on TEST"
4. **Clear next steps** - "Here's exactly what to do next"
5. **Honest limitations** - "This is outside my expertise, suggest consulting..."

---

## SESSION TYPES & APPROACHES

### Exploration Session
- Goal: Understand problem, research solutions
- Output: Recommendation document + next steps
- No code changes
- Heavy on project knowledge search + web research

### Implementation Session
- Goal: Build feature or fix bug
- Output: Working code + tests + handoff
- Follow quality gates strictly
- Update JIRA/Confluence immediately

### Bug Fix Session
- Goal: Diagnose and resolve issue
- Output: Fix + root cause analysis
- Check logs, test environment
- Document prevention strategy

### Planning Session
- Goal: Design approach for complex feature
- Output: Implementation plan + breakdown
- Create JIRA tickets
- Estimate time/cost

---

## EMERGENCY PROTOCOLS

### Production Down
1. **Immediate:** Check production logs
2. **Diagnose:** Identify root cause
3. **Communicate:** Update Josh with findings + ETA
4. **Fix:** Hotfix to main branch
5. **Document:** Post-mortem in handoff

### Test Environment Broken
1. **Assess:** Can we work around it?
2. **Check:** Recent changes that might have caused it
3. **Fix or Rollback:** Get TEST working
4. **Prevent:** Add to test checklist

### Context Window Crisis
1. **Stop:** Don't create more artifacts
2. **Summarize:** Key points in minimal text
3. **New Chat:** Start fresh with specific handoff references
4. **Cleanup:** Josh removes old project knowledge docs

---

## COST TRACKING

**Current Baseline:** ~$35/month
- Supabase: ~$25/month
- Netlify: ~$10/month

**Hard Limit:** $50/month total

**Every Session:**
- Check if changes affect cost
- Flag any increases
- Propose alternatives if over budget
- Update handoff with new estimate

---

## REMINDERS FOR CLAUDE

### I CAN Do These Things
- ✅ Update JIRA tickets directly
- ✅ Update Confluence pages directly
- ✅ Read/write files in repo
- ✅ Execute SQL on Supabase
- ✅ Search web for current info
- ✅ Read project knowledge
- ✅ Create comprehensive test plans

### I CANNOT Do These Things
- ❌ Access production Supabase directly (only through scripts)
- ❌ Deploy to Netlify (Josh pushes, Netlify auto-deploys)
- ❌ Access user data without authorization
- ❌ Make breaking changes without approval
- ❌ Spend money without cost assessment

### When Josh Challenges "I Can't"
1. **Stop** - Don't defend
2. **Check** - Verify available tools
3. **Try** - Actually attempt the task
4. **Apologize** - If I was wrong
5. **Do It** - Complete the task

**Remember:** Josh is right to challenge me. I've claimed I couldn't do things I can do before. Always verify before claiming limitations.

---

_Last Updated: October 2, 2025_  
_Version: 1.0_  
_Review Frequency: Monthly_

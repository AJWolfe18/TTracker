# 🚀 TTRC-231 Quick Start

**New session? Start here!**

---

## 📋 What You Need to Know

**Current Status:** TTRC-230 Complete ✅, TTRC-231 Ready to Start

**Your Mission:** Implement lifecycle management, auto-split, and periodic merge for story clustering

**Branch:** `test` (NEVER touch main!)

**Documents to Read:**
1. **THIS FILE** (you're reading it)
2. `docs/handoffs/2025-10-13-ttrc231-plan.md` (full implementation plan)
3. `docs/handoffs/2025-10-13-ttrc231-todos.md` (detailed checklist)
4. `docs/STARTUP_PROMPT.md` (session protocol)

---

## 🎯 Quick Context

**What TTRC-230 Built (Already Done ✅):**
- Hybrid scoring algorithm (6+ signals)
- Candidate generation (<100ms)
- Centroid tracking
- Core clustering logic in `hybrid-clustering.js`
- Stale story reopening

**What TTRC-231 Needs (Your Job):**
1. **Lifecycle automation** - Stories transition states automatically (emerging → growing → stable → stale)
2. **Auto-split** - Detect when stories contain unrelated articles (coherence <0.50)
3. **Periodic merge** - Daily job to merge duplicate stories (coherence >0.70)
4. **Testing** - Validate with 4 real articles, create integration tests
5. **Documentation** - Update JIRA, create handoff

**Key Insight:** The clustering algorithm is DONE. You're building lifecycle + quality assurance.

---

## 🏃 Quick Start Commands

```bash
# 1. Confirm branch
git branch --show-current  # Should be "test"

# 2. Check JIRA status
# Use MCP tool: mcp__atlassian__getJiraIssue with TTRC-231

# 3. Create TodoWrite tracking
# Use TodoWrite tool with items from todos.md

# 4. Start with Task 1 (Lifecycle Management)
# See todos.md for checklist
```

---

## 📊 Success Metrics

**Must Achieve:**
- ✅ Precision ≥0.90
- ✅ Recall ≥0.85
- ✅ Performance <500ms p95
- ✅ Manual intervention <5%
- ✅ Cost = $0

---

## ⚠️ Critical Rules

1. **NEVER touch main branch** - work on test only
2. **Follow process workflow** - read STARTUP_PROMPT.md
3. **Use TodoWrite tool** - track progress
4. **Test before committing** - use validation agent (Task tool)
5. **Run AI code review** - push triggers workflow
6. **Update JIRA directly** - use MCP tools
7. **Create handoff when done** - document for next session

---

## 🗂️ Files You'll Create

**New Files:**
- `scripts/rss/lifecycle.js`
- `scripts/rss/auto-split.js`
- `scripts/rss/periodic-merge.js`
- `migrations/025_lifecycle_automation.sql`
- `migrations/026_merge_audit_trail.sql`
- `tests/clustering-integration.test.js`
- `tests/lifecycle.test.js`
- `tests/split-merge.test.js`
- `.github/workflows/lifecycle-update.yml`
- `.github/workflows/story-merge.yml`
- Helper scripts for cron jobs

**Files to Modify:**
- `scripts/job-queue-worker.js` (add handlers)
- `scripts/test-real-clustering.js` (fix ingestion)

---

## 🧪 Test Articles (For Task 4)

4 Trump/Netanyahu articles that should cluster together:
1. https://www.politico.eu/article/more-than-cigars-and-champagne-donald-trump-benjamin-netanyahu-israel/
2. https://www.reuters.com/world/middle-east/trump-urges-israels-president-pardon-netanyahu-2025-10-13/
3. https://www.foxnews.com/world/trump-calls-netanyahu-pardon-after-hailing-swift-removal-left-wing-lawmakers-security
4. https://nypost.com/2025/10/13/us-news/trump-urges-israeli-president-to-pardon-netanyahu/

---

## 📝 Task Order (Recommended)

1. **Lifecycle Management** (1 day)
   - SQL migration
   - Job handler
   - Cron workflow
   - Testing

2. **Auto-Split Detection** (1 day)
   - Coherence calculation
   - Split logic
   - Job handler
   - Testing

3. **Periodic Merge** (1 day)
   - Candidate detection
   - Merge execution
   - Audit trail
   - Cron workflow
   - Testing

4. **Validation & Testing** (1 day)
   - Real article test (4 articles)
   - Integration test suite
   - QA & fixes
   - AI code review

---

## 🔗 Important Links

- **JIRA:** https://ajwolfe37.atlassian.net/browse/TTRC-231
- **Epic:** https://ajwolfe37.atlassian.net/browse/TTRC-225
- **Plan Doc:** `docs/handoffs/2025-10-13-ttrc231-plan.md`
- **Todo List:** `docs/handoffs/2025-10-13-ttrc231-todos.md`
- **Startup Protocol:** `docs/STARTUP_PROMPT.md`

---

## 🎬 First Steps (Copy-Paste)

```bash
# Step 1: Read documents
cat docs/handoffs/2025-10-13-ttrc231-plan.md
cat docs/handoffs/2025-10-13-ttrc231-todos.md
cat docs/STARTUP_PROMPT.md

# Step 2: Check JIRA
# Use MCP tool in chat

# Step 3: Create TodoWrite
# Use TodoWrite tool with 9 main tasks from todos.md

# Step 4: Start coding
# Begin with Task 1: Lifecycle Management
```

---

## ❓ Questions?

If confused, ask:
- "Can you summarize what TTRC-231 needs?"
- "What files do I need to create?"
- "What's the difference between TTRC-230 and TTRC-231?"
- "Show me the success metrics again"

---

## ✅ Definition of Done

- [ ] All 9 tasks in todos.md complete
- [ ] All tests passing
- [ ] AI code review passed
- [ ] JIRA updated to "Ready for Prod"
- [ ] Handoff document created
- [ ] No regressions
- [ ] Performance <500ms p95
- [ ] Cost still $0

---

**Ready? Read the plan.md and todos.md, then start with Task 1!**

**Good luck! 🚀**

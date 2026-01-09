# Session Handoff: JIRA Cards Created for RSS Feed Expansion

**Date:** November 6, 2025
**Session Type:** Planning & JIRA Ticket Creation
**Environment:** Planning (no code execution)
**Duration:** ~45 minutes

---

## 🎯 What We Accomplished

Created **1 epic** and **6 stories** for RSS feed expansion (Phases 2-4) using detailed specifications from the planning document.

### Epic Created

**TTRC-250: RSS Feed Expansion - Ad Fontes Green Box Sources**
- Goal: Scale from 5 to 15 high-reliability feeds
- Timeline: 3 weeks (Phases 2-4)
- Budget Impact: +$1.31/month (stays under $45/month cap)
- Success Criteria: All feeds HEALTHY, <3% errors, clustering maintained

### Stories Created (7 story points total)

| Ticket | Summary | Points | Phase | Plan Doc Lines |
|--------|---------|--------|-------|----------------|
| **TTRC-251** | Pre-Flight Infrastructure Validation | 1 | Phase 2 | 107-274 |
| **TTRC-252** | Monitor Existing 5 Feeds (48h Validation) | 1 | Phase 2 | 277-518 |
| **TTRC-253** | Add First 3 Feeds (CSM + PBS + Time) | 1 | Phase 3 | 521-796 |
| **TTRC-254** | Monitor First 3 Feeds (48h) | 1 | Phase 3 | 799-970 |
| **TTRC-255** | Add Remaining 7 Feeds (Full Rollout) | 2 | Phase 4 | 979-1240 |
| **TTRC-256** | Final Validation & Operations Runbook | 2 | Phase 4 | 1243-1650 |

---

## 📝 Ticket Format (Hybrid Approach)

Each JIRA ticket includes:

✅ **Clear summary** of objectives
✅ **Acceptance criteria** (5-7 checkboxes per story)
✅ **References to plan document** with specific line numbers
✅ **Key SQL commands** (inserts, compliance rules, validations)
✅ **Emergency rollback procedures** (always accessible)
✅ **GO/NO-GO decision criteria**
✅ **Dependencies** properly noted
✅ **All linked to Epic TTRC-250**

### Why Hybrid Format?

**JIRA has:** High-level summary + acceptance criteria + plan references + emergency rollback
**Plan doc has:** Detailed procedures, full SQL, troubleshooting decision trees

**Benefits:**
- JIRA tickets remain scannable and readable
- Single source of truth (plan doc) - no sync issues
- Claude can quickly understand goals and find detailed procedures
- Emergency procedures always accessible

---

## 🔗 Dependencies Flow

```
TTRC-251 (Pre-Flight Infrastructure Validation)
    ↓
TTRC-252 (Monitor Existing 5 Feeds - 48h) → GO/NO-GO Decision
    ↓ (if GO)
TTRC-253 (Add First 3 Feeds: CSM/PBS/Time)
    ↓
TTRC-254 (Monitor First 3 Feeds - 48h) → GO/NO-GO Decision
    ↓ (if GO)
TTRC-255 (Add Remaining 7 Feeds) → GO/NO-GO Decision (4h check)
    ↓
TTRC-256 (Final Validation + Runbook) → GO/NO-GO Decision (48h check)
```

---

## 📚 Reference Documents

### Primary Plan Document
**Location:** `docs/plans/rss-expansion-ad-fontes-plan.md` (1,715 lines)

**Structure:**
- Lines 1-79: Executive summary, target feeds
- Lines 80-106: Epic overview
- Lines 107-274: Story 0 (Pre-Flight)
- Lines 277-518: Story 1 (Monitor 48h)
- Lines 521-796: Story 2 (Add CSM/PBS/Time)
- Lines 799-970: Story 3 (Monitor 48h)
- Lines 979-1240: Story 4 (Add 7 feeds)
- Lines 1243-1650: Story 5 (Final validation + runbook)

### Previous Handoffs
- `NEXT_SESSION_PHASE2_PLANNING.md` - Planning TODO (now complete)
- `2025-11-04-worker-and-eo-fixes.md` - Last execution session
- `2025-10-28-migrations-028-029-complete.md` - Phase 1 completion

---

## 📊 Current State

### Phase 1 (Complete) ✅
**Epic TTRC-241:** RSS Feed Infrastructure & Expansion
- TTRC-242 through TTRC-247 (6 stories)
- Migrations 027-029 deployed to TEST
- Monitoring views, RPCs, compliance rules all in place
- Status: "Ready for Prod"

### Phase 2-4 (Ready to Start) 📋
**Epic TTRC-250:** RSS Feed Expansion
- TTRC-251 through TTRC-256 (6 stories)
- All tickets created with detailed specifications
- Dependencies mapped
- Emergency rollback procedures documented
- Status: "Backlog" - Ready for execution

### Known Blockers ⚠️
**TTRC-248:** RSS Pipeline Not Running
- No articles since Oct 16 (13 days ago)
- Status: "Ready for Test"
- **Must resolve before starting TTRC-251**

---

## 🚀 Next Session: Start TTRC-251

### Recommended Starter Prompt

```
Working on RSS feed expansion (TTRC-250).

Phase 1 (TTRC-241) complete - infrastructure deployed to TEST.
Ready to start Phase 2 (validation) with TTRC-251.

Reference: docs/plans/rss-expansion-ad-fontes-plan.md
```

### First Tasks (TTRC-251)

1. **Verify worker operational**
   - Check if job-queue-worker.js is running
   - Monitor for 5 minutes to ensure it processes jobs

2. **Check queue depth**
   - Query: `SELECT COUNT(*) FROM job_queue WHERE status = 'pending'`
   - RED FLAG if any pending jobs >5 minutes old

3. **Verify tier-based scheduler exists**
   - Check GitHub Actions workflows
   - Or Edge Functions with pg_cron
   - **BLOCKER if none exists** - must implement before expansion

4. **Database size check**
   - Query: `SELECT pg_size_pretty(pg_database_size(current_database()))`
   - RED FLAG if >250MB

5. **Document baseline metrics**
   - Active feeds, total articles, active stories, pending jobs
   - Monthly cost projection

### GO/NO-GO Decision
- **GO if:** Worker running, queue <5min, scheduler working, DB <250MB, rollback tested
- **NO-GO if:** Any critical system not operational

---

## 💰 Budget & Cost Tracking

### Current State (Phase 1)
- **Active feeds:** 5 (NYT, WaPo, Politico, Reuters, AP)
- **Monthly cost:** ~$35/month (30% of $50 budget)
- **Cost per feed:** ~$7/month average

### Projected State (Phase 2-4 Complete)
- **Active feeds:** 15 total (10 new)
- **Additional cost:** +$1.31/month
- **New total:** ~$36.31/month (73% of budget)
- **Cost per feed:** ~$2.42/month average
- **Buffer remaining:** ~$14/month (28%)

### Cost Gates
- Story 2: Cost ≤ $0.30/month for 3 feeds
- Story 4: Real-time check at 4h (projected <$1)
- Story 5: Final validation <$45/month total

---

## 🎯 Target Feeds (15 Total)

### Already Live (5 feeds)
1. ✅ NYT Politics (Tier 1) - Working
2. ✅ WaPo Politics (Tier 1) - Working
3. ✅ Politico Top (Tier 2) - Working
4. ❌ Reuters Politics (Tier 1) - 22 failures (needs fix)
5. ❌ AP News US (Tier 1) - 22 failures (needs fix)

### Phase 3: First 3 (Story 2-3)
6. Christian Science Monitor (Tier 1)
7. PBS NewsHour (Tier 1)
8. Time Politics (Tier 2)

### Phase 4: Final 7 (Story 4-5)
9. Newsweek Politics (Tier 2)
10. The Atlantic Politics (Tier 2) - **PAYWALL**
11. Reason Politics (Tier 2)
12. Fortune Politics (Tier 2) - **PAYWALL**
13. Vox Politics (Tier 2)
14. Foreign Affairs (Tier 3) - **PAYWALL**
15. The New Yorker News/Politics (Tier 3) - **PAYWALL**

### Compliance Notes
- **All feeds:** 1200 char excerpt limit
- **Paywalled feeds (4):** MUST remain excerpt-only (Atlantic, Fortune, Foreign Affairs, New Yorker)

---

## ⚠️ Critical Notes for Next Session

### Must Check First
1. **TTRC-248 status** - Is RSS pipeline running? (blocker)
2. **Worker status** - Is job-queue-worker.js running?
3. **Tier scheduler** - Does it exist? (blocker if not)

### Before Adding Any Feeds
1. Run full pre-flight checklist (TTRC-251)
2. Fix or disable Reuters/AP feeds (TTRC-252)
3. Document baseline metrics
4. Test emergency rollback procedure

### Emergency Contacts
- All rollback SQL in JIRA tickets
- Full procedures in plan doc
- Baseline metrics needed for rollback verification

---

## 📁 Files Created/Modified

### Created
- Epic TTRC-250 in JIRA
- Stories TTRC-251 through TTRC-256 in JIRA
- This handoff document

### Referenced (No Changes)
- `docs/plans/rss-expansion-ad-fontes-plan.md` - Already complete
- `docs/handoffs/NEXT_SESSION_PHASE2_PLANNING.md` - Now complete (cards created)

### To Be Created (Future Sessions)
- `docs/operations-runbook-rss-v2.md` - By TTRC-256
- Session handoffs after each story completion

---

## ✅ Definition of Done (This Session)

- [x] New epic created for Feed Expansion (TTRC-250)
- [x] 6 stories created with clear acceptance criteria
- [x] Stories ordered in dependency sequence
- [x] Effort estimated for each story (7 points total)
- [x] Epic linked to related work (TTRC-241)
- [x] Plan reviewed and approved
- [x] Handoff documentation created

---

## 🔄 Session Timeline

**Week 1 (Next Session):**
- Day 1: TTRC-251 Pre-flight validation
- Day 2-3: TTRC-252 Monitor 48h + fix Reuters/AP

**Week 2:**
- Day 1: TTRC-253 Add CSM/PBS/Time
- Day 2-3: TTRC-254 Monitor 48h (GO/NO-GO gate)

**Week 3:**
- Day 1: TTRC-255 Add remaining 7 feeds
- Day 2-4: TTRC-256 Final validation + runbook

**Total Timeline:** 3 weeks from start to completion

---

## 📞 Support Resources

### Documentation
- Plan document: `docs/plans/rss-expansion-ad-fontes-plan.md`
- Startup guide: `docs/CLAUDE_CODE_STARTUP.md`
- Project instructions: `CLAUDE.md`

### JIRA
- Epic: TTRC-250 (RSS Feed Expansion)
- Phase 1 Epic: TTRC-241 (Infrastructure - Complete)
- Blocker: TTRC-248 (Pipeline fix)

### Previous Work
- Handoffs: `docs/handoffs/`
- Phase 1 completion: October 28-29, 2025
- Planning completed: November 4, 2025
- JIRA cards created: November 6, 2025

---

**Session Completed:** November 6, 2025
**Next Session:** Start TTRC-251 (Pre-Flight Infrastructure Validation)
**Estimated Next Session Duration:** 30-45 minutes
**Token Usage:** 119K/200K (60% budget remaining)

# Next Session: Phase 2/3 Planning - Feed Expansion JIRA Cards

**Prerequisites:** Phase 1 tickets deployed to TEST (Migrations 027-029). PROD deployment pending TTRC-145 (frontend QA).
**Environment:** Planning session (no code execution)
**Goal:** Create JIRA epic and stories for RSS feed expansion (Phases 2-4)

**⚠️ STATUS UPDATE:** Phase 1 infrastructure is in TEST only, NOT in PROD yet. PROD deployment blocked by TTRC-145 (frontend QA). Feed expansion will proceed in TEST environment.

---

## Session Context

### What We Just Completed (Phase 1)

**Epic TTRC-241:** RSS Feed Infrastructure & Expansion  
**Stories completed (all in PROD):**
- TTRC-242: Migration 027 - Schema Foundation
- TTRC-243: Backfill Article→Feed Mappings
- TTRC-244: Migration 028 - Metrics RPCs
- TTRC-245: Migration 029 - Monitoring Views
- TTRC-246: Seed Compliance Rules
- TTRC-247: Post-Deployment Verification

**What this gave us:**
- Per-feed tracking (which feed sourced each article)
- Metrics tracking (success/error rates per feed)
- Health monitoring (HEALTHY/DEGRADED/CRITICAL status)
- Cost attribution ($ per feed)
- Foundation to safely add 10-15 new feeds

**Current State:**
- 5 active feeds (Reuters, AP, NYT, WaPo, Politico)
- Monitoring infrastructure working
- ~$35/month cost (30% of $50 budget)

---

## What Needs to Be Planned

### Reference: Executive Summary Phases

From `docs/rss-deployment/RSS v2/00_EXECUTIVE_SUMMARY.md`:

**Phase 2: Validation (Days 1-3)**
- Monitor existing 5 feeds for 48-72 hours
- Verify metrics tracking correctly
- Confirm cost attribution accurate
- Check health dashboards

**Phase 3: First Expansion (Week 1)**
- Add 2 high-quality feeds (Christian Science Monitor, Time)
- Monitor for 48 hours
- Validate clustering quality maintained
- Check cost stays within budget

**Phase 4: Full Expansion (Weeks 2-4)**
- Add 3-5 feeds per week
- Monitor stability after each batch
- Disable any underperforming sources
- Target: 15 feeds total

---

## Your Tasks for This Session

### 1. Review Phase 1 Completion

**Questions to confirm:**
- Are all Phase 1 tickets (TTRC-242 through 247) deployed to PROD?
- Have we monitored PROD for at least 24 hours?
- Are there any blocking issues from Phase 1?

**If NO to any:** Resolve Phase 1 issues before creating Phase 2 cards.

### 2. Create New Epic: Phase 2/3 Feed Expansion

**Suggested Epic:**
- **Title:** "RSS Feed Expansion - Add 10 New Feeds"
- **Goal:** Scale from 5 → 15 feeds using monitoring infrastructure
- **Timeline:** 3-4 weeks
- **Budget Impact:** +$1.31/month (stays under $50 cap)

**Link to:** TTRC-241 (Phase 1 epic) as "related to" or "follows"

### 3. Create Stories for Phase 2 (Monitoring)

**Story 1: 48-Hour PROD Monitoring**
- **Title:** "Monitor Phase 1 Deployment (48h)"
- **Tasks:**
  - Check `admin.feed_health_overview` twice daily
  - Review error logs in `feed_errors` table
  - Verify cost attribution accuracy
  - Confirm metrics recording correctly
- **Acceptance Criteria:**
  - All 5 feeds show HEALTHY or INACTIVE
  - Error rate < 5% per feed
  - Cost projection matches actual OpenAI bills
  - No clustering regressions
- **Effort:** 1 story point (monitoring only)

**Story 2: Create Feed Candidate List**
- **Title:** "Research and Select 10 New RSS Feeds"
- **Tasks:**
  - Review news source quality/reliability
  - Check RSS feed availability and format
  - Verify copyright/ToS allow excerpts
  - Prioritize by topic coverage
- **Acceptance Criteria:**
  - List of 10 feeds with URLs
  - ToS review complete for each
  - Feeds categorized by priority (Tier 1/2/3)
  - Documented in Confluence or handoff
- **Effort:** 2 story points

### 4. Create Stories for Phase 3 (First Expansion)

**Story 3: Add First 2 Feeds (Tier 1)**
- **Title:** "Add Christian Science Monitor + Time RSS Feeds"
- **Tasks:**
  - Insert into `feed_registry` table
  - Add compliance rules (1200 char limit)
  - Trigger initial fetch via `rss-enqueue` Edge Function
  - Verify articles ingesting correctly
- **Acceptance Criteria:**
  - 2 new feeds active in `feed_registry`
  - Compliance rules configured
  - Articles ingesting from both feeds
  - No errors in first 24h
- **Effort:** 1 story point
- **Dependencies:** Story 1 (48h monitoring) complete

**Story 4: Monitor First 2 Feeds (48h)**
- **Title:** "Monitor CSM + Time Feeds for 48h"
- **Tasks:**
  - Check article quality (clustering working?)
  - Review health status (any CRITICAL/DEGRADED?)
  - Verify cost increase matches projection
  - Check for duplicate stories
- **Acceptance Criteria:**
  - Both feeds showing HEALTHY status
  - Article quality maintained
  - Cost increase ≤ $0.30/month
  - No clustering regressions
- **Effort:** 1 story point

### 5. Create Stories for Phase 4 (Full Expansion)

**Story 5: Add Feeds Batch 2 (3 feeds)**
- **Title:** "Add Tier 2 Feeds (Batch 2 - 3 feeds)"
- **Tasks:** Same as Story 3, but for 3 feeds
- **Effort:** 2 story points
- **Dependencies:** Story 4 (monitor first 2) complete

**Story 6: Monitor Batch 2 (48h)**
- **Effort:** 1 story point

**Story 7: Add Feeds Batch 3 (3 feeds)**
- **Effort:** 2 story points

**Story 8: Monitor Batch 3 (48h)**
- **Effort:** 1 story point

**Story 9: Add Final Feeds (2 feeds)**
- **Title:** "Add Tier 3 Feeds (Final 2 feeds)"
- **Effort:** 1 story point

**Story 10: Final Validation & Performance Review**
- **Title:** "15-Feed System Validation"
- **Tasks:**
  - Review all 15 feed health statuses
  - Analyze cost per feed (identify underperformers)
  - Check clustering quality across all sources
  - Document any feeds to disable
  - Create operations runbook
- **Acceptance Criteria:**
  - All 15 feeds configured
  - Total cost < $40/month
  - Clustering quality maintained
  - Operations runbook created
  - Feed performance dashboard working
- **Effort:** 2 story points

---

## Suggested Epic Structure

```
Epic: RSS Feed Expansion - Scale to 15 Feeds
├── Story: 48-Hour PROD Monitoring (Phase 2)
├── Story: Research Feed Candidates (Phase 2)
├── Story: Add First 2 Feeds - CSM + Time (Phase 3)
├── Story: Monitor First 2 Feeds - 48h (Phase 3)
├── Story: Add Batch 2 - 3 Feeds (Phase 4)
├── Story: Monitor Batch 2 - 48h (Phase 4)
├── Story: Add Batch 3 - 3 Feeds (Phase 4)
├── Story: Monitor Batch 3 - 48h (Phase 4)
├── Story: Add Final Feeds - 2 Feeds (Phase 4)
└── Story: Final Validation & Performance Review (Phase 4)
```

**Total:** 10 stories, ~14 story points, 3-4 weeks

---

## Questions to Ask Josh

Before creating these cards, confirm with Josh:

1. **Feed Selection:** Does Josh already have specific feeds in mind, or should we research?
2. **Batch Sizes:** Comfortable with 2 → 3 → 3 → 2 batching, or prefer different?
3. **Monitoring Cadence:** 48h between batches enough, or need longer?
4. **Cost Threshold:** Confirm we stop if monthly cost approaches $45 (10% buffer)?
5. **Quality Metrics:** What clustering accuracy threshold triggers a pause? (85%?)
6. **Epic Timeline:** Is 3-4 weeks realistic given Josh's availability?

---

## Additional Considerations

### Edge Function Updates (Optional)

Current Edge Functions use legacy 3-arg `enqueue_fetch_job()`. Should we create a story for:
- **"Update Edge Functions to Use New 5-arg RPC Signature"**
- Benefits: Can schedule fetch times, better feed attribution
- Effort: 2 story points
- Risk: LOW (backward compatible fallback exists)

Suggest: Add as optional story, can defer if not critical.

### Operations Runbook (Should Be Created)

**Story:** "Create RSS Feed Operations Runbook"
- Daily monitoring queries
- Health status alert thresholds
- Feed disable/re-enable procedures
- Cost tracking and budget alerts
- Troubleshooting common issues

Suggest: Include as part of Story 10 (Final Validation).

### Compliance Rules Template

**Story:** "Automate Compliance Rule Creation"
- Create SQL template for adding new feeds
- Default: 1200 char limit, allow_full_text=FALSE
- Documented procedure in runbook

Suggest: Include as part of feed research story (Story 2).

---

## Files You'll Need

**Planning References:**
- `docs/rss-deployment/RSS v2/00_EXECUTIVE_SUMMARY.md` (Phases 2-4 details)
- `docs/rss-deployment/RSS v2/00_START_HERE_EXECUTION_GUIDE.md` (Rollout plan)
- `docs/handoffs/2025-10-28-migrations-028-029-complete.md` (What we built)

**For Feed Research (Story 2):**
- Look at existing `feed_registry` table for format examples
- Review `feed_compliance_rules` for ToS notes
- Check `admin.feed_health_overview` to understand health monitoring

---

## Success Criteria for This Session

At the end:
- [ ] New epic created for Feed Expansion
- [ ] 10 stories created with clear acceptance criteria
- [ ] Stories ordered in dependency sequence
- [ ] Effort estimated for each story
- [ ] Epic linked to TTRC-241 (Phase 1)
- [ ] Josh reviewed and approved plan
- [ ] Ready to start Phase 2 work

---

## After This Session

**Next steps:**
1. Wait for Phase 1 PROD deployment to stabilize (48h)
2. Start Phase 2 monitoring (Story 1)
3. Research feed candidates (Story 2)
4. Begin Phase 3 feed additions when ready

**Timeline estimate:**
- Week 1: PROD stabilization + feed research
- Week 2: Add first 2 feeds + monitor
- Week 3: Add batches 2-3 (6 feeds)
- Week 4: Add final 2 feeds + validation

---

**Environment:** Planning (no execution)  
**Risk Level:** N/A (planning only)  
**Estimated Time:** 45-60 minutes  
**Deliverable:** JIRA epic + 10 stories ready for execution

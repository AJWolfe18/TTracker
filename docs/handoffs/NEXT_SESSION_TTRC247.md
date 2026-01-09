# Next Session: TTRC-247 Post-Deployment Verification

**Date:** 2025-10-29 (or later)
**Environment:** TEST
**Goal:** Run comprehensive verification to confirm all migrations working correctly

---

## Session Context

We just completed TTRC-242, 243, 244, 245, and 246 in TEST:
- ✅ Migration 027: Schema foundation (feed_id columns, new tables, indexes)
- ✅ Migration 028: Metric tracking RPCs
- ✅ Migration 029: Monitoring views (health, activity, cost)
- ✅ Compliance rules seeded (5 feeds)

**Current Status:**
- All 4 tickets moved to "Ready for Prod"
- Production deployment guide created
- Fixed migration files available (`temp_*.sql`)

**What's NOT done yet:**
- TTRC-247: Post-deployment verification
- Production deployment (waiting for verification)

---

## Your Tasks for This Session

### 1. Run TTRC-247 Verification Script

**File:** `docs/rss-deployment/RSS v2/07_post_deployment_verification.sql`

**What it does:**
- 50+ verification queries
- Confirms all migrations applied correctly
- Checks data integrity
- Tests monitoring views
- Validates health status calculations

**Expected Results:**
- Schema checks: All ✓
- Backfill coverage: ~94-95% (356/377 articles)
- All active feeds have compliance rules
- Health dashboard queries work
- No critical issues

**Watch for:**
- 🛑 **CRITICAL:** Blocking index exists, missing grants, over budget
- ⚠️ **WARNING:** Low coverage (<85%), integration test failures
- ✅ **OK:** Legacy debt (old jobs without feed_id), unmapped test articles

### 2. Document Results

**Update JIRA TTRC-247:**
- Add comment with verification results
- Move to "Ready for Prod" if all checks pass
- Flag any issues for Josh to review

### 3. Update Handoff

**Add section to:** `docs/handoffs/2025-10-28-migrations-028-029-complete.md`

Include:
- Verification results summary
- Any warnings encountered
- Recommendations for PROD deployment

---

## Important Context

### Test Data vs Real Data

**Unmapped articles (21 total) are expected:**
- 13 from `test.local` domains
- 3 from `example.com` domains
- 2 from `politico.eu` (subdomain mismatch)
- 1 each from foxnews.com, nypost.com, test.com

**This is OK** - these are test/example URLs, not real RSS feed data.

### Health Status Explained

**CRITICAL** = failure_count > 10 OR error_rate > 50%
**DEGRADED** = failure_count > 3 OR error_rate > 10%
**INACTIVE** = No articles or fetches in 24h
**HEALTHY** = Everything else

**Currently in TEST:**
- Feeds 1-2 (Reuters, AP): CRITICAL (high failure_count from past errors)
- Feeds 3-5 (NYT, WaPo, Politico): HEALTHY or INACTIVE

This is expected - the failure counts are from before we added monitoring.

### Bug Fixes Already Applied

**Original migration files have bugs - DO NOT USE:**
- `04_migration_028_rpcs.sql` - JSON syntax error
- `05_migration_029_views.sql` - Wrong column name
- `06_seed_compliance_rules.sql` - References deleted Feed ID 6

**Use fixed versions for PROD:**
- `temp_migration_028.sql` ✅
- `temp_migration_029.sql` ✅
- `temp_seed_compliance_rules.sql` ✅

---

## Files You'll Need

**Verification Script:**
- `docs/rss-deployment/RSS v2/07_post_deployment_verification.sql`

**Reference Documentation:**
- `docs/handoffs/2025-10-28-migrations-028-029-complete.md` (what we did)
- `docs/rss-deployment/RSS v2/PROD_DEPLOYMENT_028_029.md` (PROD guide)

**JIRA:**
- TTRC-247: Post-Deployment Verification (To Do → In Progress → Ready for Prod)

---

## Success Criteria

At the end of this session:
- [ ] TTRC-247 verification script executed
- [ ] All critical checks passed (no 🛑 issues)
- [ ] Results documented in JIRA
- [ ] TTRC-247 moved to "Ready for Prod"
- [ ] Handoff document updated
- [ ] Ready to proceed with PROD deployment OR flagged issues for Josh

---

## If Issues Are Found

**Minor Issues (warnings):**
- Document them
- Assess if they block PROD deployment
- Ask Josh for guidance

**Critical Issues:**
- STOP immediately
- Do NOT mark "Ready for Prod"
- Review rollback procedures: `docs/rss-deployment/RSS v2/08_rollback_procedures.sql`
- Escalate to Josh with details

---

## After This Session

**If verification passes:**
1. All tickets (242-247) will be "Ready for Prod"
2. Josh can deploy to PROD using `PROD_DEPLOYMENT_028_029.md`
3. Monitor PROD for 48-72 hours
4. Then proceed to Phase 2 (see `NEXT_SESSION_PHASE2_PLANNING.md`)

**If issues found:**
1. Fix issues in TEST first
2. Re-run verification
3. Only proceed to PROD when TEST is stable

---

## Quick Start Commands

```bash
# 1. Check you're in TEST
# Run in Supabase SQL Editor:
SELECT current_database() as database_name;

# 2. Run verification script
# Copy entire file: docs/rss-deployment/RSS v2/07_post_deployment_verification.sql
# Paste in SQL Editor → Run

# 3. Review output for ✓ and 🛑 marks

# 4. Update JIRA TTRC-247 with results
```

---

**Environment:** TEST  
**Risk Level:** LOW (read-only verification queries)  
**Estimated Time:** 20-30 minutes  
**Next Session:** Phase 2 Planning (creating JIRA cards for feed expansion)

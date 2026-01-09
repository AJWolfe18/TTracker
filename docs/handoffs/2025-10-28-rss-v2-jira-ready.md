# RSS v2 Phase 1 - Ready for Execution

**Date:** 2025-10-28
**Session Type:** JIRA setup complete, ready for TEST deployment
**Status:** ✅ All tickets created, documentation reviewed
**Next Action:** Execute migrations in TEST environment

---

## WHAT WE DID THIS SESSION

### ✅ JIRA Tickets Created

**Epic: TTRC-241** - RSS Feed Infrastructure & Expansion
- 🔗 https://ajwolfe37.atlassian.net/browse/TTRC-241

**Phase 1 Stories (6 total, 7.5 points):**
1. **TTRC-242** - Apply Schema Foundation (Migration 027) - P0, 2pts
2. **TTRC-243** - Backfill Article→Feed Mappings - P0, 1pt ⚠️ **CRITICAL MANUAL REVIEW**
3. **TTRC-244** - Metrics RPCs & Enqueue Overload (Migration 028) - P0, 1pt
4. **TTRC-245** - Monitoring Views with Health Status (Migration 029) - P0, 2pts
5. **TTRC-246** - Seed Compliance Rules - P1, 0.5pts
6. **TTRC-247** - Post-Deployment Verification - P0, 1pt

### ✅ Documentation Reviewed

- Read and validated all 16 files in `docs/rss-deployment/RSS v2/`
- Confirmed execution plan is sound
- Verified risk mitigation strategies
- Validated cost projections (+$1.31/month)

---

## FOR NEXT CLAUDE SESSION: START HERE

### CRITICAL: Read These First (5 minutes)

1. **This handoff** (you're reading it now)
2. **Execution Guide:** `docs/rss-deployment/RSS v2/00_START_HERE_EXECUTION_GUIDE.md`
3. **Pre-Flight Checklist:** `docs/rss-deployment/RSS v2/01_PRE_FLIGHT_CHECKLIST.md`

### Execution Checklist (30 minutes)

**Phase 1: Pre-Flight Validation (5 min)**
- [ ] Confirm TEST environment (NOT PROD)
- [ ] Check article count (~377)
- [ ] Check feed count (6 feeds)
- [ ] Verify feed_id columns do NOT exist yet
- [ ] Clean old jobs if >1000 completed

**Phase 2: Execute Migrations (15 min)**
- [ ] **TTRC-242**: Run Migration 027 (schema foundation)
  - [ ] Verify all NOTICE messages show ✓
  - [ ] Check feed_id columns created
  - [ ] Confirm blocking index dropped

- [ ] **TTRC-243**: Backfill article→feed mappings
  - [ ] STEP 1: Generate mappings in staging table
  - [ ] **STEP 2: MANUAL REVIEW** (DO NOT SKIP!)
    - [ ] Verify ~95% coverage (359/377 articles)
    - [ ] Check multi-mapping query = 0 rows
    - [ ] Review sample mappings
  - [ ] STEP 3: Apply UPDATE (only after review passes)

- [ ] **TTRC-244**: Run Migration 028 (RPCs)
  - [ ] Verify smoke tests pass (look for ✓ marks)
  - [ ] Check both RPC signatures exist (3-arg + 5-arg)

- [ ] **TTRC-245**: Run Migration 029 (views)
  - [ ] Verify 3 views created in admin schema
  - [ ] Check grants for authenticated role
  - [ ] Verify health_status and suggested_interval fields exist

- [ ] **TTRC-246**: Seed compliance rules
  - [ ] Verify 6 rows inserted
  - [ ] Check feeds 1-5 have max_chars=1200
  - [ ] Check feed 6 allows full text

**Phase 3: Comprehensive Verification (10 min)**
- [ ] **TTRC-247**: Run 07_post_deployment_verification.sql
  - [ ] Review all 7 sections
  - [ ] Confirm all ✓ success indicators
  - [ ] Investigate any ⚠️ warnings
  - [ ] **STOP if any 🛑 critical issues**

**Phase 4: JIRA Updates (5 min)**
- [ ] Move TTRC-242 → Done
- [ ] Move TTRC-243 → Done
- [ ] Move TTRC-244 → Done
- [ ] Move TTRC-245 → Done
- [ ] Move TTRC-246 → Done
- [ ] Move TTRC-247 → Done
- [ ] Add comment to TTRC-241 with deployment summary

---

## CRITICAL REMINDERS

### ⚠️ DO NOT SKIP: Backfill Manual Review (TTRC-243)

**STEP 2 is MANDATORY:**
```sql
-- Query A: Summary by feed (expected: NYT ~150, WaPo ~112, Politico ~93)
-- Query B: Unmapped articles (expected: ~18)
-- Query C: CRITICAL - Multi-mapping check (MUST BE ZERO)
-- Query D: Sample mappings (verify correct)
-- Query E: Coverage analysis (expected: ~95%)
```

**If multi-mapping query returns ANY rows:** STOP and investigate before STEP 3.

### ⚠️ Environment Confirmation

Run this FIRST:
```sql
SELECT current_database() as database_name;
```
**If this shows PROD:** STOP IMMEDIATELY. Do not proceed.

### ⚠️ Smoke Tests Must Pass

Migration 028 includes built-in smoke tests. Look for:
```
NOTICE:  ✓ Job created with feed_id=6
NOTICE:  ✓ Legacy job created with feed_id=NULL (backward compat OK)
NOTICE:  ✓ Test jobs cleaned up
```

**If no ✓ marks:** Migration failed, do not proceed.

---

## SUCCESS CRITERIA

### Green Light Indicators
- ✅ All migrations completed with NOTICE messages
- ✅ Backfill coverage ~95% (359/377 articles)
- ✅ Smoke tests passed
- ✅ All 3 views created with correct fields
- ✅ 6 compliance rules seeded
- ✅ Verification script shows all ✓
- ✅ No critical issues found

### Red Light Indicators (STOP)
- ❌ In PROD environment
- ❌ Multi-mapping query returns rows
- ❌ Smoke tests fail
- ❌ Views missing health_status or suggested_interval
- ❌ Verification script shows 🛑 critical issues

---

## IF SOMETHING GOES WRONG

### Partial Failure
1. **STOP immediately** - Do not continue with later migrations
2. Check error message carefully
3. Review `docs/rss-deployment/RSS v2/15_troubleshooting_faq.md`
4. If needed: Run `docs/rss-deployment/RSS v2/08_rollback_procedures.sql`

### Backfill Coverage Too Low (<85%)
1. Review unmapped domains in STEP 2
2. Check if subdomain stripping working correctly
3. May need manual mappings for edge cases
4. Document findings and consult with Josh

### View Queries Return Errors
1. Check all views created successfully
2. Verify grants applied to authenticated role
3. Check for missing columns (health_status, suggested_interval)
4. Review view definitions for syntax errors

---

## POST-DEPLOYMENT (After Success)

### Update JIRA
- Move all 6 stories to Done
- Add comment to TTRC-241 epic with summary:
  - Articles mapped: X/377 (X%)
  - All migrations completed successfully
  - Verification passed
  - Ready for Phase 2

### Create Session Handoff
Document in `docs/handoffs/YYYY-MM-DD-rss-v2-phase1-complete.md`:
- What was deployed
- Any issues encountered
- Backfill coverage stats
- Next steps (Phase 2)

### Monitoring (Next 24 Hours)
Use `docs/rss-deployment/RSS v2/09_operations_runbook.md`:
```sql
-- Morning check: Feed health
SELECT feed_name, health_status, articles_24h, error_rate_24h
FROM admin.feed_health_overview
WHERE health_status != 'HEALTHY';

-- Cost check
SELECT SUM(projected_cost_month_usd) as total_monthly_projection
FROM admin.feed_cost_attribution;
```

---

## PHASE 2 (NOT FOR THIS SESSION)

**Deferred until after 48h Phase 1 stability:**
- Edge Function updates (Deno worker)
- Alert configuration (IFTTT/Slack)
- Feed expansion (add 2 new feeds)

**Do not start Phase 2 until Phase 1 validated.**

---

## FILE LOCATIONS

**SQL Migrations (in order):**
1. `docs/rss-deployment/RSS v2/02_MIGRATION_027_SCHEMA.sql`
2. `docs/rss-deployment/RSS v2/03_backfill_articles_feed_id.sql`
3. `docs/rss-deployment/RSS v2/04_migration_028_rpcs.sql`
4. `docs/rss-deployment/RSS v2/05_migration_029_views.sql`
5. `docs/rss-deployment/RSS v2/06_seed_compliance_rules.sql`
6. `docs/rss-deployment/RSS v2/07_post_deployment_verification.sql`

**Reference Docs:**
- Pre-flight: `docs/rss-deployment/RSS v2/01_PRE_FLIGHT_CHECKLIST.md`
- Execution guide: `docs/rss-deployment/RSS v2/00_START_HERE_EXECUTION_GUIDE.md`
- Rollback: `docs/rss-deployment/RSS v2/08_rollback_procedures.sql`
- Operations: `docs/rss-deployment/RSS v2/09_operations_runbook.md`
- Troubleshooting: `docs/rss-deployment/RSS v2/15_troubleshooting_faq.md`

---

## QUESTIONS TO ASK JOSH

Before starting, confirm:
1. Are we deploying to TEST environment? (should be YES)
2. Should Test Feed (ID 6) be kept or deleted?
3. Any concerns about the 30-minute deployment window?

---

**Session completed:** 2025-10-28
**JIRA tickets ready:** TTRC-241 (epic) + 6 stories
**Estimated execution time:** 30 minutes
**Risk level:** Medium (schema changes, but idempotent/reversible)
**Cost impact:** +$1.31/month

**Status:** 🟢 **READY FOR EXECUTION**

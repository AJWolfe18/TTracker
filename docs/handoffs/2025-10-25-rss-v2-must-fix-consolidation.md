# RSS v2 Must-Fix Consolidation & Documentation Cleanup

**Date:** 2025-10-25
**Session Type:** Documentation consolidation + must-fix implementation
**Status:** ✅ Complete - Ready for execution in TEST
**Epic:** TTRC-180 RSS Feed Infrastructure & Expansion

---

## WHAT WE DID

### 1. Documentation Consolidation (Deleted 6 Duplicates)

**Problem:** RSS v2 folder had duplicate files with inconsistent content.

**Actions:**
- ❌ Deleted `00_README.md` (kept: `00_EXECUTIVE_SUMMARY.md` - more comprehensive)
- ❌ Deleted `01_pre_flight_checks.sql` (kept: `01_PRE_FLIGHT_CHECKLIST.md` - better structured)
- ❌ Deleted `02_migration_027_schema_foundation.sql` (kept: `02_MIGRATION_027_SCHEMA.sql` - better verification)
- ❌ Deleted `03_BACKFILL_SCRIPT.sql` (kept: `03_backfill_articles_feed_id.sql` - more comprehensive)
- ❌ Deleted `06_COMPLIANCE_SEED.sql` (kept: `06_seed_compliance_rules.sql` - better documentation)
- ❌ Deleted `New Text Document.txt` (session notes incorporated)

**Result:** Clean, single-source-of-truth documentation set (16 files)

---

### 2. Must-Fix Items Implementation

All feedback items from previous chat were addressed:

#### ✅ RPC Coverage (Migration 028)
**What:** Added comprehensive smoke tests for both enqueue_fetch_job signatures
**Changes:**
- Verified 5-arg signature: `enqueue_fetch_job(p_feed_id, p_job_type, p_payload, p_run_at, p_payload_hash)`
- Verified 3-arg legacy: `enqueue_fetch_job(p_type, p_payload, p_hash)`
- Auto-cleanup of test jobs
- Detailed RAISE NOTICE output for verification

**File:** `04_migration_028_rpcs.sql` (lines 102-166)

#### ✅ Monitoring Views - health_status (Migration 029)
**What:** Added missing health_status field to feed_health_overview
**Logic:**
- `CRITICAL`: failure_count > 10 OR error_rate > 50%
- `DEGRADED`: failure_count > 3 OR error_rate > 10%
- `INACTIVE`: no articles and no fetches in 24h
- `HEALTHY`: everything else

**File:** `05_migration_029_views.sql` (lines 41-52)

#### ✅ Monitoring Views - suggested_interval (Migration 029)
**What:** Added adaptive polling interval logic to feed_activity_hints
**Fields Added:**
- `suggested_interval_seconds` (integer: 1800-21600)
- `suggested_interval_human` (text: "30 minutes" to "6 hours")

**Logic:**
- Failed feeds: Exponential backoff (30m → 1h → 2h → 4h cap)
- High 304 rate (>80%): 4 hours (feed not changing)
- High activity (>10 articles/day): 1 hour (hot feed)
- Low activity (0 articles/day): 6 hours (cold feed)
- Normal: 2 hours (default)

**File:** `05_migration_029_views.sql` (lines 93-124)

#### ✅ Missing View - feed_cost_attribution
**What:** Created cost attribution view (was referenced in verification but didn't exist)
**Columns:**
- `feed_id`, `feed_name`, `articles_24h`, `fetches_24h`
- `total_cost_24h_usd` (calculated: articles × $0.00035)
- `projected_cost_month_usd` (24h cost × 30)

**File:** `05_migration_029_views.sql` (lines 131-153)

#### ✅ Runtime Clarity - Deno Architecture
**What:** Added critical runtime warnings to migration 027
**Content:**
- Worker = Deno (Supabase Edge Functions) - NOT Node.js
- Avoid Node-only dependencies (fs, child_process, etc.)
- Handler must call metrics RPCs (record_feed_success, etc.)
- Use p_run_at parameter for scheduled polling

**File:** `02_MIGRATION_027_SCHEMA.sql` (lines 12-18)

#### ✅ Cost Model Constants - Centralized
**What:** Added "Cost Model Constants" section to executive summary
**Content:**
- OpenAI embeddings: $0.0002/article
- Story clustering: $0.00015/article
- Story enrichment: $0.000167/story
- Total: $0.00035/article
- Referenced in SQL views and future enhancements

**File:** `00_EXECUTIVE_SUMMARY.md` (lines 160-182)

#### ✅ Pre-Flight Additions - Enhanced Verification
**What:** Added post-migration verification checks
**New Checks:**
- Section 16: Verify both enqueue_fetch_job signatures (3-arg + 5-arg)
- Section 17: Verify view grants for authenticated role
- Section 18: Verify health_status and suggested_interval fields exist

**File:** `01_PRE_FLIGHT_CHECKLIST.md` (lines 279-349)

#### ✅ Nice-to-Haves Documentation
**What:** Created comprehensive future enhancements document
**Content:**
- Exponential backoff (partially in views, scheduler needs update)
- Per-feed daily fetch caps
- Slack webhook alerts (replace IFTTT)
- Cost model configuration knobs
- Feed health dashboards (UI)
- Intelligent feed discovery
- Priority order and effort estimates

**File:** `16_FUTURE_ENHANCEMENTS.md` (NEW - 344 lines)

---

## WHAT'S ALREADY CORRECT (No Changes Needed)

✅ **Job queue dedupe policy** - Blocking index already dropped in migration 027 (line 45)
✅ **FK columns** - Both feed_id columns exist with ON DELETE SET NULL (lines 57, 67)
✅ **Backfill mapping** - Already uses comprehensive subdomain stripping (www., rss., feeds., m., amp.)
✅ **Backward compatibility** - 3-arg RPC wrapper delegates to 5-arg version (line 99)

---

## CURRENT STATE

### File Structure (16 Files)

**Core Execution (in order):**
1. `00_EXECUTIVE_SUMMARY.md` - Overview + cost model constants
2. `01_PRE_FLIGHT_CHECKLIST.md` - Pre-deployment + post-migration checks
3. `02_MIGRATION_027_SCHEMA.sql` - Schema foundation + Deno runtime notes
4. `03_backfill_articles_feed_id.sql` - Article→feed mapping
5. `04_migration_028_rpcs.sql` - Metrics RPCs + smoke tests
6. `05_migration_029_views.sql` - 3 views (health + activity + cost) with all fields
7. `06_seed_compliance_rules.sql` - Per-feed content limits
8. `07_post_deployment_verification.sql` - Comprehensive validation
9. `08_rollback_procedures.sql` - Emergency rollback

**Reference/Operations:**
10. `09_operations_runbook.md` - Daily operations
11. `10_updated_jira_cards.md` - Epic structure
12. `11_edge_function_handler_deno.ts` - Deno handler code
13. `12_rpc_api_reference.md` - RPC docs
14. `13_local_dev_setup.md` - Dev environment
15. `14_alerts_email_ifttt.md` - Alert config
16. `15_troubleshooting_faq.md` - Common issues
17. `16_FUTURE_ENHANCEMENTS.md` - Nice-to-haves (deferred)

---

## KEY DECISIONS MADE

1. **Exponential backoff:** Logic implemented in views, but scheduler doesn't use it yet (deferred to Phase 2)
2. **Cost constants:** Centralized in docs, NOT in database table (keeps it simple for now)
3. **Smoke tests:** Added to migrations (run automatically during deployment)
4. **View grants:** Explicitly granted to authenticated role (required for Edge Functions)
5. **Health status:** 4 levels (HEALTHY/DEGRADED/CRITICAL/INACTIVE) based on error rate + failure count
6. **Polling intervals:** Adaptive (30m-6h) based on activity level and error rate

---

## GOTCHAS / WARNINGS

⚠️ **Backfill STEP 2 is MANDATORY** - Must review staging table before applying UPDATE
⚠️ **Smoke tests require Test Feed (ID 6)** - If deleted, update test in migration 028 line 108
⚠️ **Exponential backoff in views only** - Scheduler doesn't use suggested_interval_seconds yet
⚠️ **Cost model is per-article** - Story enrichment cost allocated proportionally ($0.000167/story ≈ $0.000017/article)
⚠️ **Deno runtime** - Handler code must avoid Node.js dependencies (fs, child_process, etc.)

---

## WHAT'S NEXT

### Immediate (Next Session)
1. **Read:** `00_START_HERE_EXECUTION_GUIDE.md` (step-by-step deployment)
2. **Execute:** All migrations in TEST environment
3. **Verify:** Post-deployment checks pass (health_status, suggested_interval, grants)
4. **Monitor:** 24 hours using `09_operations_runbook.md`

### Phase 2 (After 24h Stability)
1. Add 2 new feeds (Christian Science Monitor, Time)
2. Monitor for 48 hours
3. Validate clustering quality maintained
4. Check cost stays within budget

### Phase 3 (After 1 Week)
1. Add 3-5 feeds per week
2. Target: 15 total feeds
3. Final validation at scale

### Phase 4 (Deferred - See 16_FUTURE_ENHANCEMENTS.md)
1. Update scheduler to use suggested_interval_seconds
2. Implement per-feed daily fetch caps
3. Add Slack webhook alerts
4. Consider cost model configuration table

---

## VALIDATION CHECKLIST

Before executing migrations, confirm:

- [ ] All must-fix items addressed (✅ all complete)
- [ ] No duplicate files remain (✅ cleaned up)
- [ ] health_status field in feed_health_overview (✅ added)
- [ ] suggested_interval fields in feed_activity_hints (✅ added)
- [ ] admin.feed_cost_attribution view exists (✅ added)
- [ ] Smoke tests in migration 028 (✅ added)
- [ ] Runtime clarity in migration 027 (✅ added)
- [ ] Cost constants centralized (✅ added)
- [ ] Pre-flight checks enhanced (✅ added)
- [ ] Nice-to-haves documented (✅ 16_FUTURE_ENHANCEMENTS.md)

---

## NOTES FOR NEXT CLAUDE SESSION

**Context to load:**
1. This handoff document (context on what was done)
2. `00_START_HERE_EXECUTION_GUIDE.md` (step-by-step instructions)
3. `00_EXECUTIVE_SUMMARY.md` (business context)

**Don't need to read:**
- Individual migration files (execution guide references them)
- Future enhancements (deferred until after stabilization)
- Troubleshooting FAQ (only if issues arise)

**Critical actions:**
1. Confirm TEST environment (not PROD)
2. Review backfill staging table (STEP 2 - DO NOT SKIP)
3. Verify smoke tests pass (check for ✅ in migration 028 output)
4. Check all post-migration verification queries (section 16-18 in pre-flight)

---

## JIRA UPDATES NEEDED

**TTRC-180 (RSS Feed Infrastructure):**
- ✅ Documentation consolidated (6 duplicates removed)
- ✅ All must-fix items complete
- ✅ Monitoring views enhanced (health_status + suggested_interval)
- ✅ Cost model centralized
- ✅ Runtime architecture documented
- ⏳ Ready for TEST deployment (next session)

**Subtasks to create (optional):**
- Execute migrations in TEST
- Monitor for 24 hours
- Add Phase 2 feeds (2 new sources)
- Implement Phase 4 enhancements (future)

---

**Session completed:** 2025-10-25
**Total changes:** 6 files deleted, 7 files enhanced, 1 file created
**Status:** Production-ready for TEST deployment
**Next action:** Execute migrations following 00_START_HERE_EXECUTION_GUIDE.md

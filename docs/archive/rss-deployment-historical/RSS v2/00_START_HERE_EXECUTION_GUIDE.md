# 🚀 START HERE: RSS v2 Deployment Execution Guide

**Target:** Deploy RSS v2 feed tracking infrastructure in TEST environment
**Estimated Time:** 30 minutes (including reviews)
**Prerequisites:** Supabase SQL Editor access (TEST project)

---

## 📖 FOR NEXT CLAUDE SESSION: READ THIS FIRST

This guide provides **step-by-step copy-paste commands** to deploy RSS v2.

**Before executing anything:**
1. ✅ Read handoff: `/docs/handoffs/2025-10-25-rss-v2-must-fix-consolidation.md`
2. ✅ Read overview: `00_EXECUTIVE_SUMMARY.md` (optional but helpful)
3. ✅ Confirm you're in **TEST environment** (NOT PROD)

**What this deployment does:**
- Adds feed-level tracking (metrics, health, errors)
- Creates monitoring views with health_status and suggested_interval
- Enables cost attribution per feed
- Maintains full backward compatibility

**Risk level:** ⚠️ MEDIUM (schema changes, but idempotent and reversible)

---

## ✅ EXECUTION CHECKLIST

### PHASE 1: Pre-Flight Validation (5 minutes)

Open Supabase SQL Editor (TEST) and run these checks:

#### 1.1 Confirm TEST Environment
```sql
SELECT current_database() as database_name, NOW() as timestamp;
```
**Expected:** Database name should contain "test" or TEST project ID
**⚠️ STOP if PROD**

#### 1.2 Check Current State
```sql
-- Articles count (should be ~377)
SELECT COUNT(*) as total_articles FROM public.articles;

-- Feeds count (should be 6)
SELECT COUNT(*) as total_feeds FROM public.feed_registry WHERE is_active = true;

-- Verify feed_id doesn't exist yet (should return FALSE)
SELECT EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'articles' AND column_name = 'feed_id'
) as feed_id_exists;
```
**Expected:** ~377 articles, 6 feeds, feed_id_exists = FALSE
**⚠️ If feed_id_exists = TRUE:** Migration 027 already applied - check with Josh

#### 1.3 Clean Old Jobs (Optional but Recommended)
```sql
-- Check completed jobs count
SELECT COUNT(*) FROM public.job_queue WHERE processed_at IS NOT NULL;

-- Clean up if >1000 old jobs
DELETE FROM public.job_queue
WHERE processed_at IS NOT NULL
  AND completed_at < NOW() - INTERVAL '7 days';
```

**Decision Point:**
- [ ] Confirmed TEST environment ✅
- [ ] Article/feed counts look correct ✅
- [ ] feed_id does NOT exist yet ✅
- [ ] Old jobs cleaned (optional)

**GO / NO-GO:** ✅ Proceed to Phase 2

---

### PHASE 2: Execute Migrations (10 minutes)

Copy entire SQL files and paste into Supabase SQL Editor, then run.

#### 2.1 Migration 027 - Schema Foundation
**File:** `02_MIGRATION_027_SCHEMA.sql`
**Action:** Copy entire file → Paste in SQL Editor → Click "Run"

**Expected Output:**
```
NOTICE:  Applying Migration 027 in database: [your-test-db]
NOTICE:  Timestamp: [current timestamp]
NOTICE:  ✓ Added articles.feed_id column
NOTICE:  ✓ Added job_queue.feed_id column
NOTICE:  ✓ Dropped conflicting full-table index (if existed)
NOTICE:  ✓ Added articles.feed_id foreign key (ON DELETE SET NULL)
NOTICE:  ✓ Added job_queue.feed_id foreign key (ON DELETE SET NULL)
NOTICE:  ✓ Added tracking columns to feed_registry
NOTICE:  ✓ Created feed_metrics table
NOTICE:  ✓ Created feed_errors table
NOTICE:  ✓ Created feed_compliance_rules table
NOTICE:  ✓ Created basic lookup indexes
NOTICE:  ✓ Created hot path index for worker queries
NOTICE:  ✓ Created legacy debt tracking index
NOTICE:  ✓ Created error log indexes
NOTICE:  ✓ Created payload→column sync trigger
NOTICE:
NOTICE:  ==========================================
NOTICE:  ✅ Migration 027 completed successfully!
NOTICE:  ==========================================
```

**Verification:**
```sql
-- Should return TRUE for both
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'articles' AND column_name = 'feed_id') as articles_feed_id,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'job_queue' AND column_name = 'feed_id') as job_queue_feed_id;
```

**⚠️ STOP if errors or if verification returns FALSE**

---

#### 2.2 Backfill - Map Articles to Feeds

**File:** `03_backfill_articles_feed_id.sql`

**⚠️ CRITICAL: This has 3 steps. Do NOT run entire file at once!**

**STEP 1: Generate Mappings**
Copy lines 13-60 (create staging table + generate mappings) → Run

**Expected Output:**
```
INSERT 0 359
```
(About 359 articles mapped)

**STEP 2: REVIEW RESULTS (DO NOT SKIP THIS)**
Copy lines 63-162 (all review queries) → Run

**Review checklist:**
```sql
-- Query A: Summary by feed
-- Expected: NYT ~150, WaPo ~112, Politico ~93, Reuters ~1

-- Query B: Unmapped articles
-- Expected: ~18 unmapped (test/example URLs)

-- Query C: CRITICAL - Multi-mapping check
-- Expected: 0 rows (MUST BE ZERO)

-- Query D: Sample mappings
-- Expected: Correct domain matches (nytimes.com → NYT feed)

-- Query E: Coverage analysis
-- Expected: ~95% coverage (359/377 articles)
```

**⚠️ DECISION POINT:**
- [ ] Multi-mapping query returns ZERO rows ✅
- [ ] Coverage ~95% ✅
- [ ] Sample mappings look correct ✅

**If ANY issues:** Stop and consult with Josh before proceeding

**STEP 3: Apply Backfill (Only After Review)**
Copy lines 186-202 (apply UPDATE) → Run

**Expected Output:**
```
UPDATE 359
```

**Verification:**
```sql
SELECT
  CASE WHEN feed_id IS NOT NULL THEN 'Mapped' ELSE 'Unmapped' END as status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM public.articles
GROUP BY 1;
```

**Expected:**
```
Mapped    | 359 | 95.2%
Unmapped  |  18 |  4.8%
```

---

#### 2.3 Migration 028 - Metrics RPCs + Smoke Tests
**File:** `04_migration_028_rpcs.sql`
**Action:** Copy entire file → Paste → Run

**Expected Output:**
```
NOTICE:
NOTICE:  === Smoke Testing RPC Signatures ===
NOTICE:  Test 1: New 5-arg enqueue_fetch_job signature...
NOTICE:    ✓ Job created with feed_id=6
NOTICE:  Test 2: Legacy 3-arg enqueue_fetch_job signature...
NOTICE:    ✓ Legacy job created with feed_id=NULL (backward compat OK)
NOTICE:    ✓ Test jobs cleaned up
NOTICE:
NOTICE:  === All Smoke Tests Passed ===
NOTICE:
NOTICE:  ✅ Migration 028 completed successfully!
NOTICE:  Next: Migration 029 (views)
```

**⚠️ STOP if smoke tests fail (no ✓ marks)**

**Post-Migration Verification:**
```sql
-- Check both RPC signatures exist (should return 2 rows)
SELECT
  routine_name,
  pg_get_function_arguments(p.oid) as arguments
FROM information_schema.routines r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE routine_schema = 'public'
  AND routine_name = 'enqueue_fetch_job'
ORDER BY pg_get_function_arguments(p.oid);
```

**Expected:** 2 rows (3-arg legacy + 5-arg new)

---

#### 2.4 Migration 029 - Monitoring Views
**File:** `05_migration_029_views.sql`
**Action:** Copy entire file → Paste → Run

**Expected Output:**
```
NOTICE:  ✅ Migration 029 completed!
NOTICE:  Next: Seed compliance rules
```

**Post-Migration Verification:**
```sql
-- Check view grants (should return 3 rows)
SELECT
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'authenticated'
  AND table_schema = 'admin'
  AND table_name IN ('feed_health_overview', 'feed_activity_hints', 'feed_cost_attribution')
ORDER BY table_name;
```

**Expected:** 3 rows (all with SELECT privilege)

```sql
-- Check critical fields exist (should return 4 rows)
SELECT
  'feed_health_overview' as view_name,
  column_name
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'feed_health_overview'
  AND column_name IN ('health_status', 'error_rate_24h')
UNION ALL
SELECT
  'feed_activity_hints',
  column_name
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'feed_activity_hints'
  AND column_name IN ('suggested_interval_seconds', 'suggested_interval_human')
ORDER BY view_name, column_name;
```

**Expected:** 4 rows confirming all fields exist

---

#### 2.5 Seed Compliance Rules
**File:** `06_seed_compliance_rules.sql`
**Action:** Copy entire file → Paste → Run

**Expected Output:**
```
INSERT 0 6
[Table showing compliance rules for all 6 feeds]

NOTICE:  ✅ Compliance rules seeded!
NOTICE:  Migrations complete. Run verification scripts next.
```

---

### PHASE 3: Comprehensive Verification (10 minutes)

**File:** `07_post_deployment_verification.sql`
**Action:** Copy entire file → Paste → Run

This runs 50+ verification queries. Review output for:

**✅ Success Indicators:**
- All schema checks show ✓
- All table/index counts match expected
- Backfill coverage ~95%
- All feeds have compliance rules
- Health dashboard queries return data without errors
- Integration tests pass

**⚠️ Warning Indicators (acceptable):**
- Legacy debt (jobs without feed_id from before migration)
- Unmapped articles (~18, test/example data)
- Degraded health (if feeds recently errored)

**🛑 Critical Issues (STOP):**
- Blocking index still exists
- Active feeds missing compliance rules
- Health status = CRITICAL
- Over budget projection
- Integration tests fail

**If any critical issues:** Check `08_rollback_procedures.sql` for emergency rollback

---

### PHASE 4: Final Checks & Handoff (5 minutes)

#### 4.1 Query Monitoring Views
```sql
-- Health overview (should show all 6 feeds as HEALTHY or INACTIVE)
SELECT * FROM admin.feed_health_overview ORDER BY feed_id;

-- Activity hints (should show suggested intervals)
SELECT
  feed_name,
  articles_24h,
  suggested_interval_human
FROM admin.feed_activity_hints
ORDER BY feed_id;

-- Cost attribution (should show low costs)
SELECT
  feed_name,
  articles_24h,
  projected_cost_month_usd
FROM admin.feed_cost_attribution
ORDER BY projected_cost_month_usd DESC;
```

**Expected:**
- Health: Mostly HEALTHY or INACTIVE
- Intervals: 2-6 hours suggested
- Costs: Well under $50/month

#### 4.2 Test Both RPC Signatures
```sql
-- Test new 5-arg signature
SELECT public.enqueue_fetch_job(
  p_feed_id := 6,
  p_job_type := 'manual_test',
  p_payload := '{"test": "manual"}'::jsonb,
  p_run_at := NOW() + INTERVAL '10 minutes'
) as job_id;

-- Check job created
SELECT id, feed_id, job_type, run_at
FROM job_queue
WHERE job_type = 'manual_test'
ORDER BY id DESC
LIMIT 1;

-- Cleanup
DELETE FROM job_queue WHERE job_type = 'manual_test';
```

**Expected:** Job created with feed_id=6, scheduled 10 minutes in future

---

## ✅ DEPLOYMENT COMPLETE CHECKLIST

After all phases complete, confirm:

- [ ] Migration 027 applied (feed_id columns exist)
- [ ] Backfill reviewed and applied (~95% coverage)
- [ ] Migration 028 smoke tests passed
- [ ] Migration 029 views created with all fields
- [ ] Compliance rules seeded (6 feeds)
- [ ] Post-deployment verification passed
- [ ] health_status field exists and returns values
- [ ] suggested_interval fields exist and return values
- [ ] View grants confirmed for authenticated role
- [ ] Both RPC signatures tested manually
- [ ] Cost projection well under $50/month

**Status:** 🟢 **DEPLOYMENT SUCCESSFUL**

---

## 📊 MONITORING (Next 24 Hours)

**Use:** `09_operations_runbook.md`

**Daily checks:**
```sql
-- Morning check: Feed health
SELECT feed_name, health_status, articles_24h, error_rate_24h
FROM admin.feed_health_overview
WHERE health_status != 'HEALTHY'
ORDER BY health_status DESC;

-- Afternoon check: Cost tracking
SELECT SUM(projected_cost_month_usd) as total_monthly_projection
FROM admin.feed_cost_attribution;

-- Evening check: Error log
SELECT feed_id, COUNT(*) as error_count
FROM feed_errors
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY feed_id
HAVING COUNT(*) > 5
ORDER BY error_count DESC;
```

**Alert thresholds:**
- 🚨 CRITICAL: Any feed health_status = 'CRITICAL'
- ⚠️ WARNING: Cost projection >$45/month
- ℹ️ INFO: Error rate >10% for any feed

---

## 🆘 IF SOMETHING GOES WRONG

### Partial Failure (Some Migration Failed)
1. **Stop immediately** - Do not continue with later migrations
2. Check error message carefully
3. Check `15_troubleshooting_faq.md` for known issues
4. If needed: Run `08_rollback_procedures.sql` (emergency only)

### Backfill Coverage Too Low (<85%)
1. Review unmapped domains in backfill STEP 2
2. Check if subdomain stripping is working correctly
3. May need manual mappings for edge cases
4. Document findings for Josh

### Smoke Tests Fail
1. Check Test Feed (ID 6) still exists
2. Verify both RPC signatures created
3. Check error message in smoke test output
4. May indicate PL/pgSQL syntax error

### View Queries Return Errors
1. Check all views created successfully
2. Verify grants applied to authenticated role
3. Check for missing columns (health_status, suggested_interval)
4. Review view definitions for syntax errors

---

## 🎯 NEXT STEPS (After 24h Monitoring)

1. **Update JIRA TTRC-180:** Mark deployment complete, add monitoring notes
2. **Create operations handoff:** Document any issues encountered
3. **Plan Phase 2:** Select 2 new feeds to add (Christian Science Monitor, Time)
4. **Prepare for Phase 3:** After 48h stability, plan to add 3-5 more feeds

---

## 📚 REFERENCE DOCS

**Must Read:**
- This guide (you're here)
- `00_EXECUTIVE_SUMMARY.md` - Business context
- `/docs/handoffs/2025-10-25-rss-v2-must-fix-consolidation.md` - What changed

**Use As Needed:**
- `09_operations_runbook.md` - Daily operations
- `15_troubleshooting_faq.md` - Common issues
- `08_rollback_procedures.sql` - Emergency rollback
- `16_FUTURE_ENHANCEMENTS.md` - Future improvements

**Don't Need Unless Building:**
- `11_edge_function_handler_deno.ts` - Deno handler code
- `12_rpc_api_reference.md` - RPC technical docs
- `13_local_dev_setup.md` - Dev environment setup
- `14_alerts_email_ifttt.md` - Alert configuration

---

**Last Updated:** 2025-10-25
**Status:** Ready for execution
**Estimated Total Time:** 30 minutes

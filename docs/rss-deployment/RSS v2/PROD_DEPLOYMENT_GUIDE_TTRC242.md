# PROD Deployment Guide - TTRC-242 (Migration 027)

**CRITICAL: Read this entire guide before executing in PROD**

---

## PRE-DEPLOYMENT CHECKLIST

### ✅ Prerequisites
- [ ] TTRC-242 completed successfully in TEST
- [ ] TEST environment stable for 24+ hours
- [ ] All verification queries passed in TEST
- [ ] Backup confirmed in Supabase dashboard
- [ ] Deployment window scheduled (requires ~30 minutes)

### ⚠️ STOP CONDITIONS
If ANY of these are true, DO NOT DEPLOY:
- ❌ TEST environment showing errors
- ❌ Active users on site (wait for low-traffic window)
- ❌ Backup not recent (<24 hours old)
- ❌ Uncertainty about any step

---

## PROD DEPLOYMENT STEPS

### STEP 1: Pre-Flight Validation (5 min)

**1.1 Confirm PROD Environment**
```sql
SELECT current_database() as database_name, NOW() as timestamp;
```
**Expected:** Database name shows PROD project ID
**⚠️ STOP if TEST database**

**1.2 Check Current State**
```sql
-- Articles count (should be ~717 in PROD)
SELECT COUNT(*) as total_articles FROM public.articles;

-- Feeds count (should be 6 in PROD - verify same as TEST)
SELECT COUNT(*) as total_feeds FROM public.feed_registry WHERE is_active = true;

-- Verify feed_id doesn't exist yet (should return FALSE)
SELECT EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'articles' AND column_name = 'feed_id'
) as feed_id_exists;
```
**Expected:** ~717 articles, 6 feeds, feed_id_exists = FALSE
**⚠️ If feed_id_exists = TRUE:** Migration already applied - STOP

**1.3 Check Test Feed Status**
```sql
SELECT id, feed_name, is_active FROM feed_registry ORDER BY id;
```
**Decision:** Keep or delete Test Feed (ID 6)?
- In TEST we deleted it
- Recommend: Delete in PROD too for consistency

**1.4 Clean Old Jobs (Optional)**
```sql
-- Check completed jobs count
SELECT COUNT(*) FROM public.job_queue WHERE processed_at IS NOT NULL;

-- Clean up if >1000 old jobs
DELETE FROM public.job_queue
WHERE processed_at IS NOT NULL
  AND completed_at < NOW() - INTERVAL '7 days';
```

---

### STEP 2: Execute Migration 027 (5 min)

**File:** Use `temp_migration_027_fixed.sql` from TEST deployment

**⚠️ CRITICAL:** This file has syntax fixes from TEST. Do NOT use original file.

**Steps:**
1. Open Supabase Dashboard → SQL Editor (PROD project)
2. Copy entire contents of `temp_migration_027_fixed.sql`
3. Paste into SQL Editor
4. **Double-check you're in PROD**
5. Click "Run"

**Expected Output:**
```
NOTICE:  Applying Migration 027 in database: [prod-database-name]
NOTICE:  ✓ Added feed_id columns
NOTICE:  ✓ Dropped conflicting full-table unique constraint (if existed)
NOTICE:  ✓ Added foreign key constraints
NOTICE:  ✓ Added tracking columns to feed_registry
NOTICE:  ✓ Created feed_metrics, feed_errors, feed_compliance_rules tables
NOTICE:  ✓ Created all indexes
NOTICE:  ✓ Created payload→column sync trigger
NOTICE:  ==========================================
NOTICE:  ✅ Migration 027 completed successfully!
NOTICE:  ==========================================
```

**⚠️ If ANY errors:** STOP - Do not proceed to backfill

---

### STEP 3: Verify Migration (2 min)

```sql
-- Verify new tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('feed_metrics', 'feed_errors', 'feed_compliance_rules');

-- Verify columns added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'feed_registry'
  AND column_name IN ('last_response_time_ms', 'consecutive_successes', 'failure_count');

-- Verify blocking constraint dropped
SELECT COUNT(*) as should_be_zero
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'job_queue'
  AND constraint_name = 'job_queue_type_payload_hash_key';
```

**Expected:**
- 3 tables
- 3 new columns
- 0 for blocking constraint (dropped)

**⚠️ If ANY verification fails:** Contact support, do not proceed

---

### STEP 4: Backfill STEP 1 - Generate Mappings (3 min)

**File:** `temp_backfill_step1.sql` (from TEST)

Copy/paste into SQL Editor → Run

**Expected Output:**
```
CREATE SCHEMA
INSERT 0 [number of articles mapped]
```

**Note:** Number will differ from TEST (TEST had 347, PROD will have more due to 717 articles)

---

### STEP 5: Backfill STEP 2 - CRITICAL REVIEW (5 min) ⚠️

**File:** `temp_backfill_step2_REVIEW.sql` (from TEST)

Copy/paste into SQL Editor → Run

**Review ALL 6 result sets:**

**2A - Summary by feed:** Check article counts look reasonable
**2B - Unmapped count:** Should be small percentage
**2C - Sample unmapped:** Review domains (test data, non-feed sources)
**2D - 🚨 CRITICAL - Multi-mapping check:** **MUST BE ZERO ROWS**
**2E - Sample mappings:** All should show '✓ Match'
**2F - Coverage analysis:** Should show ≥85%, '✅ Ready to proceed'

**⚠️ DECISION POINT:**
- **If Query 2D returns ANY rows:** STOP - Multi-mapping issue
- **If coverage <85%:** Investigate unmapped articles
- **If sample mappings show '🛑 Mismatch':** STOP - Logic error

**✅ PROCEED only if:**
- Query 2D = 0 rows
- Coverage ≥85%
- Sample mappings all '✓ Match'

---

### STEP 6: Backfill STEP 3 - Apply UPDATE (2 min)

**⚠️ ONLY RUN THIS AFTER STEP 5 REVIEW PASSES**

**File:** `temp_backfill_step3_APPLY.sql` (from TEST)

Copy/paste into SQL Editor → Run

**Expected Output:**
```
UPDATE [number of articles]
```

**Post-update verification:**
```sql
SELECT
  (SELECT COUNT(*) FROM articles WHERE feed_id IS NOT NULL) as mapped,
  (SELECT COUNT(*) FROM articles WHERE feed_id IS NULL) as unmapped,
  ROUND(100.0 * (SELECT COUNT(*) FROM articles WHERE feed_id IS NOT NULL) /
    (SELECT COUNT(*) FROM articles), 1) as coverage_percent;
```

**Expected:** Coverage ≥85%

---

### STEP 7: Final Verification (3 min)

**Sample article checks:**
```sql
-- Check NYT articles have feed_id=3
SELECT id, url, feed_id
FROM articles
WHERE url LIKE '%nytimes.com%'
LIMIT 5;

-- Check WaPo articles have feed_id=4
SELECT id, url, feed_id
FROM articles
WHERE url LIKE '%washingtonpost.com%'
LIMIT 5;

-- Check unmapped articles are expected
SELECT id, url, source_domain
FROM articles
WHERE feed_id IS NULL
LIMIT 10;
```

**Expected:**
- NYT articles show feed_id=3
- WaPo articles show feed_id=4
- Unmapped articles are test/non-feed domains

---

## POST-DEPLOYMENT

### Immediate Actions (10 min)

**1. Monitor for errors**
```sql
-- Check for any new errors
SELECT * FROM feed_errors
WHERE created_at > NOW() - INTERVAL '10 minutes';
```

**2. Test new article ingestion**
- Wait for next RSS fetch (every 2 hours)
- Verify new articles get feed_id populated
- Check trigger is working

**3. Update JIRA**
- Add comment to TTRC-242 with PROD deployment results
- Move to "Done" if successful
- Note any differences from TEST deployment

### Monitoring (Next 24h)

**Morning check:**
```sql
-- Verify new articles have feed_id
SELECT COUNT(*) as total,
       COUNT(feed_id) as with_feed_id,
       COUNT(*) - COUNT(feed_id) as without_feed_id
FROM articles
WHERE created_at > NOW() - INTERVAL '24 hours';
```

**Afternoon check:**
```sql
-- Check for any errors
SELECT feed_id, COUNT(*) as error_count
FROM feed_errors
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY feed_id;
```

---

## ROLLBACK PROCEDURE

**If deployment fails or causes issues:**

**File:** `docs/rss-deployment/RSS v2/08_rollback_procedures.sql`

**⚠️ ONLY USE IF CRITICAL ISSUES**

Steps:
1. Copy rollback script
2. Review what it will do
3. Execute in PROD SQL Editor
4. Verify rollback succeeded
5. Document what went wrong

**Note:** Rollback is safest within first 24h. After that, data may accumulate in new tables.

---

## DIFFERENCES FROM TEST

**Expected differences:**
- Article counts (PROD: ~717, TEST: ~377)
- Feed data may differ if feeds added to PROD since TEST sync
- Timestamp in NOTICE messages will be different

**Should be identical:**
- Migration structure
- Backfill logic
- Verification queries
- Coverage percentage (should still be ≥85%)

---

## SUCCESS CRITERIA

**✅ Deployment successful if:**
- All migrations completed without errors
- Backfill coverage ≥85%
- Multi-mapping check = 0 rows
- Sample articles correctly mapped
- No errors in feed_errors table
- New articles get feed_id populated automatically

**❌ Deployment failed if:**
- Any migration errors
- Multi-mapping check returns rows
- Coverage <85%
- Sample mappings incorrect
- Errors appearing in feed_errors
- New articles not getting feed_id

---

## CONTACT / SUPPORT

**If issues occur:**
1. Check `docs/rss-deployment/RSS v2/15_troubleshooting_faq.md`
2. Review TEST deployment: `docs/handoffs/2025-10-28-ttrc242-migration027-complete.md`
3. Consider rollback if critical

**Files needed for PROD:**
- `temp_migration_027_fixed.sql` (MUST use fixed version)
- `temp_backfill_step1.sql`
- `temp_backfill_step2_REVIEW.sql`
- `temp_backfill_step3_APPLY.sql`

---

**Created:** 2025-10-28
**Tested in:** TEST environment (successful)
**Ready for:** PROD deployment
**Estimated time:** 30 minutes
**Risk level:** MEDIUM (schema changes, but tested and reversible)

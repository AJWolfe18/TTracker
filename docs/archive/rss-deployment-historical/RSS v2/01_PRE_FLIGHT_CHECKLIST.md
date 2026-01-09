# Pre-Flight Checklist

**Run these checks BEFORE applying any migrations**

---

## ENVIRONMENT CONFIRMATION

### 1. Verify You're in TEST
```sql
-- In Supabase SQL Editor
SELECT current_database();
```
**Expected:** Should show TEST project ID (not PROD)

**⚠️ STOP if this shows PROD** - Do not continue

---

## SCHEMA STATE CHECKS

### 2. Current Article Count
```sql
SELECT COUNT(*) as total_articles FROM public.articles;
```
**Expected:** ~377 articles

### 3. Current Feed Count
```sql
SELECT id, feed_name, is_active, feed_url 
FROM public.feed_registry 
ORDER BY id;
```
**Expected:** 6 feeds total
```
ID | Feed Name          | Active | URL
---|--------------------|--------|----------------------------------
1  | Reuters Politics   | true   | feeds.reuters.com/...
2  | AP News US         | true   | feeds.apnews.com/...
3  | NYT Politics       | true   | rss.nytimes.com/...
4  | WaPo Politics      | true   | feeds.washingtonpost.com/...
5  | Politico Top       | true   | www.politico.com/...
6  | Test Feed          | true   | test.example.com/...
```

**Decision Point:** Keep or delete Feed ID 6 (Test Feed)?
- [ ] Keep for testing
- [ ] Delete before production migration

### 4. Verify feed_id Column Does NOT Exist Yet
```sql
SELECT EXISTS(
  SELECT 1 FROM information_schema.columns 
  WHERE table_schema = 'public'
    AND table_name = 'articles' 
    AND column_name = 'feed_id'
) as column_exists;
```
**Expected:** `column_exists = false`

**⚠️ STOP if true** - Migration 027 may have already been applied

### 5. Verify feed_id in job_queue Does NOT Exist
```sql
SELECT EXISTS(
  SELECT 1 FROM information_schema.columns 
  WHERE table_schema = 'public'
    AND table_name = 'job_queue' 
    AND column_name = 'feed_id'
) as column_exists;
```
**Expected:** `column_exists = false`

**⚠️ STOP if true** - Migration 027 may have already been applied

---

## INDEX STATE CHECKS

### 6. Check for Partial Unique Index (Should Exist)
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'job_queue'
  AND indexname = 'ux_job_queue_payload_hash_active';
```
**Expected:** 1 row showing:
```sql
CREATE UNIQUE INDEX ux_job_queue_payload_hash_active 
ON public.job_queue USING btree (job_type, payload_hash) 
WHERE (processed_at IS NULL)
```

**If missing:** Migration 029 will create it (OK)

### 7. Check for Conflicting Full-Table Index
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'job_queue'
  AND indexname = 'job_queue_type_payload_hash_key';
```
**Expected:** 1 row (this will be dropped in Migration 027)

**If missing:** Already good - no conflict to resolve

---

## JOB QUEUE HEALTH

### 8. Count Active vs Completed Jobs
```sql
SELECT 
  CASE 
    WHEN processed_at IS NULL THEN 'Active'
    ELSE 'Completed'
  END as status,
  COUNT(*) as count
FROM public.job_queue
GROUP BY 1
ORDER BY 1;
```
**Expected:** Mix of active and completed jobs

**Decision Point:** Clean up old completed jobs?
```sql
-- OPTIONAL: Delete completed jobs older than 7 days
-- DELETE FROM public.job_queue 
-- WHERE processed_at IS NOT NULL 
--   AND completed_at < NOW() - INTERVAL '7 days';
```

### 9. Check for Stuck Jobs
```sql
SELECT COUNT(*) as stuck_count
FROM public.job_queue
WHERE processed_at IS NULL
  AND started_at IS NOT NULL
  AND started_at < NOW() - INTERVAL '1 hour';
```
**Expected:** 0 stuck jobs

**If > 0:** Review and clear stuck jobs before proceeding

---

## BACKFILL PREVIEW

### 10. Preview Domain Extraction
```sql
SELECT 
  regexp_replace(
    lower(regexp_replace(url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
    ''
  ) AS base_domain,
  source_domain,
  COUNT(*) as count
FROM public.articles
WHERE url IS NOT NULL
GROUP BY 1, 2
ORDER BY count DESC
LIMIT 15;
```
**Expected Output Example:**
```
base_domain           | source_domain              | count
----------------------|----------------------------|-------
nytimes.com           | rss.nytimes.com            | 150
washingtonpost.com    | feeds.washingtonpost.com   | 112
politico.com          | politico.com               | 93
test.local            | test.local                 | 13
```

**Validation:** Verify domains match expected feed sources

### 11. Preview Feed Domain Matching
```sql
SELECT 
  id as feed_id,
  feed_name,
  regexp_replace(
    lower(regexp_replace(feed_url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)', 
    ''
  ) AS base_domain
FROM public.feed_registry
ORDER BY id;
```
**Expected Output:**
```
feed_id | feed_name          | base_domain
--------|--------------------|-----------------
1       | Reuters Politics   | reuters.com
2       | AP News US         | apnews.com
3       | NYT Politics       | nytimes.com
4       | WaPo Politics      | washingtonpost.com
5       | Politico Top       | politico.com
6       | Test Feed          | test.example.com
```

**Validation:** These domains should match article domains from query #10

---

## RPC STATE CHECKS

### 12. Check Existing enqueue_fetch_job Signature
```sql
SELECT 
  routine_name,
  pg_get_function_arguments(p.oid) as arguments
FROM information_schema.routines r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE routine_schema = 'public'
  AND routine_name = 'enqueue_fetch_job'
LIMIT 1;
```
**Expected:** 
```
routine_name        | arguments
--------------------|-----------------------------------------
enqueue_fetch_job   | p_type text, p_payload jsonb, p_hash text
```

**Note:** Migration 028 will add new 5-arg version (backward compatible)

### 13. Check for Existing Metric RPCs (Should NOT Exist)
```sql
SELECT routine_name 
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'record_feed_success',
    'record_feed_not_modified',
    'record_feed_error',
    '_ensure_today_metrics'
  );
```
**Expected:** 0 rows (these will be created in Migration 028)

**⚠️ If any exist:** Migration 028 may have been partially applied

---

## TABLE EXISTENCE CHECKS

### 14. Check for New Tables (Should NOT Exist)
```sql
SELECT table_name 
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'feed_metrics',
    'feed_errors',
    'feed_compliance_rules'
  );
```
**Expected:** 0 rows

**⚠️ If any exist:** Migration 027 may have been partially applied

---

## BACKUP CONFIRMATION

### 15. Verify Supabase Auto-Backup
**Manual Step:**
1. Go to Supabase Dashboard → Project Settings → Backups
2. Confirm daily backups are enabled
3. Note most recent backup timestamp

**Alternative:** Take manual backup if concerned

---

## POST-MIGRATION VERIFICATION CHECKS

### 16. RPC Signature Verification (After Migration 028)
```sql
-- Verify both enqueue_fetch_job signatures exist
SELECT
  routine_name,
  pg_get_function_arguments(p.oid) as arguments
FROM information_schema.routines r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE routine_schema = 'public'
  AND routine_name = 'enqueue_fetch_job'
ORDER BY pg_get_function_arguments(p.oid);
```
**Expected:** 2 rows
- Row 1: `p_type text, p_payload jsonb, p_hash text DEFAULT NULL` (3-arg legacy)
- Row 2: `p_feed_id bigint, p_job_type text, p_payload jsonb, p_run_at timestamp with time zone DEFAULT now(), p_payload_hash text DEFAULT NULL` (5-arg new)

**⚠️ If missing:** Migration 028 failed - do not proceed

### 17. View Grants Verification (After Migration 029)
```sql
-- Verify authenticated role has SELECT grants on monitoring views
SELECT
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'authenticated'
  AND table_schema = 'admin'
  AND table_name IN ('feed_health_overview', 'feed_activity_hints', 'feed_cost_attribution')
ORDER BY table_name;
```
**Expected:** 3 rows (one per view)
```
admin | feed_activity_hints   | SELECT
admin | feed_cost_attribution | SELECT
admin | feed_health_overview  | SELECT
```

**⚠️ If missing:** Migration 029 grants incomplete - Edge Functions won't have access

### 18. View Field Verification (After Migration 029)
```sql
-- Verify critical fields exist in monitoring views
SELECT
  'feed_health_overview' as view_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'feed_health_overview'
  AND column_name IN ('health_status', 'error_rate_24h')
UNION ALL
SELECT
  'feed_activity_hints' as view_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'admin'
  AND table_name = 'feed_activity_hints'
  AND column_name IN ('suggested_interval_seconds', 'suggested_interval_human')
ORDER BY view_name, column_name;
```
**Expected:** 4 rows
- feed_activity_hints | suggested_interval_human | text
- feed_activity_hints | suggested_interval_seconds | integer
- feed_health_overview | error_rate_24h | numeric
- feed_health_overview | health_status | text

**⚠️ If missing:** Views incomplete - monitoring dashboards won't work

---

## DECISION CHECKLIST

Before proceeding, decide:

- [ ] **Test Feed:** Keep or delete Feed ID 6?
- [ ] **Old Jobs:** Clean up completed jobs >7 days old?
- [ ] **Stuck Jobs:** Any stuck jobs to clear?
- [ ] **Backup:** Confirmed recent backup exists?
- [ ] **Environment:** 100% certain this is TEST (not PROD)?

---

## EXPECTED BACKFILL COVERAGE

Based on current data:
```sql
-- Calculate expected backfill success rate
WITH domains AS (
  SELECT 
    COUNT(*) as total_articles,
    COUNT(CASE 
      WHEN lower(regexp_replace(url, '^https?://([^/]+).*$', '\1')) 
      LIKE ANY(ARRAY['%nytimes%', '%reuters%', '%washingtonpost%', '%politico%', '%apnews%'])
      THEN 1 
    END) as matchable_articles
  FROM public.articles
  WHERE url IS NOT NULL
)
SELECT 
  total_articles,
  matchable_articles,
  ROUND((matchable_articles::numeric / total_articles) * 100, 1) as expected_coverage_pct
FROM domains;
```
**Expected:** ~95% coverage (359/377 articles)

**Unmapped articles will be:**
- Test/example URLs (test.local, example.com)
- Edge cases (m. or amp. prefixes we haven't seen)
- Manually submitted URLs not from RSS

---

## GO / NO-GO DECISION

**GREEN LIGHT if:**
- ✅ In TEST environment (confirmed)
- ✅ feed_id columns do NOT exist yet
- ✅ New tables do NOT exist yet
- ✅ No stuck jobs blocking queue
- ✅ Backup confirmed
- ✅ Expected coverage ~95%

**RED LIGHT if:**
- ❌ In PROD environment
- ❌ Migrations partially applied (feed_id exists)
- ❌ Unexpected schema state
- ❌ Too many stuck jobs
- ❌ Backfill preview shows poor coverage

---

## NEXT STEPS

**If GREEN LIGHT:**
1. Proceed to Migration 027
2. Follow step-by-step execution guide

**If RED LIGHT:**
1. Stop immediately
2. Document the issue
3. Consult with Josh or start new Claude chat with context

---

**Checklist Complete:** _____ (Initial/Date)

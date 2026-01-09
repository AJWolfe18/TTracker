# RSS Feed Expansion — Ad Fontes Green Box Sources

**Date:** November 4, 2025
**Status:** Ready for JIRA
**Environment:** TEST (Phase 1 infrastructure in TEST only, NOT in PROD yet)

---

## ✅ SCHEMA VERIFIED

**Actual columns in feed_registry (from TEST database):**
- `feed_url` (RSS feed URL)
- `feed_name` (display name used in views)
- `source_name` (also exists, duplicate of feed_name)
- `source_domain` (e.g., "nytimes.com")
- `topics` (array of tags)
- `tier` (1/2/3 for polling frequency)
- `is_active` (boolean)

**All SQL in this document uses actual column names.**

**TEST Site URL:** https://[your-netlify-test-subdomain].netlify.app (update with actual URL)
**PROD Site URL:** https://trumpytracker.com

---

## Executive Summary

**Goal:** Expand from 5 feeds to **15 high-reliability, moderate-bias feeds** (Ad Fontes Media "green box"). Prefer politics-scoped feeds to reduce noise and cost. Enforce excerpt-only (1200 chars) on paywalled/long-form sources.

**Timeline:** 3 weeks
**Budget Impact:** ~+$1.31/month (well under $50 cap)
**Cost Gate:** Total projected cost must stay **< $45/month** (10% buffer)

**Success Criteria:**
- All feeds HEALTHY or INACTIVE
- Per-feed error rate < 3%
- Total projected cost < $45/month
- Clustering quality maintained (manual spot-checks)
- Operations runbook complete

---

## Target Feeds (10 new + 5 existing = 15 total)

### Already Live in TEST (verify):
1. Reuters Politics (Tier 1) — ❌ failing, needs investigation
2. AP News US (Tier 1) — ❌ failing, needs investigation
3. NYT Politics (Tier 1) — ✅ working
4. WaPo Politics (Tier 1) — ✅ working
5. Politico Top (Tier 2) — ✅ working

### Phase 3 — Small Test (3 feeds):
6. Christian Science Monitor (Tier 1)
7. PBS NewsHour (Tier 1)
8. Time (Politics) (Tier 2)

### Phase 4 — Full Rollout (7 feeds):
9. Newsweek (Politics) (Tier 2)
10. The Atlantic (Politics) (Tier 2) — **PAYWALL**
11. Reason (Politics) (Tier 2)
12. Fortune (Politics) (Tier 2) — **PAYWALL**
13. Vox (Politics) (Tier 2)
14. Foreign Affairs (Tier 3) — **PAYWALL**
15. The New Yorker (News/Politics) (Tier 3) — **PAYWALL**

**Tier Polling Guidance:**
- Tier 1: 24×/day (~hourly)
- Tier 2: 12×/day (~every 2h)
- Tier 3: 4×/day (~every 6h)

**Compliance Requirements:**
- **Excerpt-only rendering** for ALL sources (hard cap 1200 chars)
- Attribution (source name + link) visible
- Never store full text beyond RSS excerpt
- Verify RSS aggregation is permitted per ToS

---

## EPIC: RSS Feed Expansion — Ad Fontes Green Box Sources

**Summary:** Expand from 5 to 15 high-reliability, moderate-bias feeds (Ad Fontes "green box"). Prefer politics-scoped feeds to reduce noise and cost. Enforce excerpt-only (1200 chars) on paywalled/long-form sources.

**Description:**
Scale RSS ingestion from 5 current feeds to 15 carefully selected feeds from Ad Fontes Media's "green box" (high reliability, low-to-moderate bias). Focus on politics-scoped feeds where possible to reduce noise and cost. Maintain strict excerpt-only compliance (1200 char cap) for paywalled sources.

**Phase 1 Status:** Monitoring infrastructure (Migrations 027-029) deployed to TEST only, NOT in PROD yet. Blocked by TTRC-145 (frontend QA) for PROD deployment.

**Timeline:** 3 weeks
**Budget Impact:** ~$1.31/month additional (stays well under $50 cap)
**Cost Gate:** Total must stay < $45/month (10% buffer)

**Phases:**
- Phase 2: Validation (monitor existing feeds 48h)
- Phase 3: Small test (add 2-3 feeds, monitor 48h)
- Phase 4: Full rollout (add remaining 7 feeds, validate)

**Success Criteria:**
- All feeds showing HEALTHY or INACTIVE status
- Per-feed error rate < 3%
- Total projected cost < $45/month
- Clustering quality maintained (manual spot-checks)
- Operations runbook complete

---

## Story 0: Pre-Flight Infrastructure Validation

**Points:** 1
**Environment:** TEST
**Risk:** LOW

**Summary:** Validate that infrastructure is ready for feed expansion before adding new feeds.

**Description:**
Verify that all systems required for feed expansion are operational: job queue worker can process feeds, tier-based scheduling works correctly, database has capacity, and emergency rollback procedures are tested. This prevents adding feeds to a broken system.

**Acceptance Criteria:**
- [ ] Worker processing jobs with <5 minute queue depth
- [ ] Tier-based scheduler confirmed operational (feeds auto-enqueue based on tier)
- [ ] Database size <50% of Supabase free tier limit (250MB)
- [ ] All existing feeds either HEALTHY or intentionally INACTIVE
- [ ] Emergency rollback procedure tested in TEST
- [ ] Cost tracking dashboard accessible and accurate

**Tasks:**

### 1. Verify Worker Operational
```bash
# Check if worker process exists
ps aux | grep job-queue-worker

# If not running, start it
node scripts/job-queue-worker.js &

# Monitor for 5 minutes to ensure it processes jobs
tail -f /path/to/worker.log
```

### 2. Check Queue Depth
```sql
-- Verify no major backlog
SELECT
  job_type,
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest_pending,
  NOW() - MIN(created_at) as pending_duration
FROM job_queue
WHERE status = 'pending'
GROUP BY job_type, status
ORDER BY COUNT(*) DESC;
```
**RED FLAG:** Any pending jobs older than 5 minutes = worker overloaded or stuck

**Action if RED FLAG:** Restart worker, investigate hanging jobs:
```sql
-- Check for jobs stuck in 'claimed' status
SELECT * FROM job_queue
WHERE status = 'claimed'
  AND claimed_at < NOW() - INTERVAL '10 minutes'
ORDER BY claimed_at;
```

### 3. Verify Tier-Based Scheduler Exists

**CRITICAL: This must be answered before proceeding!**

```bash
# Check GitHub Actions workflows
ls .github/workflows/*rss*.yml

# Check for cron-based Edge Functions
supabase functions list | grep -i schedule

# Check for any scheduler code
grep -r "tier.*schedule\|schedule.*tier" scripts/
```

**Expected:** One of:
- GitHub Actions workflow that runs every 1-2 hours
- Edge Function with pg_cron schedule
- Cron job on server calling Edge Function

**If NONE exist:**
- [ ] **BLOCKER:** Must implement scheduler before adding feeds
- [ ] Document how tier values (1/2/3) map to fetch frequency
- [ ] Test scheduler creates jobs for each active feed

### 4. Database Size Check
```sql
-- Check total database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) as total_size;

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```
**RED FLAG:** Total size >250MB or `articles` table >100MB
**Action:** Consider archiving old articles or upgrading Supabase plan

### 5. Test Emergency Rollback Procedure
```sql
-- Test disabling all feeds (dry run - don't actually run this)
-- This validates the syntax works
EXPLAIN UPDATE feed_registry SET is_active = FALSE
WHERE created_at > CURRENT_DATE - INTERVAL '1 day';

-- Test purging jobs (dry run)
EXPLAIN DELETE FROM job_queue
WHERE feed_id IN (SELECT id FROM feed_registry WHERE created_at > CURRENT_DATE - INTERVAL '1 day')
  AND processed_at IS NULL;
```
**Expected:** Both queries return execution plan without errors

### 6. Verify Cost Dashboard Access
```sql
-- Test cost attribution view works
SELECT * FROM admin.feed_cost_attribution
ORDER BY total_cost_24h_usd DESC
LIMIT 5;

-- Calculate current monthly projection
SELECT
  SUM(total_cost_24h_usd * 30) as monthly_projection,
  COUNT(*) as active_feeds
FROM admin.feed_cost_attribution;
```
**Expected:** View returns data, monthly projection <$45

### 7. Document Current Baseline
```sql
-- Capture baseline metrics before expansion
SELECT
  (SELECT COUNT(*) FROM feed_registry WHERE is_active = true) as active_feeds,
  (SELECT COUNT(*) FROM articles) as total_articles,
  (SELECT COUNT(*) FROM stories WHERE status = 'active') as active_stories,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') as pending_jobs,
  (SELECT SUM(total_cost_24h_usd * 30) FROM admin.feed_cost_attribution) as monthly_cost_projection;
```
**Document these numbers** - they're your rollback target if expansion fails.

**GO/NO-GO Decision:**
- **GO if:** Worker running, queue depth <5 min, scheduler exists/working, DB size <250MB, rollback tested
- **NO-GO if:** Worker not running/backlogged, no scheduler, DB size >250MB, cost tracking broken
- Document decision and baseline metrics in handoff

**Emergency Rollback (Copy to Safe Place):**
```sql
-- EMERGENCY: Disable all feeds added during expansion
UPDATE feed_registry SET is_active = FALSE
WHERE created_at > '2025-11-04'  -- Change to actual start date
  AND feed_name NOT IN ('NYT Politics', 'WaPo Politics', 'Politico Top', 'Reuters Politics', 'AP News US');

-- EMERGENCY: Purge all pending jobs from new feeds
DELETE FROM job_queue
WHERE feed_id IN (
  SELECT id FROM feed_registry
  WHERE created_at > '2025-11-04'
)
AND processed_at IS NULL;

-- Verify rollback success
SELECT feed_name, is_active FROM feed_registry ORDER BY created_at DESC LIMIT 15;
```

---

## Story 1: Monitor Existing 5 Feeds (48h Validation)

**Points:** 1
**Environment:** TEST
**Risk:** LOW

**Summary:** Validate current feed infrastructure in TEST before expansion.

**Description:**
Monitor existing 5 feeds in TEST for 48 hours to establish baseline health, error rates, and cost signals. Fix any critical issues with failing feeds (Reuters, AP News) before adding new sources. This is the validation gate for Phase 3 expansion.

**Current Feed Status:**
- ✅ NYT Politics (Tier 1) — Working
- ✅ WaPo Politics (Tier 1) — Working
- ✅ Politico Top (Tier 2) — Working
- ❌ Reuters Politics (Tier 1) — 22 failures (needs investigation)
- ❌ AP News US (Tier 1) — 22 failures (needs investigation)

**Acceptance Criteria:**
- [ ] At least 3 feeds showing HEALTHY status
- [ ] Failing feeds (Reuters, AP) either fixed or marked inactive
- [ ] Overall error rate < 3% (excluding intentionally disabled feeds)
- [ ] Cost signals stable (existing baseline documented)
- [ ] No clustering regressions on TEST site
- [ ] Health dashboard queries validated and working
- [ ] **GO/NO-GO decision:** GO if ≥3 HEALTHY, errors <3%, no major clustering issues

**Tasks:**

### Day 1 Morning (9 AM) — Initial Health Check
```sql
-- Check overall health
SELECT
  feed_name,
  health_status,
  error_rate_24h,
  articles_24h,
  fetches_24h
FROM admin.feed_health_overview
ORDER BY error_rate_24h DESC;
```
**Expected:** 3 feeds HEALTHY, 2 feeds may show CRITICAL (Reuters, AP)

### Investigate Failing Feeds

**Step 1: Identify Error Types**
```sql
-- Check error patterns for Reuters and AP
SELECT
  fr.feed_name,
  fe.error_type,
  fe.error_message,
  COUNT(*) as error_count,
  MAX(fe.created_at) as last_error
FROM feed_errors fe
JOIN feed_registry fr ON fr.id = fe.feed_id
WHERE fr.feed_name IN ('Reuters Politics', 'AP News US')
  AND fe.created_at > NOW() - INTERVAL '48 hours'
GROUP BY fr.feed_name, fe.error_type, fe.error_message
ORDER BY error_count DESC;
```

**Step 2: Troubleshooting Decision Tree**

**If Error Type = "HTTP 403 Forbidden":**
```bash
# Test if User-Agent header fixes it
curl -A "Mozilla/5.0 TrumpyTracker/1.0" https://feeds.reuters.com/Reuters/PoliticsNews

# If 200 OK:
# ACTION REQUIRED: Update job-queue-worker.js to add User-Agent header
# Then re-enable feed and test
```

**If Error Type = "HTTP 404 Not Found":**
```bash
# Feed URL may have changed - research new URL
# Check publisher's RSS page or use feed discovery
curl -I https://www.reuters.com/tools/rss  # Look for new URL

# ACTION: Update feed_url in registry if found, else disable feed
UPDATE feed_registry
SET feed_url = 'https://NEW-URL-HERE'
WHERE feed_name = 'Reuters Politics';
```

**If Error Type = "DNS_RESOLUTION_FAILED" or "ETIMEDOUT":**
```bash
# Test connectivity
nslookup feeds.reuters.com
ping feeds.reuters.com

# If network issue:
# ACTION: Wait 24h, these are usually temporary
# If persistent >48h: disable feed
```

**If Error Type = "PARSE_ERROR" or "Invalid RSS":**
```bash
# Test if feed returns valid RSS
curl -v https://feeds.reuters.com/Reuters/PoliticsNews | head -50

# If returns HTML instead of XML:
# ACTION: Feed discontinued or requires auth - disable feed
```

**Step 3: Apply Fix or Disable**
```sql
-- Option A: Disable feed (if no fix available)
UPDATE feed_registry
SET is_active = FALSE, failure_count = 99
WHERE feed_name = 'Reuters Politics';

-- Purge pending jobs
DELETE FROM job_queue
WHERE feed_id = (SELECT id FROM feed_registry WHERE feed_name = 'Reuters Politics')
  AND processed_at IS NULL;

-- Option B: Reset failure count (after applying fix)
UPDATE feed_registry
SET failure_count = 0, is_active = TRUE
WHERE feed_name = 'Reuters Politics';

-- Trigger test fetch
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', (SELECT id FROM feed_registry WHERE feed_name = 'Reuters Politics'))
);
```

**Step 4: Verify Fix**
```bash
# Run worker and watch for success
node scripts/job-queue-worker.js

# After 5 minutes, check if articles ingested
psql $DATABASE_URL -c "
  SELECT COUNT(*) as new_articles
  FROM articles
  WHERE feed_id = (SELECT id FROM feed_registry WHERE feed_name = 'Reuters Politics')
    AND created_at > NOW() - INTERVAL '10 minutes';
"
```
**Expected:** new_articles > 0 if fix worked

**Document Resolution:**
- [ ] Error type identified
- [ ] Fix applied (or decision to disable with reason)
- [ ] Verification test passed (or feed marked inactive)
- [ ] Update handoff with resolution details

### Day 1 Evening (5 PM) — Cost Baseline
```sql
-- Document current cost
SELECT * FROM admin.feed_cost_attribution
ORDER BY total_cost_24h_usd DESC;
```
**Document:** Current daily cost projection for comparison after expansion

### Day 2 Morning (9 AM) — 24h Metrics
```sql
-- Check article ingestion rates
SELECT
  fr.feed_name,
  COUNT(*) FILTER (WHERE a.created_at > NOW() - INTERVAL '24 hours') as articles_last_24h,
  fr.failure_count
FROM feed_registry fr
LEFT JOIN articles a ON a.feed_id = fr.id
WHERE fr.is_active = true
GROUP BY fr.feed_name, fr.failure_count
ORDER BY articles_last_24h DESC;
```

### Day 2 Evening (5 PM) — Final Health Check
```sql
-- Final status before GO/NO-GO decision
SELECT
  feed_name,
  health_status,
  error_rate_24h,
  articles_24h
FROM admin.feed_health_overview
ORDER BY feed_name;
```

### Clustering Spot Check
- Visit TEST site (trumpytracker.com test URL)
- Review 10 recent stories
- Note clustering quality (are related articles grouped correctly?)
- Document any obvious issues

### GO/NO-GO Decision

**Objective Criteria (all must pass):**
- [ ] ≥3 feeds showing HEALTHY status
- [ ] Overall error rate <3% (calculated: total_errors / total_fetches)
- [ ] Cost projection stable (±10% from baseline)
- [ ] No pending jobs older than 5 minutes
- [ ] Clustering metrics acceptable (see below)

**Clustering Quality Check:**
```sql
-- Metric 1: Single-article story rate (target: <20%)
SELECT
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM stories WHERE status = 'active') as pct_single_article_stories
FROM stories s
WHERE status = 'active'
  AND (SELECT COUNT(*) FROM article_story WHERE story_id = s.id) = 1;

-- Metric 2: Over-clustered stories (target: <5 stories with >10 articles)
SELECT COUNT(*) as over_clustered_count
FROM (
  SELECT story_id, COUNT(*) as article_count
  FROM article_story
  GROUP BY story_id
  HAVING COUNT(*) > 10
) sub;
```
**RED FLAG thresholds:**
- Single-article story rate >20% = under-clustering issue
- >5 stories with >10 articles = over-clustering issue

**GO Decision:** All criteria pass AND clustering metrics acceptable
**NO-GO Decision:** Any criteria fails OR clustering degraded

**If NO-GO:**
- [ ] Document which criteria failed
- [ ] Create JIRA ticket for resolution
- [ ] Do NOT proceed to Story 2 until issues resolved

**Emergency Rollback (if needed after starting Story 2):**
```sql
-- This is a NO-OP for Story 1 (no new feeds added yet)
-- But document baseline for future rollback reference
SELECT
  COUNT(*) as feed_count,
  string_agg(feed_name, ', ' ORDER BY feed_name) as feed_list
FROM feed_registry
WHERE is_active = true;
```
Document this baseline - if you need to rollback from Story 2+, restore to this state.

---

## Story 2: Add First 3 Feeds (CSM + PBS + Time)

**Points:** 1
**Environment:** TEST
**Risk:** MEDIUM

**Summary:** Add first batch of Ad Fontes green-box feeds for validation.

**Description:**
Add 3 high-reliability feeds (Christian Science Monitor, PBS NewsHour, Time Politics) to TEST environment. Configure compliance rules with 1200-char excerpt limit, trigger initial fetch, verify ingestion working. This is the small-test validation before bulk expansion.

**Dependencies:**
- Story 1 completed with GO decision

**Acceptance Criteria:**
- [ ] 3 new rows in `feed_registry` (CSM, PBS, Time) with is_active=true
- [ ] Compliance rules configured (max_excerpt_chars=1200, allow_full_text=false)
- [ ] Initial fetch jobs completed successfully for all 3 feeds
- [ ] Articles appearing in `articles` table with correct feed_id
- [ ] No errors in first 2 hours
- [ ] Articles clustering into stories correctly
- [ ] All 3 feeds visible in `admin.feed_health_overview` with HEALTHY status

**Feed Definitions (canonical JSON):**
```json
[
  {
    "feed_url": "https://rss.csmonitor.com/feeds/politics",
    "feed_name": "Christian Science Monitor",
    "source_name": "Christian Science Monitor",
    "source_domain": "csmonitor.com",
    "topics": ["politics", "world"],
    "tier": 1,
    "is_active": true
  },
  {
    "feed_url": "https://www.pbs.org/newshour/feeds/rss/headlines",
    "feed_name": "PBS NewsHour",
    "source_name": "PBS NewsHour",
    "source_domain": "pbs.org",
    "topics": ["politics", "us"],
    "tier": 1,
    "is_active": true
  },
  {
    "feed_url": "https://time.com/section/politics/feed/",
    "feed_name": "Time (Politics)",
    "source_name": "Time (Politics)",
    "source_domain": "time.com",
    "topics": ["politics", "us"],
    "tier": 2,
    "is_active": true
  }
]
```

**Tasks:**

### 0. Validate Feed URLs (BEFORE INSERT)

**CRITICAL: Test each feed URL works before adding to database!**

```bash
# Test each feed URL returns valid RSS/XML
echo "Testing Christian Science Monitor..."
curl -sS -I "https://rss.csmonitor.com/feeds/politics" | grep -E "HTTP|Content-Type"

echo "Testing PBS NewsHour..."
curl -sS -I "https://www.pbs.org/newshour/feeds/rss/headlines" | grep -E "HTTP|Content-Type"

echo "Testing Time Politics..."
curl -sS -I "https://time.com/section/politics/feed/" | grep -E "HTTP|Content-Type"
```
**Expected for each:** `HTTP/1.1 200 OK` AND `Content-Type: application/rss+xml` (or `text/xml`)

**If any feed returns 404/403/500:**
- [ ] Research alternative URL
- [ ] Check publisher's RSS documentation
- [ ] DO NOT add feed to registry until valid URL found

**Detailed validation with rss-parser:**
```javascript
// Run this in Node.js console or create test script
const Parser = require('rss-parser');
const parser = new Parser();

const feeds = [
  {name: 'CSM', url: 'https://rss.csmonitor.com/feeds/politics'},
  {name: 'PBS', url: 'https://www.pbs.org/newshour/feeds/rss/headlines'},
  {name: 'Time', url: 'https://time.com/section/politics/feed/'}
];

for (const feed of feeds) {
  parser.parseURL(feed.url)
    .then(parsed => console.log(`✅ ${feed.name}: ${parsed.items.length} items`))
    .catch(err => console.log(`❌ ${feed.name}: ${err.message}`));
}
```
**Expected:** All 3 feeds parse successfully with >0 items

**ToS Review Checklist (per feed):**
- [ ] CSM: RSS feed publicly accessible, no robots.txt block
- [ ] PBS: RSS feed publicly accessible, no robots.txt block
- [ ] Time: RSS feed publicly accessible, check for paywall restrictions
- [ ] All: No rate limits documented that would block hourly fetches
- [ ] All: Commercial aggregation not explicitly prohibited

### 1. Insert Feeds into Registry
```sql
INSERT INTO feed_registry (feed_url, feed_name, source_name, source_domain, topics, tier, is_active)
VALUES
  ('https://rss.csmonitor.com/feeds/politics', 'Christian Science Monitor', 'Christian Science Monitor', 'csmonitor.com', ARRAY['politics','world'], 1, true),
  ('https://www.pbs.org/newshour/feeds/rss/headlines', 'PBS NewsHour', 'PBS NewsHour', 'pbs.org', ARRAY['politics','us'], 1, true),
  ('https://time.com/section/politics/feed/', 'Time (Politics)', 'Time (Politics)', 'time.com', ARRAY['politics','us'], 2, true);

-- Capture feed IDs
SELECT id, feed_name, tier FROM feed_registry
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)');
```

### 2. Add Compliance Rules (1200 char excerpt limit)
```sql
INSERT INTO feed_compliance_rules (feed_id, max_excerpt_chars, allow_full_text, notes)
VALUES
  ((SELECT id FROM feed_registry WHERE feed_name='Christian Science Monitor'), 1200, false, 'Ad Fontes green box - excerpt-only'),
  ((SELECT id FROM feed_registry WHERE feed_name='PBS NewsHour'), 1200, false, 'Ad Fontes green box - excerpt-only'),
  ((SELECT id FROM feed_registry WHERE feed_name='Time (Politics)'), 1200, false, 'Ad Fontes green box - excerpt-only (possible paywall)');
```

### 3. Trigger Initial Fetches (M029 RPC signature)
```sql
-- For each new feed:
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', (SELECT id FROM feed_registry WHERE feed_name='Christian Science Monitor'))
);

SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', (SELECT id FROM feed_registry WHERE feed_name='PBS NewsHour'))
);

SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', (SELECT id FROM feed_registry WHERE feed_name='Time (Politics)'))
);
```

### 4. Run Job Queue Worker
```bash
node scripts/job-queue-worker.js
# Let run for 5-10 minutes to process initial fetches
```

### 5. Verify Ingestion (2 hours after start)
```sql
SELECT
  fr.feed_name,
  COUNT(a.id) as article_count,
  MIN(a.published_at) as oldest_article,
  MAX(a.published_at) as newest_article
FROM feed_registry fr
LEFT JOIN articles a ON a.feed_id = fr.id
WHERE fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
GROUP BY fr.feed_name;
```
**Expected:** 10-50 articles per feed

### 6. Check for Errors
```sql
SELECT fe.*, fr.feed_name
FROM feed_errors fe
JOIN feed_registry fr ON fr.id = fe.feed_id
WHERE fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
ORDER BY fe.created_at DESC;
```
**Expected:** 0 rows (no errors)

### 7. Verify Health Status
```sql
SELECT * FROM admin.feed_health_overview
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)');
```
**Expected:** All show health_status = 'HEALTHY'

### 8. Real-Time Cost & Flood Detection (4 hours after start)

**CRITICAL: Catch cost spikes before 24h lag in cost attribution view!**

```sql
-- RED FLAG: Check if any new feed ingested >100 articles in first 4 hours
SELECT
  fr.feed_name,
  COUNT(a.id) as article_count,
  MIN(a.created_at) as first_article,
  MAX(a.created_at) as last_article
FROM feed_registry fr
JOIN articles a ON a.feed_id = fr.id
WHERE fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
  AND a.created_at > NOW() - INTERVAL '4 hours'
GROUP BY fr.feed_name
HAVING COUNT(a.id) > 100;
```
**Expected:** 0 rows (no floods)

**RED FLAG if ANY feed >100 articles:** Feed may be misconfigured or publishing backlog
- **Immediate Action:**
  ```sql
  -- Disable flooding feed immediately
  UPDATE feed_registry
  SET is_active = FALSE
  WHERE feed_name = '[FLOODING_FEED_NAME]';

  -- Purge pending jobs
  DELETE FROM job_queue
  WHERE feed_id = (SELECT id FROM feed_registry WHERE feed_name = '[FLOODING_FEED_NAME]')
    AND processed_at IS NULL;
  ```
- [ ] Investigate why feed flooded (check RSS feed directly)
- [ ] Decide: Keep feed (if legitimate backlog) or disable permanently

**Real-time cost estimate:**
```sql
-- Calculate actual cost impact from new feeds (4h sample)
SELECT
  fr.feed_name,
  COUNT(a.id) as articles_4h,
  -- Extrapolate to daily
  COUNT(a.id) * 6 as projected_daily_articles,
  -- Cost per article = $0.00035 (embeddings + clustering + enrichment)
  ROUND((COUNT(a.id) * 6 * 0.00035)::numeric, 4) as projected_daily_cost,
  ROUND((COUNT(a.id) * 6 * 0.00035 * 30)::numeric, 2) as projected_monthly_cost
FROM feed_registry fr
JOIN articles a ON a.feed_id = fr.id
WHERE fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
  AND a.created_at > NOW() - INTERVAL '4 hours'
GROUP BY fr.feed_name;
```
**Expected:** projected_monthly_cost per feed <$0.15, total <$0.45

**RED FLAG if total >$0.45/month from 3 feeds:** Higher than projected
- [ ] Review feed URLs - are they politics-scoped or site-wide?
- [ ] Check if feeds have duplicate articles (same article re-published)

**Emergency Rollback (if major issues found):**
```sql
-- Disable all 3 new feeds
UPDATE feed_registry
SET is_active = FALSE
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
  AND created_at > CURRENT_DATE;

-- Purge pending jobs
DELETE FROM job_queue
WHERE feed_id IN (
  SELECT id FROM feed_registry
  WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
)
AND processed_at IS NULL;

-- Optionally: Delete ingested articles (if they're causing clustering issues)
-- WARNING: This is destructive! Only do if articles are garbage/spam
-- DELETE FROM articles
-- WHERE feed_id IN (
--   SELECT id FROM feed_registry
--   WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
-- );

-- Verify rollback
SELECT feed_name, is_active, failure_count
FROM feed_registry
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)');
```
**Expected after rollback:** All 3 feeds is_active=FALSE, no pending jobs

---

## Story 3: Monitor First 3 Feeds (48h)

**Points:** 1
**Environment:** TEST
**Risk:** LOW

**Summary:** Validate new feeds stable before bulk expansion.

**Description:**
Monitor CSM, PBS, Time for 48 hours to ensure stable ingestion, cost within projections, clustering quality maintained, and no system regressions. This is the validation gate for Phase 4 full rollout.

**Dependencies:**
- Story 2 completed successfully

**Acceptance Criteria:**
- [ ] All 3 feeds showing HEALTHY status
- [ ] Error rate < 3% for each new feed
- [ ] Cost increase ≤ $0.30/month (projected from 48h data)
- [ ] Articles_per_fetch ≥ 1.0 for at least 2 of 3 feeds
- [ ] Articles clustering correctly (no over/under-clustering observed)
- [ ] No performance degradation in existing feeds
- [ ] **GO/NO-GO decision:** GO if all 3 HEALTHY, errors <3%, cost ≤$0.30/mo, clustering OK

**Tasks:**

### Day 1 Morning (9 AM) — Initial Check
```sql
SELECT * FROM admin.feed_health_overview
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
ORDER BY error_rate_24h DESC;
```

### Day 1 Evening (5 PM) — Ingestion Rate
```sql
-- Fixed: Use JOIN instead of subquery (more efficient)
SELECT
  fr.feed_name,
  COUNT(*) FILTER (WHERE a.created_at > NOW() - INTERVAL '24 hours') as articles_last_24h,
  h.fetches_24h,
  ROUND(
    COUNT(*) FILTER (WHERE a.created_at > NOW() - INTERVAL '24 hours')::numeric /
    NULLIF(h.fetches_24h, 0),
    1
  ) as articles_per_fetch
FROM feed_registry fr
LEFT JOIN articles a ON a.feed_id = fr.id
LEFT JOIN admin.feed_health_overview h ON h.feed_name = fr.feed_name
WHERE fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
GROUP BY fr.feed_name, h.fetches_24h;
```

### Day 2 Morning (9 AM) — Error Check
```sql
SELECT
  fr.feed_name,
  COUNT(*) as error_count,
  fe.error_type
FROM feed_errors fe
JOIN feed_registry fr ON fr.id = fe.feed_id
WHERE fe.created_at > NOW() - INTERVAL '24 hours'
  AND fr.feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
GROUP BY fr.feed_name, fe.error_type;
```
**Expected:** 0 or very low count

### Day 2 Evening (5 PM) — Cost Analysis
```sql
SELECT
  feed_name,
  articles_24h,
  total_cost_24h_usd,
  ROUND(total_cost_24h_usd * 30, 2) as projected_monthly_cost
FROM admin.feed_cost_attribution
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
ORDER BY projected_monthly_cost DESC;
```
**Expected:** Total projected monthly < $0.30

### Clustering Quality Spot Check
- Visit TEST site
- Find 5-10 stories containing articles from new feeds
- Check: Are CSM/PBS/Time articles grouped with relevant existing articles?
- Note: Any stories with ONLY new feed articles (possible under-clustering)?
- Note: Any stories mixing unrelated topics (possible over-clustering)?
- Document observations

### System-Wide Health Check
```sql
-- Ensure existing feeds unaffected
SELECT
  feed_name,
  health_status,
  error_rate_24h
FROM admin.feed_health_overview
WHERE feed_name IN ('NYT Politics', 'WaPo Politics', 'Politico Top')
ORDER BY feed_name;
```
**Expected:** All still HEALTHY, no error rate increase

### GO/NO-GO Decision

**Objective Criteria (all must pass):**
- [ ] All 3 feeds showing HEALTHY status
- [ ] Error rate <3% for each feed (errors_24h / fetches_24h < 0.03)
- [ ] Cost increase ≤$0.30/month projected (from 48h extrapolation)
- [ ] Articles_per_fetch ≥1.0 for at least 2 of 3 feeds
- [ ] No article floods (no feed >100 articles in 24h)
- [ ] Clustering quality maintained (see below)

**Clustering Quality Metrics:**
```sql
-- Metric 1: Single-article story rate (target: <20%, acceptable: <25%)
SELECT
  COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM stories WHERE status = 'active'), 0) as pct_single_article_stories
FROM stories s
WHERE status = 'active'
  AND (SELECT COUNT(*) FROM article_story WHERE story_id = s.id) = 1;

-- Metric 2: Over-clustered stories (target: <5 stories with >10 articles)
SELECT COUNT(*) as over_clustered_count
FROM (
  SELECT story_id, COUNT(*) as article_count
  FROM article_story
  GROUP BY story_id
  HAVING COUNT(*) > 10
) sub;

-- Metric 3: Average articles per active story (healthy range: 2-4)
SELECT
  AVG(article_count)::numeric(10,2) as avg_articles_per_story
FROM (
  SELECT story_id, COUNT(*) as article_count
  FROM article_story
  GROUP BY story_id
) sub;
```

**RED FLAG thresholds:**
- Single-article rate >25% = significant under-clustering
- >5 over-clustered stories OR avg_articles_per_story >5 = over-clustering
- avg_articles_per_story <1.5 = severe under-clustering

**GO Decision:** All objective criteria pass AND no RED FLAGS
**NO-GO Decision:** Any criteria fails OR 2+ RED FLAGS triggered

**If NO-GO:**
- [ ] Document which criteria/flags failed
- [ ] Execute emergency rollback (below)
- [ ] Create JIRA ticket for clustering threshold tuning
- [ ] Do NOT proceed to Story 4 until resolved

**Emergency Rollback:**
```sql
-- Disable the 3 new feeds
UPDATE feed_registry
SET is_active = FALSE
WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
  AND created_at > (SELECT MAX(created_at) FROM feed_registry WHERE feed_name IN ('NYT Politics', 'WaPo Politics', 'Politico Top'));

-- Purge pending jobs
DELETE FROM job_queue
WHERE feed_id IN (
  SELECT id FROM feed_registry
  WHERE feed_name IN ('Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)')
)
AND processed_at IS NULL;

-- Verify rollback to baseline (5 feeds or fewer)
SELECT COUNT(*) as active_feed_count
FROM feed_registry
WHERE is_active = true;
```
**Expected after rollback:** active_feed_count ≤ 5 (back to baseline)

**Document Decision:**
- [ ] Recorded GO/NO-GO decision with metrics
- [ ] If GO: Proceed to Story 4 (bulk rollout)
- [ ] If NO-GO: Documented root cause, created ticket, executed rollback

---

## Story 4: Add Remaining 7 Feeds (Full Rollout)

**Points:** 2
**Environment:** TEST
**Risk:** MEDIUM

**Summary:** Add final batch of 7 Ad Fontes feeds to reach 15-feed target.

**Description:**
After successful validation of first 3 feeds, add remaining 7 feeds (Newsweek, The Atlantic, Reason, Fortune, Vox, Foreign Affairs, The New Yorker) to reach 15 total feeds. All sources from Ad Fontes green box with excerpt-only compliance.

**Dependencies:**
- Story 3 completed with GO decision

**Acceptance Criteria:**
- [ ] 7 new rows in `feed_registry` (15 total feeds)
- [ ] Compliance rules configured for all 7 (1200 char limit, PAYWALL noted)
- [ ] Initial fetch jobs completed successfully
- [ ] Articles ingesting from all 7 feeds
- [ ] No critical errors in first 4 hours
- [ ] All 15 feeds visible in health dashboard

**Feed Definitions (canonical JSON):**
```json
[
  {"feed_url":"https://www.newsweek.com/politics/rss","feed_name":"Newsweek (Politics)","source_name":"Newsweek (Politics)","source_domain":"newsweek.com","topics":["politics","us"],"tier":2,"is_active":true},
  {"feed_url":"https://www.theatlantic.com/feed/channel/politics/","feed_name":"The Atlantic (Politics)","source_name":"The Atlantic (Politics)","source_domain":"theatlantic.com","topics":["politics"],"tier":2,"is_active":true},
  {"feed_url":"https://reason.com/tag/politics/feed/","feed_name":"Reason (Politics)","source_name":"Reason (Politics)","source_domain":"reason.com","topics":["politics","policy"],"tier":2,"is_active":true},
  {"feed_url":"https://fortune.com/politics/feed/","feed_name":"Fortune (Politics)","source_name":"Fortune (Politics)","source_domain":"fortune.com","topics":["politics","business"],"tier":2,"is_active":true},
  {"feed_url":"https://www.vox.com/politics/rss/index.xml","feed_name":"Vox (Politics)","source_name":"Vox (Politics)","source_domain":"vox.com","topics":["politics","policy"],"tier":2,"is_active":true},
  {"feed_url":"https://www.foreignaffairs.com/rss.xml","feed_name":"Foreign Affairs","source_name":"Foreign Affairs","source_domain":"foreignaffairs.com","topics":["foreign-policy","world"],"tier":3,"is_active":true},
  {"feed_url":"https://www.newyorker.com/feed/news","feed_name":"The New Yorker (News/Politics)","source_name":"The New Yorker (News/Politics)","source_domain":"newyorker.com","topics":["politics","culture"],"tier":3,"is_active":true}
]
```

**Tasks:**

### 1. Insert All 7 Feeds
```sql
INSERT INTO feed_registry (feed_url, feed_name, source_name, source_domain, topics, tier, is_active)
VALUES
  ('https://www.newsweek.com/politics/rss', 'Newsweek (Politics)', 'Newsweek (Politics)', 'newsweek.com', ARRAY['politics','us'], 2, true),
  ('https://www.theatlantic.com/feed/channel/politics/', 'The Atlantic (Politics)', 'The Atlantic (Politics)', 'theatlantic.com', ARRAY['politics'], 2, true),
  ('https://reason.com/tag/politics/feed/', 'Reason (Politics)', 'Reason (Politics)', 'reason.com', ARRAY['politics','policy'], 2, true),
  ('https://fortune.com/politics/feed/', 'Fortune (Politics)', 'Fortune (Politics)', 'fortune.com', ARRAY['politics','business'], 2, true),
  ('https://www.vox.com/politics/rss/index.xml', 'Vox (Politics)', 'Vox (Politics)', 'vox.com', ARRAY['politics','policy'], 2, true),
  ('https://www.foreignaffairs.com/rss.xml', 'Foreign Affairs', 'Foreign Affairs', 'foreignaffairs.com', ARRAY['foreign-policy','world'], 3, true),
  ('https://www.newyorker.com/feed/news', 'The New Yorker (News/Politics)', 'The New Yorker (News/Politics)', 'newyorker.com', ARRAY['politics','culture'], 3, true);
```

### 2. Add Compliance Rules (paywalled sources noted)
```sql
INSERT INTO feed_compliance_rules (feed_id, max_excerpt_chars, allow_full_text, notes)
VALUES
  ((SELECT id FROM feed_registry WHERE feed_name='Newsweek (Politics)'), 1200, false, 'Excerpt-only; bursty cadence'),
  ((SELECT id FROM feed_registry WHERE feed_name='The Atlantic (Politics)'), 1200, false, 'PAYWALL — excerpt-only mandatory'),
  ((SELECT id FROM feed_registry WHERE feed_name='Reason (Politics)'), 1200, false, 'Excerpt-only; libertarian POV'),
  ((SELECT id FROM feed_registry WHERE feed_name='Fortune (Politics)'), 1200, false, 'PAYWALL — excerpt-only mandatory'),
  ((SELECT id FROM feed_registry WHERE feed_name='Vox (Politics)'), 1200, false, 'Excerpt-only; policy explainers'),
  ((SELECT id FROM feed_registry WHERE feed_name='Foreign Affairs'), 1200, false, 'PAYWALL — excerpt-only mandatory; low cadence'),
  ((SELECT id FROM feed_registry WHERE feed_name='The New Yorker (News/Politics)'), 1200, false, 'PAYWALL — excerpt-only mandatory; long-form');
```

### 3. Trigger Initial Fetches (loop through all 7)
```sql
DO $$
DECLARE
  r RECORD;
  v_result BIGINT;
  v_enqueued INT := 0;
  v_duplicates INT := 0;
BEGIN
  FOR r IN
    SELECT id, feed_name FROM feed_registry
    WHERE feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                        'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                        'The New Yorker (News/Politics)')
  LOOP
    v_result := public.enqueue_fetch_job('fetch_feed', jsonb_build_object('feed_id', r.id));

    IF v_result IS NULL THEN
      v_duplicates := v_duplicates + 1;
      RAISE NOTICE 'DUPLICATE: Feed "%" already has pending job (skipped)', r.feed_name;
    ELSE
      v_enqueued := v_enqueued + 1;
      RAISE NOTICE 'ENQUEUED: Feed "%" -> job ID %', r.feed_name, v_result;
    END IF;
  END LOOP;

  RAISE NOTICE '✅ Summary: % jobs enqueued, % duplicates skipped', v_enqueued, v_duplicates;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ ERROR: %', SQLERRM;
    RAISE;
END$$;
```

### 4. Run Job Queue Worker
```bash
node scripts/job-queue-worker.js
# Let run for 10-15 minutes to process all 7 feed fetches
```

### 5. Verify Ingestion (4 hours after start)
```sql
SELECT
  fr.feed_name,
  fr.tier,
  COUNT(a.id) as article_count,
  MAX(a.published_at) as newest_article
FROM feed_registry fr
LEFT JOIN articles a ON a.feed_id = fr.id
WHERE fr.feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                       'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                       'The New Yorker (News/Politics)')
GROUP BY fr.feed_name, fr.tier
ORDER BY fr.tier, article_count DESC;
```

### 6. Check for Critical Errors
```sql
SELECT fe.error_type, fr.feed_name, COUNT(*)
FROM feed_errors fe
JOIN feed_registry fr ON fr.id = fe.feed_id
WHERE fe.created_at > NOW() - INTERVAL '4 hours'
  AND fr.feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                       'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                       'The New Yorker (News/Politics)')
GROUP BY fe.error_type, fr.feed_name;
```
**Action:** If any feed has >5 errors in 4h, investigate immediately

### 7. Verify All 15 Feeds in Dashboard
```sql
SELECT feed_name, health_status, articles_24h
FROM admin.feed_health_overview
ORDER BY health_status, feed_name;
```
**Expected:** 15 rows, most showing HEALTHY

### 8. EMERGENCY ROLLBACK (if critical issues found)

**ONLY IF:** Any feed has error_rate > 50% in first 4 hours OR >200 articles ingested (flood)

```sql
-- Disable all 7 new feeds
UPDATE feed_registry SET is_active = FALSE
WHERE feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                    'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                    'The New Yorker (News/Politics)');

-- Purge their pending jobs
DELETE FROM job_queue
WHERE feed_id IN (
  SELECT id FROM feed_registry
  WHERE feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                      'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                      'The New Yorker (News/Politics)')
)
AND processed_at IS NULL;

-- Verify rollback
SELECT feed_name, is_active, failure_count
FROM feed_registry
WHERE feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                    'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                    'The New Yorker (News/Politics)');
```

**Expected:** All 7 feeds show `is_active = FALSE`

**After rollback:** Document root cause, fix issue, retry Story 4 after 24h cooling-off period.

---

### 9. GO/NO-GO Decision (4 hours after initial fetch)

**Decision Point:** Should we continue to Story 5, or rollback and investigate?

**Objective Criteria:**

| Metric | RED FLAG (rollback) | YELLOW (monitor) | GREEN (proceed) |
|---|---|---|---|
| **Feeds with critical errors** | ≥2 feeds | 1 feed | 0 feeds |
| **Per-feed error rate** | Any feed >50% | Any feed 10-50% | All feeds <10% |
| **Article flood** | Any feed >200 articles | Any feed 100-200 | All feeds <100 |
| **Total cost (4h sample)** | >$2 (projected $15/day) | $1-2 | <$1 |
| **Clustering failures** | >10 single-article stories | 5-10 single-article | <5 single-article |

**Decision:**
- **RED FLAG = ROLLBACK IMMEDIATELY** (use Emergency Rollback above)
- **YELLOW = PAUSE 12h**, monitor, re-assess before Story 5
- **GREEN = PROCEED** to Story 5 (48h monitoring)

**Query for decision:**
```sql
-- Check all GO/NO-GO metrics
WITH batch_feeds AS (
  SELECT id FROM feed_registry
  WHERE feed_name IN ('Newsweek (Politics)', 'The Atlantic (Politics)', 'Reason (Politics)',
                      'Fortune (Politics)', 'Vox (Politics)', 'Foreign Affairs',
                      'The New Yorker (News/Politics)')
)
SELECT
  'Critical Feeds' as metric,
  COUNT(*) FILTER (WHERE h.health_status = 'CRITICAL') as value,
  CASE
    WHEN COUNT(*) FILTER (WHERE h.health_status = 'CRITICAL') >= 2 THEN '🔴 RED FLAG'
    WHEN COUNT(*) FILTER (WHERE h.health_status = 'CRITICAL') = 1 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END as status
FROM batch_feeds bf
JOIN feed_registry fr ON fr.id = bf.id
LEFT JOIN admin.feed_health_overview h ON h.feed_name = fr.feed_name

UNION ALL

SELECT
  'High Error Feeds',
  COUNT(*) FILTER (WHERE h.error_rate_24h > 0.5),
  CASE
    WHEN COUNT(*) FILTER (WHERE h.error_rate_24h > 0.5) > 0 THEN '🔴 RED FLAG'
    WHEN COUNT(*) FILTER (WHERE h.error_rate_24h > 0.1) > 0 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM batch_feeds bf
JOIN feed_registry fr ON fr.id = bf.id
LEFT JOIN admin.feed_health_overview h ON h.feed_name = fr.feed_name

UNION ALL

SELECT
  'Article Flood',
  COUNT(*) FILTER (WHERE article_count > 200),
  CASE
    WHEN COUNT(*) FILTER (WHERE article_count > 200) > 0 THEN '🔴 RED FLAG'
    WHEN COUNT(*) FILTER (WHERE article_count > 100) > 0 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM (
  SELECT fr.feed_name, COUNT(a.id) as article_count
  FROM batch_feeds bf
  JOIN feed_registry fr ON fr.id = bf.id
  LEFT JOIN articles a ON a.feed_id = fr.id
    AND a.created_at > NOW() - INTERVAL '4 hours'
  GROUP BY fr.feed_name
) sub;
```

**Expected Output:**
```
metric              | value | status
--------------------+-------+-------------
Critical Feeds      |     0 | 🟢 GREEN
High Error Feeds    |     0 | 🟢 GREEN
Article Flood       |     0 | 🟢 GREEN
```

**If all GREEN:** ✅ Proceed to Story 5
**If any RED or 2+ YELLOW:** ⚠️ Investigate before proceeding

---

## Story 5: Final Validation & Operations Runbook

**Points:** 2
**Environment:** TEST
**Risk:** LOW

**Summary:** Validate 15-feed system stable, analyze performance, create runbook.

**Description:**
Monitor all 15 RSS feeds for 48 hours after bulk expansion. Analyze per-feed performance metrics, identify underperformers, validate total cost under $45/month budget, assess clustering quality, tune tier assignments based on articles_per_fetch, and create comprehensive operations runbook for ongoing maintenance.

**Dependencies:**
- Story 4 completed successfully

**Acceptance Criteria:**
- [ ] All 15 feeds configured (HEALTHY or intentionally INACTIVE)
- [ ] Total monthly cost < $45 (projected from 48h data)
- [ ] Overall error rate < 3%
- [ ] Clustering quality spot-checked and documented
- [ ] Per-feed tier tuning complete (based on articles_per_fetch)
- [ ] Underperforming feeds identified and action taken
- [ ] **Bias mix check (optional):** At least 1 libertarian (Reason), 2 center/center-left (CSM/PBS) active
- [ ] Operations runbook created and saved
- [ ] Handoff documentation complete with metrics and lessons learned
- [ ] JIRA epic closed with final status

**Tasks:**

### 1. 48-Hour Monitoring (Day 1 & Day 2)

**Morning & Evening Checks (run 4 times: Day 1 AM/PM, Day 2 AM/PM):**
```sql
-- Full health overview
SELECT
  feed_name,
  tier,
  health_status,
  error_rate_24h,
  articles_24h,
  fetches_24h,
  ROUND(articles_24h::numeric / NULLIF(fetches_24h, 0), 2) as articles_per_fetch
FROM admin.feed_health_overview
ORDER BY health_status DESC, error_rate_24h DESC, tier;
```

### 2. Cost Analysis (Day 2 Evening)
```sql
-- Per-feed cost
SELECT
  feed_name,
  tier,
  articles_24h,
  total_cost_24h_usd,
  ROUND(total_cost_24h_usd * 30, 2) as projected_monthly_cost
FROM admin.feed_cost_attribution
ORDER BY projected_monthly_cost DESC;

-- Total projected cost
SELECT
  SUM(total_cost_24h_usd * 30) as total_monthly_projection,
  COUNT(*) as active_feeds
FROM admin.feed_cost_attribution;
```
**Expected:** Total < $45/month

### 3. Performance Analysis — Identify Underperformers
```sql
-- Feeds with low articles per fetch or high errors
SELECT
  feed_name,
  tier,
  error_rate_24h,
  articles_24h,
  fetches_24h,
  ROUND(articles_24h::numeric / NULLIF(fetches_24h, 0), 2) as articles_per_fetch,
  CASE
    WHEN error_rate_24h > 0.05 THEN '⚠️ High errors'
    WHEN articles_24h::numeric / NULLIF(fetches_24h, 0) < 0.5 THEN '⚠️ Low yield'
    ELSE '✅ OK'
  END as status
FROM admin.feed_health_overview
WHERE health_status != 'INACTIVE'
ORDER BY error_rate_24h DESC, articles_per_fetch ASC;
```

**Action:** For feeds with articles_per_fetch < 0.5, consider:
- Lowering tier (reduce polling frequency)
- Checking if feed publishes on specific schedule
- Disabling if consistently low value

### 4. Tier Tuning Based on Performance
```sql
-- Adjust tiers based on observed cadence
-- Example: If Foreign Affairs has low yield, downgrade to Tier 3
UPDATE feed_registry
SET tier = 3
WHERE feed_name = 'Foreign Affairs'
  AND (SELECT articles_per_fetch FROM admin.feed_health_overview WHERE feed_name = 'Foreign Affairs') < 0.5;

-- Document any tier changes in handoff
```

### 5. Clustering Quality Assessment
- Visit TEST site
- Sample 20 recent stories (mix of high-activity and low-activity)
- For each story, check:
  - Are related articles grouped correctly?
  - Are there stories with only 1 article? (possible under-clustering)
  - Are there stories mixing unrelated topics? (possible over-clustering)
  - Are paywalled sources (Atlantic, New Yorker, Fortune, Foreign Affairs) showing excerpts only?
- Document findings:
  - Clustering accuracy estimate (subjective)
  - Number of single-article stories in sample
  - Number of poorly-clustered stories
  - Any patterns (e.g., specific feeds cluster poorly?)

### 6. Bias Mix Sanity Check (Optional)
```sql
-- Verify at least 1 libertarian, 2 center sources active
SELECT fr.feed_name, fr.is_active, h.health_status
FROM feed_registry fr
LEFT JOIN admin.feed_health_overview h ON h.feed_name = fr.feed_name
WHERE fr.feed_name IN ('Reason (Politics)', 'Christian Science Monitor', 'PBS NewsHour')
ORDER BY fr.feed_name;
```
**Expected:** All 3 active with HEALTHY status

### 7. Create Operations Runbook

**File:** `docs/operations-runbook-rss-v2.md`

**Content:**
```markdown
# RSS Feed Operations Runbook

## Daily Monitoring (9 AM & 5 PM)

### Health Check
\`\`\`sql
SELECT feed_name, health_status, error_rate_24h, articles_24h
FROM admin.feed_health_overview
WHERE health_status != 'HEALTHY'
ORDER BY error_rate_24h DESC;
\`\`\`

**Alert Threshold:** Any feed with error_rate_24h > 0.05 (5%)

### Cost Check
\`\`\`sql
SELECT SUM(total_cost_24h_usd * 30) as monthly_projection
FROM admin.feed_cost_attribution;
\`\`\`

**Alert Threshold:** Projection > $45/month

### Error Log
\`\`\`sql
SELECT fe.error_type, fr.feed_name, COUNT(*)
FROM feed_errors fe
JOIN feed_registry fr ON fr.id = fe.feed_id
WHERE fe.created_at > NOW() - INTERVAL '24 hours'
GROUP BY fe.error_type, fr.feed_name
HAVING COUNT(*) > 3;
\`\`\`

## Weekly Review (Monday mornings)

- Review cost per feed, identify low-value sources
- Check for trending errors (same error type recurring)
- Adjust tier assignments based on cadence
- Review clustering quality (spot-check 10 stories)

## Common Procedures

### Disable a Feed
\`\`\`sql
UPDATE feed_registry SET is_active = FALSE WHERE feed_name = 'Feed Name';
-- Optionally purge pending jobs
DELETE FROM job_queue
WHERE feed_id = (SELECT id FROM feed_registry WHERE feed_name = 'Feed Name')
  AND processed_at IS NULL;
\`\`\`

### Re-enable a Feed
\`\`\`sql
UPDATE feed_registry
SET is_active = TRUE, failure_count = 0
WHERE feed_name = 'Feed Name';

-- Trigger immediate fetch
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', (SELECT id FROM feed_registry WHERE feed_name = 'Feed Name'))
);
\`\`\`

### Troubleshooting Common Errors

**HTTP 403 Forbidden:**
- Check if feed requires User-Agent header
- Verify RSS URL still valid (publishers change URLs)
- Check if IP blocked (rate limiting)

**HTTP 404 Not Found:**
- Feed URL changed - research new URL
- Feed discontinued - disable feed

**Timeout/Connection errors:**
- Temporary issue - monitor for 24h
- If persistent >3 days - consider disabling

## Alert Thresholds

| Metric | Warning | Critical |
|---|---|---|
| Per-feed error rate (24h) | >3% | >5% |
| Site-wide error rate | >3% | >5% |
| Monthly cost projection | >$45 | >$48 |
| CRITICAL health status | 1 feed | >1 feed |

## Excerpt Compliance (CRITICAL)

**These feeds MUST use excerpt-only (1200 char):**
- The Atlantic (Politics) — PAYWALL
- The New Yorker (News/Politics) — PAYWALL
- Foreign Affairs — PAYWALL
- Fortune (Politics) — PAYWALL

**Verify:** Check feed_compliance_rules table - all should have max_excerpt_chars=1200, allow_full_text=false
```

### 7. EMERGENCY ROLLBACK (if expansion fails validation)

**ONLY IF:** Total cost >$48/month OR site-wide error rate >5% OR >2 feeds CRITICAL

```sql
-- Disable all feeds added during expansion (keep original 5 + first 3)
UPDATE feed_registry SET is_active = FALSE
WHERE created_at > '2025-11-04'  -- Adjust to actual Story 2 date
  AND feed_name NOT IN (
    'NYT Politics', 'WaPo Politics', 'Politico Top', 'Reuters Politics', 'AP News US',
    'Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)'
  );

-- Purge pending jobs for disabled feeds
DELETE FROM job_queue
WHERE feed_id IN (
  SELECT id FROM feed_registry
  WHERE created_at > '2025-11-04'
    AND feed_name NOT IN (
      'NYT Politics', 'WaPo Politics', 'Politico Top', 'Reuters Politics', 'AP News US',
      'Christian Science Monitor', 'PBS NewsHour', 'Time (Politics)'
    )
)
AND processed_at IS NULL;

-- Verify rollback (should show 8 active: 5 original + 3 from Story 2)
SELECT COUNT(*) as active_feeds
FROM feed_registry
WHERE is_active = TRUE;
```

**Expected:** 8 active feeds (5 original + 3 from Story 2)

**After rollback:** Document root cause in handoff, tune worker capacity or disable problematic individual feeds, retry Story 4 after fixes.

---

### 8. GO/NO-GO Decision (48 hours after Story 4)

**Decision Point:** Is the 15-feed system stable and under budget?

**Objective Criteria:**

| Metric | RED FLAG (rollback) | YELLOW (tune/disable) | GREEN (success) |
|---|---|---|---|
| **Total monthly cost** | >$48 | $45-48 | <$45 |
| **Site-wide error rate** | >5% | 3-5% | <3% |
| **CRITICAL feeds** | ≥2 feeds | 1 feed | 0 feeds |
| **Single-article stories** | >30% of active stories | 20-30% | <20% |
| **Over-clustered stories** | >10 stories with >10 articles | 5-10 stories | <5 stories |
| **Underperforming feeds** | >3 feeds with <0.3 articles/fetch | 2-3 feeds | <2 feeds |

**Decision:**
- **RED FLAG = ROLLBACK** to 8 feeds (use Emergency Rollback above)
- **YELLOW = SELECTIVE DISABLE** — Disable 2-3 worst performers, keep rest
- **GREEN = SUCCESS** — Close epic, document in handoff

**Query for decision:**
```sql
-- Comprehensive GO/NO-GO validation
WITH metrics AS (
  SELECT
    (SELECT SUM(total_cost_24h_usd * 30) FROM admin.feed_cost_attribution) as monthly_cost,
    (SELECT COUNT(*) FROM admin.feed_health_overview WHERE health_status = 'CRITICAL') as critical_feeds,
    (SELECT COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM stories WHERE status = 'active'), 0)
     FROM stories WHERE status = 'active'
       AND (SELECT COUNT(*) FROM article_story WHERE story_id = stories.id) = 1
    ) as pct_single_article,
    (SELECT COUNT(*) FROM (
       SELECT story_id FROM article_story GROUP BY story_id HAVING COUNT(*) > 10
     ) sub
    ) as over_clustered_count,
    (SELECT COUNT(*) FROM admin.feed_health_overview
     WHERE health_status != 'INACTIVE'
       AND articles_24h::numeric / NULLIF(fetches_24h, 0) < 0.3
    ) as underperformer_count
)
SELECT
  'Monthly Cost' as metric,
  ROUND(monthly_cost::numeric, 2) as value,
  CASE
    WHEN monthly_cost > 48 THEN '🔴 RED FLAG'
    WHEN monthly_cost > 45 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END as status
FROM metrics

UNION ALL

SELECT
  'Critical Feeds',
  critical_feeds,
  CASE
    WHEN critical_feeds >= 2 THEN '🔴 RED FLAG'
    WHEN critical_feeds = 1 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM metrics

UNION ALL

SELECT
  'Single-Article Stories %',
  ROUND(pct_single_article, 1),
  CASE
    WHEN pct_single_article > 30 THEN '🔴 RED FLAG'
    WHEN pct_single_article > 20 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM metrics

UNION ALL

SELECT
  'Over-Clustered Stories',
  over_clustered_count,
  CASE
    WHEN over_clustered_count > 10 THEN '🔴 RED FLAG'
    WHEN over_clustered_count > 5 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM metrics

UNION ALL

SELECT
  'Underperforming Feeds',
  underperformer_count,
  CASE
    WHEN underperformer_count > 3 THEN '🔴 RED FLAG'
    WHEN underperformer_count > 1 THEN '🟡 YELLOW'
    ELSE '🟢 GREEN'
  END
FROM metrics;
```

**Expected Output:**
```
metric                      | value | status
----------------------------+-------+-------------
Monthly Cost                | 42.00 | 🟢 GREEN
Critical Feeds              |     0 | 🟢 GREEN
Single-Article Stories %    |  18.5 | 🟢 GREEN
Over-Clustered Stories      |     3 | 🟢 GREEN
Underperforming Feeds       |     1 | 🟢 GREEN
```

**If all GREEN:** ✅ Epic complete — 15-feed system is stable and cost-effective
**If 1-2 YELLOW:** ⚠️ Selective tuning — Disable worst performers, keep rest
**If any RED:** 🛑 Full rollback to 8 feeds

---

### 9. Create Handoff Document

**File:** `docs/handoffs/2025-11-XX-rss-expansion-complete.md`

**Content sections:**
- Final feed count (15) and health status
- Cost breakdown per feed and total
- Clustering quality assessment results
- Feeds disabled or tuned (if any)
- Lessons learned
- Known issues or follow-ups
- Operations runbook location
- Next steps (if any)

### 9. Update JIRA
- Mark all stories in epic complete
- Add final comment to epic with:
  - Final metrics (feeds, cost, error rate)
  - Link to handoff document
  - Link to operations runbook
- Close epic

---

## Summary

**Epic:** RSS Feed Expansion - Ad Fontes Green Box Sources
**Total Stories:** 5
**Total Effort:** 7 story points
**Timeline:** 3 weeks

**Story Breakdown:**
1. Monitor Existing (1 pt, 48h) — Baseline health check
2. Add First 3 Feeds (1 pt) — CSM, PBS, Time
3. Monitor First 3 (1 pt, 48h) — Validation gate
4. Add Remaining 7 Feeds (2 pts) — Full rollout
5. Final Validation + Runbook (2 pts, 48h) — Performance tuning

**Target State:** 15 feeds from Ad Fontes green box, <3% errors, <$45/month, excerpt-only compliance

---

## Rollout Schedule (Condensed)

**Week 1:** 48h monitor → add CSM + PBS + Time → 48h monitor

**Week 2:** Add remaining 7 → 48h monitor → tune tiers/frequency

**Week 3:** Buffer + finalize runbook + handoff

---

## Definition of Done

- [ ] 15 active feeds, <3% errors, <$45/mo projected cost
- [ ] Clustering quality confirmed (manual spot-checks documented)
- [ ] Runbook + dashboard snapshots attached in handoff
- [ ] JIRA epic closed with metrics and lessons learned
- [ ] All paywalled sources using excerpt-only rendering (verified)

---

## Notes & Risks

**Compliance:**
- Paywalled/long-form outlets MUST remain excerpt-only (Atlantic, New Yorker, Foreign Affairs, Fortune)
- Never store full text beyond RSS excerpt
- Attribution (source name + link) must be visible

**Publisher Changes:**
- Some publishers change RSS endpoints without notice
- If 403/404, verify URL and add User-Agent header
- Disable if unstable after 3 days

**Feed Scoping:**
- Keep politics-scoped feeds to avoid topic noise and cost
- Prefer `/politics/` paths over `/all/` or site-wide feeds

**Wire Duplication:**
- Multiple feeds may carry same AP/Reuters wire stories
- Rely on clustering + URL hash deduplication
- Consider rule to collapse near-identical wire copies (future enhancement)

---

**Last Updated:** November 4, 2025
**Status:** Ready for JIRA
**Owner:** Josh (Product Manager)
**Maintained by:** Josh + Claude Code

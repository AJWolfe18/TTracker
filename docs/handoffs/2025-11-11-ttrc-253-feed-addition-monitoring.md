# TTRC-253: Feed Addition Monitoring Guide

**Date:** 2025-11-11
**Feeds Added:** Christian Science Monitor, PBS NewsHour Politics, Time Politics
**Start Time:** 03:45 UTC (11:45 PM EST Nov 10)
**Status:** Initial ingestion successful, monitoring in progress

---

## ✅ Initial Results (0-15 min)

**Feeds Added:**
- CSM Politics (feed_id=175, tier=2, source_tier=1)
- PBS Politics (feed_id=176, tier=2, source_tier=1)
- Time Politics (feed_id=178, tier=2, source_tier=2)

**Ingestion Summary:**
- **CSM**: 5 articles ingested ✅
- **PBS**: 44 articles ingested ✅
- **Time**: 0 articles (feed empty, as expected) ✅
- **Total**: 49 new articles

**System Health:**
- All 3 feeds: `failure_count=0`, `is_active=true` ✅
- Job queue: 0 pending jobs (all processed) ✅
- Worker: Running successfully (Process ID: 50d0b8) ✅
- Stories: 552 → 553 (+1 new story created) ✅
- Clustering: Working correctly ✅
- Enrichment: Working ($0.000499 cost for 1 story) ✅

**Compliance:**
- All 3 feeds have 1200-char excerpt limits configured ✅
- `feed_compliance_rules` entries created ✅

---

## 📊 Monitoring Checkpoints

### 30-Minute Check (04:15 UTC)

```sql
-- Article counts by feed
SELECT
  CASE
    WHEN source_domain = 'rss.csmonitor.com' THEN 'CSM'
    WHEN source_domain = 'pbs.org' THEN 'PBS'
    WHEN source_domain = 'time.com' THEN 'Time'
  END AS feed,
  COUNT(*) as articles,
  MAX(created_at) as latest_article
FROM articles
WHERE source_domain IN ('rss.csmonitor.com', 'pbs.org', 'time.com')
GROUP BY source_domain;

-- Feed health status
SELECT
  id, feed_name, failure_count, last_fetched, is_active
FROM feed_registry
WHERE id IN (175, 176, 178)
ORDER BY id;

-- Job queue status
SELECT
  status, COUNT(*)
FROM job_queue
WHERE feed_id IN (175, 176, 178)
GROUP BY status;
```

**Expected:**
- CSM: 5-10 articles (minimal updates expected)
- PBS: 44-60 articles (active publisher)
- Time: 0-5 articles (may publish sporadically)
- All feeds: `failure_count=0`

### 1-Hour Check (04:45 UTC)

Same queries as 30-min, plus:

```sql
-- Check for errors
SELECT
  job_type, error, COUNT(*)
FROM job_queue
WHERE feed_id IN (175, 176, 178)
  AND status = 'failed'
GROUP BY job_type, error;

-- Story creation rate
SELECT COUNT(*) as total_stories
FROM stories
WHERE created_at > '2025-11-11 03:45:00';
```

**Expected:**
- No failed jobs
- 1-3 new stories created

### 2-Hour Check (05:45 UTC)

**Acceptance Criteria Validation:**
- [ ] CSM: 5-15 articles, failure_count=0
- [ ] PBS: 44-80 articles, failure_count=0
- [ ] Time: 0-10 articles, failure_count=0
- [ ] No errors in job_queue for these feeds
- [ ] Articles clustering correctly into stories
- [ ] All feeds HEALTHY status

**If all criteria met:** ✅ Proceed to 4-hour checkpoint
**If any failures:** ❌ Investigate errors, check worker logs

---

## 🚨 4-Hour Flood Detection (Critical!)

**Time:** 07:45 UTC (3:45 AM EST Nov 11)

### Flood Detection Query

```sql
-- Count articles ingested in first 4 hours
SELECT
  CASE
    WHEN source_domain = 'rss.csmonitor.com' THEN 'CSM'
    WHEN source_domain = 'pbs.org' THEN 'PBS'
    WHEN source_domain = 'time.com' THEN 'Time'
  END AS feed,
  COUNT(*) as articles_4h,
  CASE
    WHEN COUNT(*) > 100 THEN '🚨 FLOOD DETECTED'
    WHEN COUNT(*) > 50 THEN '⚠️ High Volume'
    ELSE '✅ Normal'
  END as status
FROM articles
WHERE source_domain IN ('rss.csmonitor.com', 'pbs.org', 'time.com')
  AND created_at >= '2025-11-11 03:45:00'
GROUP BY source_domain;
```

**Red Flags:**
- **>100 articles from ANY feed** = FLOOD (disable immediately)
- **>50 articles** = High volume (investigate feed scope)

### Emergency Rollback (If Flood Detected)

```sql
-- Disable flooded feed(s)
UPDATE feed_registry
SET is_active = FALSE
WHERE id IN (175, 176, 178)  -- Adjust to specific feed IDs
  AND feed_name = '[FEED NAME]';  -- Replace with flooded feed

-- Purge pending jobs for flooded feed
DELETE FROM job_queue
WHERE feed_id IN (175, 176, 178)
  AND status = 'pending';

-- Check damage
SELECT COUNT(*) as articles_ingested
FROM articles
WHERE source_domain = '[DOMAIN]'  -- e.g., 'rss.csmonitor.com'
  AND created_at >= '2025-11-11 03:45:00';
```

---

## 💰 Cost Monitoring

### Real-Time Cost Estimation

```sql
-- Estimate daily cost impact from new feeds
SELECT
  CASE
    WHEN source_domain = 'rss.csmonitor.com' THEN 'CSM'
    WHEN source_domain = 'pbs.org' THEN 'PBS'
    WHEN source_domain = 'time.com' THEN 'Time'
  END AS feed,
  COUNT(*) as articles_4h,
  -- Extrapolate to daily
  COUNT(*) * 6 as projected_daily_articles,
  -- Cost per article = $0.00035 (embeddings + clustering + enrichment)
  COUNT(*) * 6 * 0.00035 as projected_daily_cost_usd,
  COUNT(*) * 6 * 0.00035 * 30 as projected_monthly_cost_usd
FROM articles
WHERE source_domain IN ('rss.csmonitor.com', 'pbs.org', 'time.com')
  AND created_at >= '2025-11-11 03:45:00'
GROUP BY source_domain;

-- Total across all 3 feeds
SELECT
  SUM(COUNT(*)) * 6 * 0.00035 * 30 as total_3feeds_monthly_cost
FROM articles
WHERE source_domain IN ('rss.csmonitor.com', 'pbs.org', 'time.com')
  AND created_at >= '2025-11-11 03:45:00';
```

**Expected:** <$0.45/month total for 3 feeds
**Red Flag:** >$0.45/month = feeds may be publishing more than expected

---

## 🎯 GO/NO-GO Decision Criteria (After 4h)

### ✅ GO Criteria (Proceed to TTRC-254)

- All 3 feeds: `failure_count = 0`
- No flood detected (all feeds <100 articles in 4h)
- Cost projection: <$0.45/month total
- Error rate: 0% (no failed jobs)
- Worker: Still running, processing jobs successfully
- Articles clustering correctly into stories

### ❌ NO-GO Criteria (Rollback/Investigation)

- ANY feed: `failure_count > 0`
- Flood detected (>100 articles from any feed)
- Cost projection: >$0.45/month
- Failed jobs in queue
- Worker crashed or stuck
- Articles not clustering (orphaned articles)

---

## 📝 Troubleshooting

### If Feed Shows Failures

```sql
-- Check error details
SELECT error, last_error, attempts, updated_at
FROM job_queue
WHERE feed_id = [FEED_ID] AND status = 'failed'
ORDER BY updated_at DESC
LIMIT 10;

-- Disable problematic feed temporarily
UPDATE feed_registry SET is_active = FALSE WHERE id = [FEED_ID];
```

### If Worker Stops

```bash
# Check if worker still running
ps aux | grep "job-queue-worker"

# Restart if needed
node scripts/job-queue-worker.js &
```

### If Articles Not Clustering

```sql
-- Check for orphaned articles (not in any story)
SELECT COUNT(*) as orphaned_articles
FROM articles a
LEFT JOIN article_story ast ON a.id = ast.article_id
WHERE a.source_domain IN ('rss.csmonitor.com', 'pbs.org', 'time.com')
  AND a.created_at >= '2025-11-11 03:45:00'
  AND ast.article_id IS NULL;
```

---

## 🔄 Next Steps After 4-Hour Checkpoint

### If GO:
1. Document final 4h metrics in JIRA TTRC-253
2. Mark TTRC-253 as Done
3. Proceed to TTRC-254 (Monitor First 3 Feeds for 48h)
4. Continue passive monitoring for next 44 hours

### If NO-GO:
1. Execute rollback for problematic feeds
2. Document issue in JIRA
3. Create investigation ticket
4. Do NOT proceed to TTRC-254 until issue resolved

---

## 📊 Quick Reference Queries

### Feed Health Dashboard

```sql
SELECT
  fr.id,
  fr.feed_name,
  fr.failure_count,
  fr.last_fetched,
  fr.is_active,
  COUNT(DISTINCT a.id) FILTER (WHERE a.created_at >= NOW() - INTERVAL '4 hours') as articles_4h,
  COUNT(DISTINCT a.id) FILTER (WHERE a.created_at >= NOW() - INTERVAL '24 hours') as articles_24h
FROM feed_registry fr
LEFT JOIN articles a ON
  (fr.id = 175 AND a.source_domain = 'rss.csmonitor.com')
  OR (fr.id = 176 AND a.source_domain = 'pbs.org')
  OR (fr.id = 178 AND a.source_domain = 'time.com')
WHERE fr.id IN (175, 176, 178)
GROUP BY fr.id, fr.feed_name, fr.failure_count, fr.last_fetched, fr.is_active
ORDER BY fr.id;
```

### Worker Status

```bash
# Check worker process
ps aux | grep "job-queue-worker"

# View recent logs (if needed)
# Worker outputs to stdout/stderr in background process
```

---

## 📌 Important Notes

1. **Time Feed Empty:** Time Politics feed had 0 items during initial fetch. This is normal - feed may publish sporadically. Monitor for updates.

2. **Source Domain Matching:** Articles identify feeds by `source_domain` (e.g., "rss.csmonitor.com", "pbs.org"), not by `feed_id` foreign key. This is expected behavior.

3. **PBS URL Discrepancy:** Feed registry has `/rss/politics` endpoint, but plan specified `/rss/headlines`. The `/rss/politics` URL is working and ingesting articles successfully.

4. **ProPublica Feed:** Feed id=177 exists with 5 failures. Not part of TTRC-253 scope - leave as-is for now.

5. **Reuters/AP Feeds:** Still failing (22 failures each). Not blocking TTRC-253 - can address separately.

---

**Last Updated:** 2025-11-11 03:47 UTC
**Next Checkpoint:** 2025-11-11 04:15 UTC (30 min)
**Critical Checkpoint:** 2025-11-11 07:45 UTC (4 hours - flood detection)
**Worker Process:** 50d0b8 (running)

# RSS Feed Operations Runbook v2.0

**Last Updated:** 2025-11-16
**Environment:** TrumpyTracker RSS Ingestion System
**Active Feeds:** 15 (as of 2025-11-16) - Reuters & AP temporarily inactive
**Monthly Cost:** ~$3.40/month (projected)

---

## System Overview

### Architecture
```
GitHub Actions (every 2 hours)
    ↓ Triggers
Supabase Edge Function (rss-enqueue)
    ↓ Creates jobs in job_queue
Job Queue Worker (Node.js)
    ├── fetch_feed → Fetches RSS, creates articles
    ├── story.cluster → Groups related articles
    └── story.enrich → Generates AI summaries
        ↓ Writes to
Stories + Articles Tables
    ↓ Serves via
Edge Functions → Frontend
```

### Current Feed Inventory (15 Active Feeds)

**Tier 1 (High Priority - 4 feeds):**
- ~~Reuters Politics (ID 1)~~ - **INACTIVE** (RSSHub 403 errors - see TTRC-274)
- ~~AP News Top Stories (ID 2)~~ - **INACTIVE** (RSSHub 403 errors - see TTRC-274)
- Politico Trump (ID 184)
- Guardian US Politics (ID 182)
- Guardian Trump (ID 183)

**Tier 2 (Standard - 11 feeds):**
- NYT Politics (ID 3)
- WaPo Politics (ID 4)
- Christian Science Monitor (ID 175)
- PBS NewsHour Politics (ID 176)
- ProPublica (ID 177)
- Time (ID 178)
- The Economist (ID 181)
- Newsweek (ID 185)
- The Atlantic (ID 186)
- Reason (ID 187)
- Fortune (ID 188)
- Vox (ID 189)

**Tier 3 (Low Priority - 2 feeds):**
- Politico Top (ID 5)
- Foreign Affairs (ID 190)
- The New Yorker (ID 191)

---

## Third-Party RSS Solutions (RSSHub)

### Background
Reuters and AP News discontinued their official RSS feeds in 2019-2020. We use **RSSHub**, a free open-source RSS scraper service, as a workaround to restore these critical Tier 1 sources.

### Current Configuration

**Reuters Politics (Feed ID 1):**
- URL: `https://rsshub.ktachibana.party/reuters/world/us`
- Focus: US news with strong politics coverage
- Alternative tested: `reuters/legal/government` (rejected - too narrow, includes international legal news)

**AP News Top Stories (Feed ID 2):**
- URL: `https://rsshub.ktachibana.party/apnews/topics/apf-topnews`
- Focus: Top news (includes major political stories)
- Note: No politics-only feed available in RSSHub

### How It Works

**Filtering Rules Apply Normally:**
- ✅ Federal keyword matching (Congress, DOJ, FBI, etc.)
- ✅ Trump boost (+2 score)
- ✅ Path filtering (politics paths boosted, local/opinion blocked)
- ✅ Local news blocking (city council, mayor, etc.)

**Compliance Rules:**
- ✅ 5000 character excerpt limits configured
- ✅ Source deduplication works normally
- ✅ Article scraping still happens (full content from source sites)

**What RSSHub Does:**
- Scrapes Reuters/AP websites on-demand
- Generates RSS feeds from HTML content
- Runs on free community instance (`rsshub.ktachibana.party`)
- Updates every 5 minutes (RSSHub cache TTL)

### Monitoring Requirements (TTRC-273)

**Check weekly for 4-6 weeks:**

1. **Feed Fetch Success Rate:**
   ```sql
   SELECT source_name, failure_count, last_fetched_at, is_active
   FROM feed_registry
   WHERE id IN (1, 2);
   ```
   - Target: >95% success rate
   - Alert if `failure_count > 3`

2. **Article Quality Check:**
   ```sql
   SELECT COUNT(*), source_name
   FROM articles
   WHERE created_at > NOW() - INTERVAL '7 days'
   AND source_name IN ('Reuters Politics', 'AP News Top Stories')
   GROUP BY source_name;
   ```
   - Reuters: Expect 30-50 articles/week
   - AP News: Expect 50-100 articles/week

3. **RSSHub Instance Uptime:**
   - Test URL directly: `curl -I https://rsshub.ktachibana.party/reuters/world/us`
   - Should return `200 OK` with `rsshub-cache-status` header
   - Alert if 403/404/500 errors persist >1 hour

### Troubleshooting

**Problem: Feed returning 403 Forbidden**
- **Cause:** RSSHub instance IP may be blocked by Reuters/AP
- **Solution:** Switch to different RSSHub public instance (see Backup Plans below)

**Problem: Feed returning 404 Not Found**
- **Cause:** RSSHub instance may be down or route changed
- **Solution:** Check https://docs.rsshub.app/ for route updates, or switch instance

**Problem: Articles have truncated content**
- **Cause:** RSSHub only provides excerpt (normal behavior)
- **Note:** Our article scraper fetches full content separately - this is expected

**Problem: Zero articles ingested for 24+ hours**
- **Cause:** RSSHub instance may be down or overloaded
- **Solution:** Check instance health, switch to backup instance if needed

### Backup Plans

**If RSSHub public instance becomes unreliable:**

**Option A: Switch to Different RSSHub Instance** (10 minutes)
```sql
-- Test alternative instances first:
-- https://rsshub.rssforever.com/reuters/world/us
-- https://rsshub.feeded.xyz/reuters/world/us

UPDATE feed_registry
SET feed_url = 'https://[new-instance]/reuters/world/us'
WHERE id = 1;

UPDATE feed_registry
SET feed_url = 'https://[new-instance]/apnews/topics/apf-topnews'
WHERE id = 2;
```

**Option B: Self-Host RSSHub on Railway** (2 hours setup, $0-5/month)
- Deploy via Railway.app (free tier: 500 hours/month)
- One-click deploy from https://github.com/DIYgod/RSSHub
- Point feed URLs to your instance
- Monthly cost: $0 (free tier) or $5 (if exceeding limits)

**Option C: Mark Feeds Inactive** (last resort)
```sql
UPDATE feed_registry
SET is_active = false,
    filter_config = filter_config || '{"deactivation_reason": "RSSHub unreliable"}'::jsonb
WHERE id IN (1, 2);
```

### Success Criteria

After 4 weeks of monitoring:
- [ ] Feed fetch success rate >95%
- [ ] Article content quality maintained
- [ ] No service disruptions >4 hours
- [ ] No false positives from filtering

If criteria met: Continue using RSSHub indefinitely
If criteria not met: Execute Backup Plan A or B

### Links
- RSSHub Documentation: https://docs.rsshub.app/
- RSSHub GitHub: https://github.com/DIYgod/RSSHub
- Instance Used: https://rsshub.ktachibana.party/
- Alternative Instances: https://docs.rsshub.app/guide/instances
- Monitoring Card: TTRC-273

---

## Daily Monitoring Procedures

### Morning Health Check (9:00 AM)
Run these queries in Supabase Dashboard → SQL Editor:

**1. Check Feed Health**
```sql
SELECT
  id,
  source_name,
  is_active,
  failure_count,
  tier,
  last_fetched_at,
  EXTRACT(HOUR FROM (NOW() - last_fetched_at)) AS hours_since_fetch
FROM feed_registry
WHERE is_active = true
ORDER BY failure_count DESC, hours_since_fetch DESC;
```

**Expected:**
- All feeds: `failure_count = 0`
- All feeds: `hours_since_fetch < 4` (fetched within last 4 hours)

**Alert if:**
- Any feed: `failure_count > 3`
- Any feed: `hours_since_fetch > 6`

**2. Check Article Ingestion (Last 24h)**
```sql
SELECT
  source_name,
  COUNT(*) AS articles_24h,
  MAX(created_at) AS last_article
FROM articles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_name
ORDER BY articles_24h DESC;
```

**Expected:**
- Tier 1 feeds: 4-12 articles/day
- Tier 2 feeds: 2-8 articles/day
- Tier 3 feeds: 1-4 articles/day

**Alert if:**
- Any Tier 1/2 feed: 0 articles in 24h
- Total articles < 30/day (system-wide issue)

**3. Check Active Stories**
```sql
SELECT
  status,
  COUNT(*) AS story_count
FROM stories
GROUP BY status
ORDER BY story_count DESC;
```

**Expected:**
- `active`: 80-120 stories
- `closed`: Increasing over time

**Alert if:**
- `active` < 50 (ingestion problem)
- `active` > 200 (clustering problem)

### Evening Spot Check (5:00 PM)
Quick validation query:

```sql
SELECT
  (SELECT COUNT(*) FROM feed_registry WHERE is_active = true AND failure_count > 0) AS failing_feeds,
  (SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '6 hours') AS articles_6h,
  (SELECT COUNT(*) FROM stories WHERE status = 'active') AS active_stories;
```

**Expected:**
- `failing_feeds`: 0
- `articles_6h`: 15-40
- `active_stories`: 80-120

**Alert if any value outside expected range.**

---

## Alert Thresholds

### Critical Alerts (Immediate Action Required)

**Feed Failures:**
- ✅ **Threshold:** Any feed with `failure_count >= 5`
- 🔴 **Action:** Investigate immediately, disable if persistent
- 📊 **Check:** `SELECT * FROM feed_registry WHERE failure_count >= 5`

**System Outage:**
- ✅ **Threshold:** 0 articles created in last 4 hours
- 🔴 **Action:** Check GitHub Actions, worker status, Edge Function logs
- 📊 **Check:** `SELECT COUNT(*) FROM articles WHERE created_at > NOW() - INTERVAL '4 hours'`

**Cost Spike:**
- ✅ **Threshold:** Daily spend > $0.50 (projected monthly > $15)
- 🔴 **Action:** Check OpenAI usage, disable story enrichment if needed
- 📊 **Check:** Supabase → Functions → rss-enqueue logs

### Warning Alerts (Monitor Closely)

**Feed Underperformance:**
- ⚠️ **Threshold:** Tier 1/2 feed with 0 articles in 24h
- 🟡 **Action:** Verify feed still publishing, check filter configs
- 📊 **Check:** Article ingestion query (see Morning Health Check #2)

**Clustering Quality:**
- ⚠️ **Threshold:** >30% of stories have only 1 article
- 🟡 **Action:** Review clustering algorithm parameters
- 📊 **Check:**
  ```sql
  SELECT
    COUNT(CASE WHEN article_count = 1 THEN 1 END) * 100.0 / COUNT(*) AS pct_single_article
  FROM (
    SELECT story_id, COUNT(*) AS article_count
    FROM article_story
    GROUP BY story_id
  ) sub;
  ```

**Stale Feeds:**
- ⚠️ **Threshold:** Feed not fetched in >12 hours
- 🟡 **Action:** Check GitHub Actions cron, Edge Function errors
- 📊 **Check:** Feed health query (see Morning Health Check #1)

---

## Common Feed Management Procedures

### Disable a Feed (Temporarily)
```sql
UPDATE feed_registry
SET is_active = false
WHERE id = <FEED_ID>;
```

**When to disable:**
- `failure_count` reaches 5
- Feed confirmed discontinued by publisher
- Feed violating copyright/ToS
- Feed producing low-quality content

**Document reason in JIRA!**

### Re-Enable a Feed
```sql
UPDATE feed_registry
SET
  is_active = true,
  failure_count = 0
WHERE id = <FEED_ID>;
```

**Before re-enabling:**
- ✅ Verify feed URL still works (test manually in browser)
- ✅ Confirm RSS feed not discontinued
- ✅ Check filter_config is appropriate
- ✅ Test fetch manually via Edge Function

### Reset Failure Count
```sql
UPDATE feed_registry
SET failure_count = 0
WHERE id = <FEED_ID>;
```

**When to reset:**
- After fixing feed URL
- After temporary publisher outage resolved
- After false positive errors (e.g., network blip)

### Add New Feed
```sql
-- 1. Add feed to feed_registry
INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
VALUES (
  '<RSS_URL>',
  '<Feed Name>',
  '<Source Name>',
  ARRAY['politics', 'trump'],
  2,  -- Tier 1, 2, or 3
  2,  -- Source quality tier
  true,
  jsonb_build_object(
    'allow', ARRAY['Trump', 'Congress', 'White House', 'Supreme Court', 'DOJ', 'federal'],
    'block', ARRAY['city council', 'mayor', 'state legislature', 'gubernatorial']
  )
);

-- 2. Add compliance rule
INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
VALUES (
  (SELECT id FROM feed_registry WHERE feed_url = '<RSS_URL>'),
  5000,
  false,
  '<Source Name>',
  '5K char limit for RSS content - matches article scraping limit'
);
```

**New feed checklist:**
- ✅ Feed URL tested manually
- ✅ RSS format validated (valid XML)
- ✅ Source is reputable (Ad Fontes green box preferred)
- ✅ Filter config prevents local/state news
- ✅ Compliance rule prevents copyright issues
- ✅ Monitored for 48 hours after activation

---

## Troubleshooting Guide

### Error: Feed Returning 403 Forbidden

**Cause:** Publisher blocking automated RSS access (CloudFront, bot protection)

**Solution:**
1. Verify User-Agent header is set in RSS fetcher:
   ```javascript
   'User-Agent': 'TrumpyTracker/1.0 (RSS Reader; Compatible; +http://trumpytracker.com/bot)'
   ```
2. Check if feed requires authentication/API key
3. Try alternate RSS endpoint (e.g., `/feed/` instead of `/politics/feed/`)
4. If persistent, disable feed and find alternative source

**Example:** Fortune Politics originally returned 403 on `/politics/feed/` but works on `/feed/`

### Error: Feed Returning 404 Not Found

**Cause:** Feed URL changed or discontinued

**Solution:**
1. Check publisher's website for updated RSS link
2. Try common RSS patterns:
   - `/rss`
   - `/feed`
   - `/rss.xml`
   - `/index.xml`
3. Search publisher site for "RSS" or "Feeds"
4. If discontinued, disable feed and notify team

**Example:** Newsweek URL corrected from `/politics/rss` to `/rss`

### Error: Feed Timeout (>30s)

**Cause:** Slow publisher server, large feed file, network issues

**Solution:**
1. Increase timeout in RSS fetcher (current: 30s)
2. Check if feed has `<limit>` parameter to reduce size
3. Monitor for intermittent vs persistent timeouts
4. If persistent, consider disabling or moving to Tier 3

### Error: "Cannot convert object to primitive value"

**Cause:** RSS feed returning unexpected data structure (likely date/metadata field)

**Solution:**
1. Check `scripts/rss/fetch_feed.js` for object coercion
2. Review RSS parser handling of `published_date`, `categories`, etc.
3. Add defensive parsing for problem feed
4. See TTRC-268, TTRC-272 for similar issues

**Recent Fix:** Centralized primitive coercion in RSS fetcher (commit beb3b95)

### Error: Duplicate Article Insert (url_hash collision)

**Cause:** Same URL published on different dates, or hash collision

**Solution:**
- ✅ **Expected behavior** - Composite unique constraint on `(url_hash, published_date)` allows same URL on different days
- No action needed unless excessive duplicates detected
- Check `attach_or_create_article` RPC if systematic issue

### Error: Story Clustering Failing

**Cause:** SimHash collision, duplicate story_hash, or clustering logic error

**Solution:**
1. Check job_queue for `story.cluster` failures
2. Review error messages for specific article IDs
3. Test clustering manually:
   ```sql
   SELECT * FROM stories WHERE story_hash = '<HASH>';
   ```
4. If duplicate story_hash, clustering retry should handle via upsert
5. Check SimHash generation logic in `scripts/lib/extraction-utils.js`

---

## Feed Compliance Verification

### Paywall Source Monitoring

**Paywalled Feeds (Excerpt Only):**
- The Atlantic (ID 186)
- Fortune (ID 188)
- Foreign Affairs (ID 190)
- The New Yorker (ID 191)

**Verify Compliance:**
```sql
SELECT
  fcr.source_name,
  fcr.max_chars,
  fcr.allow_full_text,
  AVG(LENGTH(a.content_excerpt)) AS avg_excerpt_length
FROM feed_compliance_rules fcr
JOIN feed_registry fr ON fcr.feed_id = fr.id
JOIN articles a ON a.feed_id = fr.id
WHERE a.created_at > NOW() - INTERVAL '7 days'
GROUP BY fcr.source_name, fcr.max_chars, fcr.allow_full_text
ORDER BY fcr.source_name;
```

**Expected:**
- `allow_full_text`: `false` for all paywalled sources
- `avg_excerpt_length`: <5000 chars (max_chars limit enforced)

**Alert if:**
- `allow_full_text = true` for paywall source (copyright violation risk)
- `avg_excerpt_length > max_chars` (limit not enforced)

### Content Limit Enforcement

**All feeds must respect 5000-character limit:**
```sql
SELECT
  source_name,
  COUNT(*) AS articles,
  MAX(LENGTH(content_excerpt)) AS max_excerpt_len,
  AVG(LENGTH(content_excerpt)) AS avg_excerpt_len
FROM articles
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source_name
ORDER BY max_excerpt_len DESC;
```

**Alert if:**
- `max_excerpt_len > 5000` (compliance rule not working)

---

## Cost Management

### Current Cost Structure
- **RSS Fetching:** $0/month (GitHub Actions free tier)
- **Edge Functions:** <$0.10/month (minimal calls)
- **Database:** $0/month (free tier)
- **OpenAI Story Enrichment:** ~$3.30/month (17 feeds × 3-5 stories/day × $0.0015/story)
- **Total:** ~$3.40/month

### Budget Alerts
```sql
SELECT
  day,
  spent_usd,
  openai_calls
FROM budgets
WHERE day > NOW() - INTERVAL '7 days'
ORDER BY day DESC;
```

**Expected:**
- `spent_usd`: $0.10-0.15/day (~$3-4.50/month)
- `openai_calls`: 15-25/day

**Alert if:**
- Daily spend > $0.50 (projected $15/month)
- OpenAI calls > 50/day (enrichment runaway)

**Emergency Cost Cutoff:**
If monthly cost approaches $45 budget:
1. Disable story enrichment temporarily
2. Reduce RSS fetch frequency to 4-hour intervals
3. Disable Tier 3 feeds
4. Review filter configs to increase drop rates

---

## GitHub Actions Maintenance

### Current Schedule
- **Workflow:** `.github/workflows/job-scheduler.yml`
- **Frequency:** Every 2 hours (`0 */2 * * *`)
- **Trigger:** Calls `rss-enqueue` Edge Function

### Check Workflow Status
1. Go to GitHub → Actions → "Test Environment - Daily Tracker"
2. Verify recent runs show ✅ Success
3. Check run duration (<2 minutes expected)

### Manual Trigger
```bash
# Via GitHub CLI
gh workflow run "Test Environment - Daily Tracker" --ref test

# Via GitHub UI
Actions → Test Environment - Daily Tracker → Run workflow → Branch: test → Run workflow
```

### Troubleshooting Failed Runs
1. Click failed run → View logs
2. Common issues:
   - Edge Function timeout (increase timeout in workflow)
   - Invalid `EDGE_CRON_TOKEN` (rotate secret)
   - Supabase Edge Function down (check Supabase status)

---

## Worker Monitoring

### Check Worker Status (Local/Server)
```bash
# Check if worker is running
ps aux | grep "job-queue-worker"

# View worker logs (last 50 lines)
tail -n 50 worker-*.log

# Monitor live worker output
tail -f worker-*.log
```

### Expected Worker Behavior
- Processes jobs from `job_queue` table
- Completes `fetch_feed` jobs in <60s each
- Completes `story.cluster` jobs in <10s each
- Completes `story.enrich` jobs in <30s each (OpenAI call)

### Worker Not Processing Jobs
**Check:**
1. Worker running: `ps aux | grep job-queue-worker`
2. Jobs exist: `SELECT COUNT(*) FROM job_queue WHERE status = 'pending'`
3. Worker errors: `grep ERROR worker-*.log`

**Restart worker:**
```bash
# Kill existing worker
pkill -f job-queue-worker

# Start new worker
node scripts/job-queue-worker.js > worker-$(date +%Y%m%d-%H%M%S).log 2>&1 &
```

---

## Data Retention & Cleanup

### Story Lifecycle
- **Active:** 0-72 hours since `last_updated_at`
- **Closed:** 72+ hours (archived from main view)
- **Archived:** 90+ days (future: move to cold storage)

### Job Queue Cleanup
- Auto-delete completed jobs after 7 days (database trigger)
- Failed jobs retained for debugging

### Manual Cleanup (if needed)
```sql
-- Delete old completed jobs
DELETE FROM job_queue
WHERE status = 'completed'
  AND completed_at < NOW() - INTERVAL '7 days';

-- Archive old closed stories (future feature)
UPDATE stories
SET status = 'archived'
WHERE status = 'closed'
  AND last_updated_at < NOW() - INTERVAL '90 days';
```

---

## Escalation Contacts

**System Owner:** Josh (Product Manager)
**Technical Support:** Claude Code (AI Assistant)
**Supabase Status:** https://status.supabase.com
**GitHub Status:** https://www.githubstatus.com

---

## Appendix: Useful Queries

### Find Underperforming Feeds
```sql
SELECT
  fr.id,
  fr.source_name,
  COUNT(a.id) AS articles_7d,
  COUNT(a.id)::float / 7 AS articles_per_day
FROM feed_registry fr
LEFT JOIN articles a ON a.feed_id = fr.id AND a.created_at > NOW() - INTERVAL '7 days'
WHERE fr.is_active = true
GROUP BY fr.id, fr.source_name
HAVING COUNT(a.id)::float / 7 < 2
ORDER BY articles_per_day ASC;
```

### Check Clustering Quality
```sql
SELECT
  COUNT(*) FILTER (WHERE article_count = 1) * 100.0 / COUNT(*) AS pct_single_article,
  COUNT(*) FILTER (WHERE article_count > 10) AS over_clustered_count,
  AVG(article_count) AS avg_articles_per_story
FROM (
  SELECT story_id, COUNT(*) AS article_count
  FROM article_story
  JOIN stories ON stories.id = article_story.story_id
  WHERE stories.status = 'active'
  GROUP BY story_id
) sub;
```

### Recent Feed Errors
```sql
SELECT
  job_type,
  job_data->>'feed_id' AS feed_id,
  error_message,
  failed_at,
  COUNT(*) AS error_count
FROM job_queue
WHERE status = 'failed'
  AND failed_at > NOW() - INTERVAL '24 hours'
GROUP BY job_type, job_data->>'feed_id', error_message, failed_at
ORDER BY failed_at DESC;
```

---

**Document Version:** 2.0
**Last Reviewed:** 2025-11-16
**Next Review:** 2025-12-16 (monthly)

# Future Enhancements (Nice-to-Haves)

**Status:** Deferred for post-stabilization
**Priority:** Medium-Low
**Estimated Effort:** 2-4 weeks total

---

## Purpose

This document tracks enhancement ideas that are NOT critical for initial RSS v2 deployment but would provide incremental value after the system stabilizes.

**Defer until:**
- RSS v2 deployed and stable in PROD (2+ weeks)
- 15+ feeds operational without issues
- Cost tracking validated and accurate
- No critical bugs or performance issues

---

## 1. Exponential Backoff for Repeated Errors

### Current Behavior
- Failed feeds retry at same interval regardless of failure count
- No differentiation between transient and persistent failures
- Can waste resources polling broken feeds

### Proposed Enhancement
**Adaptive backoff based on consecutive failures:**

```
Failure Count | Current Interval | Proposed Interval
--------------|------------------|-------------------
0             | 2 hours          | 2 hours (no change)
1             | 2 hours          | 30 minutes (first retry fast)
2-3           | 2 hours          | 1 hour
4-6           | 2 hours          | 2 hours
7-10          | 2 hours          | 4 hours (max cap)
11+           | 2 hours          | Auto-disable feed
```

**Implementation:**
- Already partially implemented in `admin.feed_activity_hints` view
- Need to update Edge Function scheduler to respect `suggested_interval_seconds`
- Add auto-disable logic at 11+ failures

**Benefits:**
- Reduces wasted API calls to broken feeds
- Faster recovery for transient failures
- Automatic cleanup of permanently broken sources

**Effort:** 4-6 hours (Edge Function updates + testing)

---

## 2. Per-Feed Daily Fetch Cap

### Current Behavior
- No per-feed limits on fetch frequency
- Scheduler could theoretically poll same feed hundreds of times if bugs exist
- Budget protection only at global level ($50/month cap)

### Proposed Enhancement
**Hard daily fetch limit per feed:**

```sql
ALTER TABLE public.feed_registry
  ADD COLUMN IF NOT EXISTS daily_fetch_cap INTEGER DEFAULT 24;
```

**Enforcement logic:**
```sql
-- In scheduler: check fetch count before enqueuing
SELECT
  COALESCE(SUM(fetch_count), 0) < f.daily_fetch_cap AS can_fetch
FROM feed_metrics m
JOIN feed_registry f ON f.id = m.feed_id
WHERE m.metric_date = CURRENT_DATE
  AND m.feed_id = $1;
```

**Default caps by tier:**
- Tier 1 (critical): 24 fetches/day (every hour)
- Tier 2 (important): 12 fetches/day (every 2 hours)
- Tier 3 (nice-to-have): 4 fetches/day (every 6 hours)

**Benefits:**
- Budget protection at feed level
- Prevents runaway polling bugs
- Enforces tier-based priorities

**Effort:** 8 hours (schema + scheduler + testing)

---

## 3. Slack Webhook Alerts

### Current Behavior
- Email alerts via IFTTT (legacy, limited)
- No real-time error notifications
- Manual dashboard checks required

### Proposed Enhancement
**Replace IFTTT with direct Slack webhooks:**

**Alert triggers:**
```
Severity  | Condition                          | Throttle
----------|------------------------------------|-----------
CRITICAL  | health_status = 'CRITICAL'         | Max 1/hour
WARNING   | health_status = 'DEGRADED'         | Max 1/4 hours
INFO      | New feed added                     | Immediate
INFO      | Feed disabled (11+ failures)       | Immediate
DAILY     | Cost summary (if >80% of budget)   | 1/day at 9am
```

**Slack message format:**
```
🚨 CRITICAL: Feed "NYT Politics" Failing
Error rate: 52% (13/25 fetches)
Failure count: 11 (auto-disabled)
Last error: "Connection timeout after 30s"
View dashboard: [link]
```

**Implementation:**
- Create `alert_webhooks` table (feed_id, webhook_url, alert_types)
- Add Supabase Edge Function: `send-alert`
- Trigger via database function or scheduled job

**Benefits:**
- Real-time error visibility
- Faster incident response
- Budget overrun warnings

**Effort:** 12 hours (webhook table + Edge Function + testing)

---

## 4. Cost Model Configuration Knobs

### Current Behavior
- Cost constants hardcoded in SQL view comments
- No easy way to adjust costs without migration
- Can't A/B test different cost models

### Proposed Enhancement
**Externalize cost config to database table:**

```sql
CREATE TABLE IF NOT EXISTS admin.cost_model_config (
  config_key TEXT PRIMARY KEY,
  cost_per_unit NUMERIC NOT NULL,
  unit_type TEXT NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO admin.cost_model_config (config_key, cost_per_unit, unit_type, notes)
VALUES
  ('openai_embeddings', 0.0002, 'article', 'OpenAI text-embedding-3-small'),
  ('story_clustering', 0.00015, 'article', 'Vector similarity compute'),
  ('story_enrichment', 0.000167, 'story', 'GPT-4o-mini summary generation');
```

**Update cost attribution view to reference config:**
```sql
SELECT
  f.id AS feed_id,
  f.feed_name,
  articles_24h,
  -- Dynamic cost calculation
  articles_24h * (
    SELECT SUM(cost_per_unit)
    FROM admin.cost_model_config
    WHERE unit_type = 'article'
  ) AS total_cost_24h_usd
FROM ...
```

**Benefits:**
- Easy cost model updates (no migration needed)
- Historical cost tracking (via updated_at)
- A/B testing different models

**Effort:** 6 hours (table + view refactor + backfill)

---

## 5. Feed Health Dashboards (UI)

### Current Behavior
- Health data exists in SQL views
- No visual dashboard
- Requires manual SQL queries to monitor

### Proposed Enhancement
**Simple HTML dashboard (no framework needed):**

**Features:**
- Real-time health overview (color-coded by status)
- 7-day sparklines for article volume
- Error rate trends
- Cost attribution pie chart
- Auto-refresh every 60 seconds

**Tech stack:**
- Vanilla JS (fetch from admin views)
- Chart.js for visualizations
- Tailwind CSS for styling
- Host as static page on Netlify

**Benefits:**
- Visual monitoring at-a-glance
- Easier to spot trends
- Shareable with stakeholders

**Effort:** 16 hours (UI build + charts + responsive design)

---

## 6. Intelligent Feed Discovery

### Current Behavior
- Manual feed addition only
- No suggestions for related feeds
- Hard to scale beyond 15-20 feeds

### Proposed Enhancement
**Auto-discover feeds from existing articles:**

**Logic:**
```
For each article in top 10 high-performing stories:
  1. Extract domain
  2. Check if feed_registry has feed for that domain
  3. If not:
    a. Search domain for RSS/Atom feed links
    b. Validate feed format and activity level
    c. Suggest to admin with sample articles
```

**Suggestion format:**
```
Suggested Feed: "The Hill - Politics"
Domain: thehill.com
Feed URL: https://thehill.com/news/feed
Activity: ~15 articles/day
Sample articles: [3 recent headlines]
Action: [Add to Tier 2] [Add to Tier 3] [Ignore]
```

**Benefits:**
- Faster feed expansion
- Discover high-quality sources automatically
- Reduce manual research time

**Effort:** 20 hours (feed discovery + validation + UI)

---

## Implementation Priority

**Recommended order (if/when resources available):**

1. ✅ **Exponential Backoff** (4-6 hours) - Highest ROI, simple
2. ✅ **Per-Feed Fetch Cap** (8 hours) - Important safety net
3. ⏹️ **Slack Webhooks** (12 hours) - Better than IFTTT, moderate effort
4. ⏹️ **Cost Model Knobs** (6 hours) - Nice-to-have, low priority
5. ⏹️ **Health Dashboards** (16 hours) - Cosmetic, defer until >20 feeds
6. ⏹️ **Feed Discovery** (20 hours) - Scaling feature, defer until >30 feeds

**Total estimated effort if all implemented:** 66 hours (~2 weeks)

---

## Notes

- All enhancements assume RSS v2 base system is stable
- Exponential backoff is PARTIALLY implemented (views have logic, scheduler needs updates)
- Slack webhooks would replace existing IFTTT email alerts
- Cost model knobs provide flexibility but add complexity - defer unless needed
- UI dashboards are cosmetic - SQL views are sufficient for now
- Feed discovery is scaling feature - only needed at >30 feeds

**Last Updated:** 2025-10-25
**Status:** Documented, not prioritized for initial deployment

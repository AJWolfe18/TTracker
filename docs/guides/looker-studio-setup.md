# Looker Studio Dashboard Setup Guide

This guide walks you through setting up a TrumpyTracker analytics dashboard in Looker Studio that combines GA4 data with Supabase database data.

> **Environment Note:** This guide connects to **TEST** environment (Supabase TEST database). Data shown is development/test data, not production. For stakeholder-facing reports, update connection to PROD database when ready.

## Why Both GA4 + Looker Studio?

| Tool | Use For |
|------|---------|
| **GA4** | Real-time monitoring, conversion setup, audience building, debugging |
| **Looker Studio** | Weekly business reports, combining multiple data sources, sharing with stakeholders |

---

## Prerequisites: GA4 Custom Dimensions

Before building reports, ensure these custom dimensions are registered in GA4.

### Required Custom Dimensions

Go to **GA4 → Admin → Custom definitions → Custom dimensions** and verify/create:

| Dimension Name | Scope | Event Parameter | Status |
|----------------|-------|-----------------|--------|
| target_type | Event | target_type | ✅ Registered |
| source_domain | Event | source_domain | ✅ Registered |
| content_type | Event | content_type | ✅ Registered |
| content_id | Event | content_id | ✅ Registered |
| object_type | Event | object_type | ✅ Registered |
| action | Event | action | ✅ Registered |
| type | Event | type | ✅ Registered |
| page | Event | page | ✅ Registered |
| result | Event | result | ✅ Registered |
| signup_source | Event | signup_source | ✅ Registered |
| signup_page | Event | signup_page | ✅ Registered |
| has_results | Event | has_results | ✅ Registered |
| location | Event | location | ✅ Registered |
| error_type | Event | error_type | ✅ Registered |
| **category** | Event | category | ⚠️ **NEEDS REGISTRATION** |

### How to Register Missing Dimensions

1. Go to [analytics.google.com](https://analytics.google.com)
2. Select **TrumpyTracker** property
3. Click **Admin** (gear icon, bottom left)
4. Under **Data display**, click **Custom definitions**
5. Click **Create custom dimension**
6. Fill in:
   - **Dimension name:** `category`
   - **Scope:** Event
   - **Event parameter:** `category`
7. Click **Save**

> **Note:** New dimensions take 24-48 hours to populate with data after registration.

---

## Part 1: Connect GA4 to Looker Studio

### Step 1: Open Looker Studio
1. Go to [lookerstudio.google.com](https://lookerstudio.google.com)
2. Sign in with the same Google account that has GA4 access

### Step 2: Create New Report
1. Click **"Create"** → **"Report"**
2. You'll be prompted to add a data source

### Step 3: Add GA4 as Data Source
1. Search for **"Google Analytics"** in the connector list
2. Select **"Google Analytics"** (not Universal Analytics)
3. Authorize access if prompted
4. Select your account: **TrumpyTracker**
5. Select property: **G-5MDT4HFMNB**
6. Click **"Add"**

---

## Part 2: Connect Supabase to Looker Studio

### Option A: PostgreSQL Connection (Recommended)

#### Step 1: Create Read-Only Database User (Recommended)

For security, create a dedicated read-only user instead of using the `postgres` superuser.

In Supabase SQL Editor, run:
```sql
-- Create read-only role for analytics
CREATE ROLE looker_readonly WITH LOGIN PASSWORD 'your-secure-password-here';

-- Grant read access to public schema
GRANT USAGE ON SCHEMA public TO looker_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO looker_readonly;

-- Ensure future tables are also readable
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO looker_readonly;
```

#### Step 2: Create Analytics Views (Stable Schema)

Create views so your Looker queries don't break if table columns change:

```sql
-- View: Search gaps for content planning
-- Note: No ORDER BY in view (Looker handles sorting)
-- Always use LIMIT when querying this view
CREATE OR REPLACE VIEW analytics_search_gaps AS
SELECT
  term_sanitized,
  search_count,
  first_seen,
  last_seen
FROM search_gaps;

-- View: Story coverage by category
CREATE OR REPLACE VIEW analytics_story_coverage AS
SELECT
  category,
  COUNT(*) as story_count,
  COUNT(CASE WHEN ai_summary IS NOT NULL THEN 1 END) as enriched_count,
  ROUND(100.0 * COUNT(CASE WHEN ai_summary IS NOT NULL THEN 1 END) / COUNT(*), 1) as enrichment_pct
FROM stories
WHERE status = 'active'
GROUP BY category;

-- View: Daily story volume (last 30 days)
CREATE OR REPLACE VIEW analytics_daily_volume AS
SELECT
  DATE(created_at) as date,
  COUNT(*) as stories_created,
  COUNT(CASE WHEN ai_summary IS NOT NULL THEN 1 END) as enriched
FROM stories
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at);
```

#### Step 3: Get Connection Details

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project (**TrumpyTracker-Test** for dev, **TrumpyTracker** for prod)
3. Go to **Settings** → **Database**
4. Note these values:
   - **Host:** `db.[project-ref].supabase.co`
   - **Port:** `6543` (use connection pooler for Looker)
   - **Database:** `postgres`
   - **User:** `looker_readonly` (or `postgres` if you skipped Step 1)
   - **Password:** Your password

#### Step 4: Add PostgreSQL Data Source in Looker Studio

1. In your Looker Studio report, click **"Add data"**
2. Search for **"PostgreSQL"**
3. Select the PostgreSQL connector
4. Enter connection details:
   - **Host:** `db.wnrjrywpcadwutfykflu.supabase.co` (TEST)
   - **Port:** `6543` (connection pooler)
   - **Database:** `postgres`
   - **Username:** `looker_readonly`
   - **Password:** [your password]
   - **Enable SSL:** ✅ Yes
5. Click **"Authenticate"**

#### Step 5: Add Views as Data Sources

**Important:** Always use LIMIT for table widgets to prevent slow queries.

```sql
SELECT * FROM analytics_search_gaps ORDER BY search_count DESC LIMIT 100
```

```sql
SELECT * FROM analytics_story_coverage
```

```sql
SELECT * FROM analytics_daily_volume ORDER BY date DESC
```

### Option B: Google Sheets Bridge (Simpler, Manual)

If PostgreSQL connection is problematic:

1. Export Supabase data to CSV (manually or via script)
2. Import to Google Sheet
3. Connect Google Sheet to Looker Studio
4. Refresh manually when needed (weekly)

---

## Part 3: Dashboard Layout

### Page 1: Executive Summary

```
┌─────────────────────────────────────────────────────────────┐
│  TRUMPYTRACKER ANALYTICS                    [Date Range ▼]  │
├───────────────┬───────────────┬───────────────┬─────────────┤
│  SCORECARD    │  SCORECARD    │  SCORECARD    │  SCORECARD  │
│  Total Users  │ Content Opens │ Content       │  Outbound   │
│               │   (Events)    │ Openers       │   Clicks    │
│               │               │  (Users)      │             │
├───────────────┴───────────────┴───────────────┴─────────────┤
│                                                             │
│         LINE CHART: Daily Active Users (30 days)            │
│                                                             │
├─────────────────────────────────┬───────────────────────────┤
│      PIE CHART                  │      BAR CHART            │
│   Users by Page                 │   Top Categories          │
│   (stories/eos/pardons)         │   (filter_category)       │
└─────────────────────────────────┴───────────────────────────┘
```

### Page 2: Content Engagement

```
┌─────────────────────────────────────────────────────────────┐
│  CONTENT ENGAGEMENT                         [Date Range ▼]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│      BAR CHART: Scroll Depth Distribution                   │
│      (25% → 50% → 75% → 100%)                               │
│                                                             │
├─────────────────────────────────┬───────────────────────────┤
│      TABLE                      │      TABLE                │
│   Top Opened Content            │   Top Clicked Sources     │
│   (detail_toggle events)        │   (outbound_click)        │
│   - content_id                  │   - source_domain         │
│   - Event Count                 │   - Event Count           │
└─────────────────────────────────┴───────────────────────────┘
```

### Page 3: Content Gaps (Supabase Data)

```
┌─────────────────────────────────────────────────────────────┐
│  CONTENT GAPS & COVERAGE                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│      TABLE: Top Search Gaps (from analytics_search_gaps)    │
│      - term_sanitized                                       │
│      - search_count                                         │
│      - last_seen                                            │
│                                                             │
├─────────────────────────────────┬───────────────────────────┤
│      PIE CHART                  │      SCORECARD            │
│   Stories by Category           │   Enrichment Coverage     │
│   (analytics_story_coverage)    │   (enrichment_pct)        │
└─────────────────────────────────┴───────────────────────────┘
```

### Page 4: Newsletter & Merch (Future)

```
┌─────────────────────────────────────────────────────────────┐
│  CONVERSION TRACKING                        [Date Range ▼]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│      FUNNEL: Visit → Scroll 50% → Newsletter Signup         │
│      (Not active until newsletter launches)                 │
│                                                             │
├─────────────────────────────────┬───────────────────────────┤
│      SCORECARD                  │      SCORECARD            │
│   Merch Impressions             │   Merch Clicks            │
│   (merch_impression events)     │   (merch_interest events) │
└─────────────────────────────────┴───────────────────────────┘
```

---

## Part 4: Chart Configurations

### Chart 1: Total Users (Scorecard)
- **Data source:** GA4
- **Metric:** Total users
- **Date range:** Last 30 days
- **Comparison:** Previous period

### Chart 2: Content Opens - Events (Scorecard)
- **Data source:** GA4
- **Metric:** Event count
- **Filter:** Event name = `detail_toggle` AND action = `open`
- **Label:** "Content Opens (Events)"

### Chart 3: Content Openers - Users (Scorecard)
- **Data source:** GA4
- **Metric:** Total users
- **Filter:** Event name = `detail_toggle` AND action = `open`
- **Label:** "Content Openers (Users)"

> **Why both?** Events can be inflated by power users. If 3,000 opens came from 100 users vs 3,000 users tells a very different story.

### Chart 4: Daily Active Users (Line Chart)
- **Data source:** GA4
- **Dimension:** Date
- **Metric:** Active users *(not Total users - Active users is correct for time series)*
- **Date range:** Last 30 days
- **Chart title:** "Daily Active Users"

### Chart 5: Outbound Clicks (Scorecard)
- **Data source:** GA4
- **Metric:** Event count
- **Filter:** Event name = `outbound_click`

### Chart 6: Users by Page (Pie Chart)
- **Data source:** GA4
- **Dimension:** Page path
- **Metric:** Total users
- **Filter approach:** Exclude junk, don't narrow whitelist

**Recommended filter (exclude noise):**
```
Page path does NOT match regex: (\?|/admin|/api|favicon|\.js|\.css|\.png|\.jpg)
```

This shows all real pages while excluding:
- Query string spam (`?utm_...`, `?fbclid=...`)
- Admin/API paths
- Static assets

### Chart 7: Top Categories (Bar Chart)
- **Data source:** GA4
- **Dimension:** `category` (custom dimension - must be registered first!)
- **Metric:** Event count
- **Filter:** Event name = `filter_category`
- **Sort:** Event count descending
- **Limit:** 10 bars

### Chart 8: Scroll Depth (Bar Chart)
- **Data source:** GA4
- **Dimension:** `type` (custom dimension)
- **Metric:** Event count
- **Filter:** Event name = `content_interaction` AND type matches regex `scroll_(25|50|75|100)`

**To force correct order (25 → 50 → 75 → 100):**

Create a calculated field called `scroll_order`:
```
CASE
  WHEN type = "scroll_25" THEN 1
  WHEN type = "scroll_50" THEN 2
  WHEN type = "scroll_75" THEN 3
  WHEN type = "scroll_100" THEN 4
  ELSE 5
END
```
Sort by `scroll_order` ascending, then hide the sort column from display.

### Chart 9: Top Clicked Sources (Table)
- **Data source:** GA4
- **Dimension:** `source_domain` (custom dimension)
- **Metric:** Event count
- **Filter:** Event name = `outbound_click`
- **Sort:** Event count descending
- **Rows:** 10

### Chart 10: Search Gaps (Table)
- **Data source:** Supabase (PostgreSQL)
- **Query:** `SELECT * FROM analytics_search_gaps ORDER BY search_count DESC LIMIT 20`
- **Columns:** term_sanitized, search_count, last_seen
- **Important:** Always use LIMIT for table widgets to prevent slow scans

### Chart 11: Story Coverage (Pie Chart)
- **Data source:** Supabase (PostgreSQL) - `analytics_story_coverage` view
- **Dimension:** category
- **Metric:** story_count

---

## Part 5: Sharing & Scheduling

### Share Dashboard
1. Click **"Share"** button (top right)
2. Add email addresses for view access
3. Or click **"Get link"** for shareable URL

### Schedule Email Reports
1. Click **"Schedule email delivery"** (in Share menu)
2. Set frequency: Weekly (recommended)
3. Choose day: Monday morning
4. Add recipients

### Embed in Other Tools
1. File → Embed report
2. Copy iframe code
3. Paste into Notion, internal wiki, etc.

---

## Data Freshness Reference

| Data Type | Expected Freshness |
|-----------|-------------------|
| GA4 Realtime | Minutes |
| GA4 Standard Reports | Hours to ~48h (varies by report complexity and thresholding) |
| Supabase (direct) | Real-time |
| Looker Studio refresh | Manual or scheduled (default: 12 hours for GA4) |

**To force refresh in Looker Studio:** Click the refresh icon in the toolbar or set up scheduled data refresh in data source settings.

---

## Maintenance

### Weekly Tasks
- [ ] Review search gaps for editorial priorities
- [ ] Note any traffic anomalies
- [ ] Verify data is refreshing properly

### Monthly Tasks
- [ ] Review dashboard relevance - add/remove charts as needed
- [ ] Check for new custom dimensions that should be added
- [ ] Export key metrics to spreadsheet for historical tracking

---

## Troubleshooting

### "No data" in GA4 charts
- Custom dimensions take 24-48h to populate after registration
- Check date range includes recent data
- Verify events are firing: GA4 → Reports → Realtime → Events

### "category" dimension shows no data
- Verify it's registered in GA4 Admin → Custom definitions
- Wait 24-48h after registration
- Check `filter_category` events are firing (Realtime view)

### PostgreSQL connection fails
- Verify SSL is enabled
- Use port `6543` (connection pooler) not `5432`
- Check Supabase isn't in maintenance mode
- Verify user has SELECT permissions

### Scroll depth chart in wrong order
- Use the calculated field approach in Chart 8 configuration
- Or manually reorder in chart settings if available

### Table widgets are slow
- Always use LIMIT in your queries
- For Supabase views, add ORDER BY and LIMIT in the Looker query, not the view definition

---

## Quick Reference: Event → Metric Mapping

| GA4 Event | What to Measure | Metric Type | Notes |
|-----------|-----------------|-------------|-------|
| `detail_toggle` (action=open) | Content opens | Event count | Add Users metric to see unique openers |
| `detail_toggle` (action=close) | Read events with duration | Event count + duration_ms | duration_ms is client-reported; interpret as directional, not precise |
| `outbound_click` | Source trust / click-through | Event count by source_domain | |
| `content_interaction` | Scroll engagement | Event count by type | Values: scroll_25, scroll_50, scroll_75, scroll_100 |
| `filter_category` | Topic interest | Event count by category | Requires `category` custom dimension |
| `newsletter_signup` | Conversions | Event count where result=success | Not active until newsletter launches |
| `merch_impression` | Pre-commerce visibility | Event count | |
| `merch_interest` | Pre-commerce intent | Event count | |

---

**Last Updated:** 2026-01-15
**Author:** Claude Code

**Environment:** This guide uses TEST environment. Update connection details for PROD when ready for stakeholder reporting.

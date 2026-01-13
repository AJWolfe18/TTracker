# RSS Feed Implementation Guide - 6 New Feeds

**Date:** 2026-01-13
**Task:** Add 6 RSS feeds to expand political coverage
**Estimated Time:** 30-45 minutes
**Location:** Can be done from your desk via Supabase dashboard

---

## Quick Reference

**Adding:**
1. Bloomberg Politics
2. NPR Politics
3. USA Today Politics
4. Associated Press Politics
5. The Hill - News
6. Roll Call - News

**Budget Impact:** +$5-7/month (total: ~$25-27/month)

---

## Prerequisites

✅ Supabase dashboard access (you have this)
✅ TEST environment context (wnrjrywpcadwutfykflu)

---

## Step-by-Step Implementation

### Option A: Via Supabase SQL Editor (Recommended - Fastest)

**1. Open Supabase Dashboard**
- Go to: https://supabase.com/dashboard
- Select project: **TrumpyTracker-Test** (wnrjrywpcadwutfykflu)

**2. Go to SQL Editor**
- Left sidebar → SQL Editor

**3. Copy and Paste This SQL:**

```sql
-- ============================================
-- RSS Feed Expansion - 6 New Feeds
-- Date: 2026-01-13
-- ============================================

-- Step 1: Insert 6 new feeds
INSERT INTO feed_registry (url, source_name, topics, tier, is_active) VALUES
-- 1. Bloomberg Politics
('https://www.bloomberg.com/politics/feeds/site.xml', 'Bloomberg Politics', ARRAY['politics', 'policy', 'economics'], 2, true),

-- 2. NPR Politics
('https://feeds.npr.org/1014/rss.xml', 'NPR Politics', ARRAY['politics', 'national', 'policy'], 2, true),

-- 3. USA Today Politics
('https://rssfeeds.usatoday.com/usatoday-NewsPolitics', 'USA Today Politics', ARRAY['politics', 'national', 'news'], 2, true),

-- 4. Associated Press Politics
('https://feeds.apnews.com/rss/politics', 'AP Politics', ARRAY['politics', 'national', 'news'], 1, true),

-- 5. The Hill - News
('https://thehill.com/news/feed/', 'The Hill - News', ARRAY['politics', 'congress', 'policy'], 2, true),

-- 6. Roll Call - News
('https://www.rollcall.com/news/feed/', 'Roll Call - News', ARRAY['politics', 'congress', 'capitol-hill'], 2, true);

-- Step 2: Get the IDs of the feeds we just inserted (for compliance rules)
-- Run this query separately to see the new feed IDs:
SELECT id, source_name, url
FROM feed_registry
WHERE source_name IN (
  'Bloomberg Politics',
  'NPR Politics',
  'USA Today Politics',
  'AP Politics',
  'The Hill - News',
  'Roll Call - News'
)
ORDER BY id;

-- Step 3: Add compliance rules (replace <FEED_ID> with actual IDs from above)
-- You'll need to run this after getting the IDs from Step 2:

/*
INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes) VALUES
(<BLOOMBERG_ID>, 5000, false, 'Bloomberg Politics', '5K char limit - matches article scraping limit'),
(<NPR_ID>, 5000, false, 'NPR Politics', '5K char limit - matches article scraping limit'),
(<USATODAY_ID>, 5000, false, 'USA Today Politics', '5K char limit - matches article scraping limit'),
(<AP_ID>, 5000, false, 'AP Politics', '5K char limit - matches article scraping limit'),
(<THEHILL_ID>, 5000, false, 'The Hill - News', '5K char limit - matches article scraping limit'),
(<ROLLCALL_ID>, 5000, false, 'Roll Call - News', '5K char limit - matches article scraping limit');
*/
```

**4. Execute the SQL**
- Click "Run" button
- Should see: "Success. 6 rows"

**5. Get the New Feed IDs**
- Run the SELECT query from Step 2
- Note down the IDs (will be sequential, probably 192-197 or similar)

**6. Add Compliance Rules**
- Uncomment the INSERT in Step 3
- Replace `<BLOOMBERG_ID>`, `<NPR_ID>`, etc. with actual IDs from Step 5
- Run the query
- Should see: "Success. 6 rows"

**7. Verify**
```sql
-- Check all feeds are active
SELECT id, source_name, url, tier, is_active
FROM feed_registry
WHERE is_active = true
ORDER BY tier, source_name;

-- Should see 23 total feeds (17 existing + 6 new)
```

---

### Option B: Via Supabase Table Editor (Manual Entry)

If you prefer clicking through the UI:

**For Each Feed:**

1. Go to: Table Editor → `feed_registry`
2. Click "Insert row"
3. Fill in fields:

**Feed 1: Bloomberg Politics**
- url: `https://www.bloomberg.com/politics/feeds/site.xml`
- source_name: `Bloomberg Politics`
- topics: `{politics, policy, economics}`
- tier: `2`
- is_active: `true`

**Feed 2: NPR Politics**
- url: `https://feeds.npr.org/1014/rss.xml`
- source_name: `NPR Politics`
- topics: `{politics, national, policy}`
- tier: `2`
- is_active: `true`

**Feed 3: USA Today Politics**
- url: `https://rssfeeds.usatoday.com/usatoday-NewsPolitics`
- source_name: `USA Today Politics`
- topics: `{politics, national, news}`
- tier: `2`
- is_active: `true`

**Feed 4: AP Politics**
- url: `https://feeds.apnews.com/rss/politics`
- source_name: `AP Politics`
- topics: `{politics, national, news}`
- tier: `1`
- is_active: `true`

**Feed 5: The Hill - News**
- url: `https://thehill.com/news/feed/`
- source_name: `The Hill - News`
- topics: `{politics, congress, policy}`
- tier: `2`
- is_active: `true`

**Feed 6: Roll Call - News**
- url: `https://www.rollcall.com/news/feed/`
- source_name: `Roll Call - News`
- topics: `{politics, congress, capitol-hill}`
- tier: `2`
- is_active: `true`

4. Then add compliance rules in `feed_compliance_rules` table (same process)

---

## Verification Steps

### 1. Check Feed Count
```sql
SELECT COUNT(*) as total_feeds
FROM feed_registry
WHERE is_active = true;
-- Should return: 23
```

### 2. Check New Feeds Exist
```sql
SELECT id, source_name, url, tier
FROM feed_registry
WHERE source_name IN (
  'Bloomberg Politics',
  'NPR Politics',
  'USA Today Politics',
  'AP Politics',
  'The Hill - News',
  'Roll Call - News'
);
-- Should return: 6 rows
```

### 3. Check Compliance Rules
```sql
SELECT
  fr.source_name,
  fcr.max_chars,
  fcr.allow_full_text
FROM feed_registry fr
JOIN feed_compliance_rules fcr ON fcr.feed_id = fr.id
WHERE fr.source_name IN (
  'Bloomberg Politics',
  'NPR Politics',
  'USA Today Politics',
  'AP Politics',
  'The Hill - News',
  'Roll Call - News'
);
-- Should return: 6 rows with max_chars=5000, allow_full_text=false
```

### 4. Test RSS Ingestion

**Option A: Wait for next scheduled run**
- GitHub Actions runs every 2 hours on main
- Check: https://github.com/AJWolfe18/TTracker/actions/workflows/rss-tracker-prod.yml

**Option B: Manual trigger (TEST environment)**
```bash
gh workflow run "RSS Tracker - TEST" --ref test
gh run watch
```

Then check for new articles:
```sql
SELECT
  source_name,
  COUNT(*) as article_count,
  MAX(fetched_at) as last_fetch
FROM articles
WHERE source_name IN (
  'Bloomberg Politics',
  'NPR Politics',
  'USA Today Politics',
  'AP Politics',
  'The Hill - News',
  'Roll Call - News'
)
GROUP BY source_name;
```

---

## Expected Results After First Run

### Article Ingestion (Estimates):
| Feed | Expected Articles/Day |
|------|----------------------|
| AP Politics | 30-50 (wire service, high volume) |
| Bloomberg Politics | 15-25 |
| NPR Politics | 10-20 |
| USA Today Politics | 15-25 |
| The Hill - News | 20-40 (congressional focus) |
| Roll Call - News | 10-20 (congressional) |
| **Total New** | **100-180 articles/day** |

### Story Clustering:
- New feeds will cluster into existing stories where relevant
- May create 5-10 new stories/day from unique angles
- Congressional coverage (The Hill, Roll Call) will improve Capitol Hill tracking

### Budget Impact:
- Enrichment cost: ~$0.003/story
- Estimated new stories: 5-10/day
- Additional cost: ~$0.015-0.03/day (~$5-7/month)

---

## Troubleshooting

### Issue: Feed not fetching
**Check:**
```sql
SELECT id, source_name, is_active, failure_count, last_fetched_at
FROM feed_registry
WHERE source_name = 'Bloomberg Politics';  -- Replace with failing feed
```

**If `is_active = false`:**
- Set to true: `UPDATE feed_registry SET is_active = true WHERE id = <ID>;`

**If `failure_count >= 5`:**
- Feed auto-disabled after 5 failures
- Reset: `UPDATE feed_registry SET failure_count = 0, is_active = true WHERE id = <ID>;`

### Issue: No articles appearing
**Check GitHub Actions logs:**
1. Go to: https://github.com/AJWolfe18/TTracker/actions
2. Find latest "RSS Tracker" run
3. Check logs for errors related to new feeds

**Common issues:**
- Feed URL changed (check feed URL in browser)
- Feed format incompatible (RSS 2.0 vs Atom)
- Paywall blocking (Bloomberg sometimes requires subscription)

### Issue: Articles not clustering
**This is normal initially.**
- Clustering requires 3+ articles with similar content
- Wait 24-48 hours for articles to accumulate
- Check clustering logs in GitHub Actions

---

## Rollback Plan

If any feed causes issues:

**Disable single feed:**
```sql
UPDATE feed_registry
SET is_active = false
WHERE source_name = 'Bloomberg Politics';  -- Replace with problematic feed
```

**Remove feed entirely:**
```sql
-- First, delete compliance rule
DELETE FROM feed_compliance_rules
WHERE feed_id = (SELECT id FROM feed_registry WHERE source_name = 'Bloomberg Politics');

-- Then delete feed
DELETE FROM feed_registry
WHERE source_name = 'Bloomberg Politics';
```

---

## Post-Implementation Monitoring

### First 24 Hours:
- [ ] Check article ingestion (verify articles appearing)
- [ ] Monitor GitHub Actions logs (watch for errors)
- [ ] Check failure_count on new feeds (should stay 0)

### First Week:
- [ ] Review story clustering quality
- [ ] Check for duplicate stories
- [ ] Monitor AI enrichment costs in `budgets` table

### First Month:
- [ ] Analyze article volume per feed
- [ ] Adjust tiers if needed (high volume → tier 3)
- [ ] Review user engagement (are new stories valuable?)

---

## Success Criteria

✅ **Implementation successful if:**
1. All 6 feeds have `is_active = true` and `failure_count = 0`
2. Articles appearing from new feeds within 2 hours
3. No increase in error logs
4. Budget stays under $30/month
5. Story clustering quality maintained (no massive duplicates)

---

## Questions During Implementation?

**If you hit issues:**
1. Check troubleshooting section above
2. Query `feed_registry` and `feed_compliance_rules` to verify data
3. Check GitHub Actions logs for errors
4. Create handoff note with specific error messages

---

## Next Steps After Implementation

1. **Wait 48 hours** for article accumulation
2. **Review clustering quality** - Are new feeds creating good stories?
3. **Check budget impact** - Query `budgets` table for daily costs
4. **Adjust if needed** - Disable low-value feeds, change tiers

**Then consider:**
- Event architecture implementation (see event-based-architecture-sketch.md)
- Legal commentary RSS feeds (Lawfare, Just Security)
- Additional feeds from research doc (if needed)

---

**Questions? Issues?**
Document them in a handoff note for the next session.

# TTRC-258 Deployment Guide

**Feature:** Article Scraping for Story Enrichment  
**JIRA:** TTRC-258  
**Date:** November 7, 2025

---

## Quick Answer: Do I Need Supabase Updates?

**NO DATABASE CHANGES REQUIRED.** ✅

This feature uses existing schema. The only Supabase update needed is **adding new RSS feeds** (optional, to test scraping).

---

## What This Feature Does

**Before:**
- Worker enriches stories using RSS descriptions (~200 chars per article)
- Sends ~300 tokens to OpenAI
- Summaries are surface-level

**After:**
- Worker scrapes full articles from allowed domains (CSM, PBS, ProPublica)
- Sends ~1200 tokens to OpenAI (4× more context)
- Summaries are richer and more detailed
- Falls back to RSS for blocked/paywalled domains (NYT, Atlantic, etc.)

---

## Deployment Steps (TEST Environment)

### Step 1: Verify Code is Deployed ✅

**Check these files exist:**
```bash
ls scripts/enrichment/scraper.js
ls scripts/test-scraper-ttrc258.js
```

**Verify worker import:**
```bash
grep "enrichArticlesForSummary" scripts/job-queue-worker.js
```

If files don't exist, you need to pull from the `test` branch:
```bash
git checkout test
git pull origin test
```

---

### Step 2: Test Scraper (Optional Validation)

Run the validation test to confirm everything works:

```bash
cd /c/Users/Josh/OneDrive/Desktop/GitHub/TTracker
node scripts/test-scraper-ttrc258.js
```

**Expected output:**
```
✓ Scraped articles: 0 (max 2 allowed)
✓ NYT used RSS fallback: true
✅ Test completed successfully!
```

This confirms the scraper is working (will show 0 scraped because test URLs are fake).

---

### Step 3: Add Allowed-Domain Feeds (TO GET REAL SCRAPING)

**This is the ONLY Supabase change needed.**

Open Supabase SQL Editor (TEST database):

**URL:** https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql/new

**Run this SQL:**

```sql
-- Add CSM, PBS, and ProPublica feeds to get scrapable articles

INSERT INTO feed_registry (
  feed_url,
  feed_name,
  source_name,
  topics,
  tier,
  is_active
) VALUES
  (
    'https://rss.csmonitor.com/feeds/politics',
    'CSM Politics',
    'Christian Science Monitor',
    ARRAY['politics'],
    2,
    true
  ),
  (
    'https://www.pbs.org/newshour/feeds/rss/politics',
    'PBS Politics',
    'PBS NewsHour Politics',
    ARRAY['politics'],
    2,
    true
  ),
  (
    'https://www.propublica.org/feeds/propublica/main.rss',
    'ProPublica Main',
    'ProPublica',
    ARRAY['politics', 'investigations'],
    2,
    true
  )
ON CONFLICT (feed_url) DO NOTHING;
```

**What this does:**
- Adds 3 new RSS feeds to your registry
- These domains are in the scraper allow-list
- Articles from these feeds will be scraped (not just RSS descriptions)

**Verify feeds were added:**
```sql
SELECT id, source_name, feed_url, is_active
FROM feed_registry
WHERE source_name IN ('Christian Science Monitor', 'PBS NewsHour Politics', 'ProPublica');
```

---

### Step 4: Trigger RSS Fetch (Get Articles from New Feeds)

**Option A: Wait for Scheduled Job** (every 1-2 hours)
- GitHub Actions will auto-trigger RSS fetch
- New feeds will be processed automatically

**Option B: Manual Trigger** (immediate)

Call the RSS enqueue Edge Function:

```bash
curl -X POST "https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer YOUR_EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

**Where to find EDGE_CRON_TOKEN:**
- GitHub repo → Settings → Secrets → EDGE_CRON_TOKEN

**Or via Supabase SQL:**
```sql
-- Manually enqueue fetch jobs for new feeds
SELECT public.enqueue_fetch_job(
  'fetch_feed',
  jsonb_build_object('feed_id', id),
  NULL
)
FROM feed_registry
WHERE source_name IN ('Christian Science Monitor', 'PBS NewsHour Politics', 'ProPublica');
```

---

### Step 5: Run Worker to Enrich Stories

**Start the worker locally:**

```bash
cd /c/Users/Josh/OneDrive/Desktop/GitHub/TTracker
node scripts/job-queue-worker.js
```

**Watch for these logs:**

✅ **Good logs (scraping working):**
```
scraped_ok host=www.csmonitor.com len=1847
scraped_ok host=www.pbs.org len=1523
```

✅ **Expected logs (paywalled sites):**
```
scraped_fail host=www.nytimes.com err=HTTP 403
```
(Falls back to RSS - this is correct behavior)

⚠️ **Problem logs:**
```
Error: enrichArticlesForSummary is not a function
```
(Means code not deployed - go back to Step 1)

---

### Step 6: Compare Summary Quality (Validation)

**Find a story with CSM/PBS articles:**

```sql
-- Find stories with CSM/PBS articles
SELECT DISTINCT s.id, s.primary_headline, COUNT(*) as article_count
FROM stories s
JOIN article_story ast ON ast.story_id = s.id
JOIN articles a ON a.id = ast.article_id
WHERE a.source_domain IN ('www.csmonitor.com', 'www.pbs.org', 'www.propublica.org')
  AND s.status = 'active'
GROUP BY s.id, s.primary_headline
ORDER BY s.last_updated_at DESC
LIMIT 5;
```

**Check the enrichment results:**

```sql
SELECT 
  id,
  primary_headline,
  summary_neutral,
  summary_spicy,
  LENGTH(summary_neutral) as summary_length,
  last_enriched_at
FROM stories
WHERE id = [STORY_ID_FROM_ABOVE];
```

**What to look for:**
- `summary_neutral` should be detailed (2-3 sentences with specific details)
- `summary_spicy` should be engaging
- Summary length: 300-500 chars (richer than before)

---

## Deployment Steps (PROD Environment)

### Prerequisites

✅ **Before deploying to PROD:**
1. Test in TEST environment (steps above)
2. Verify 3-5 stories have improved summaries
3. Confirm no errors in worker logs
4. Validate cost increase is acceptable (~$0.42/month)

---

### PROD Deployment Steps

#### 1. Cherry-Pick Code to Main Branch

```bash
cd /c/Users/Josh/OneDrive/Desktop/GitHub/TTracker

# Make sure test branch is clean
git checkout test
git status

# Create deployment branch from main
git checkout main
git pull origin main
git checkout -b deploy/ttrc-258

# Cherry-pick the scraper commits from test
git cherry-pick <commit-hash-for-scraper.js>
git cherry-pick <commit-hash-for-worker-update>

# Push deployment branch
git push origin deploy/ttrc-258
```

#### 2. Create Pull Request

```bash
gh pr create \
  --base main \
  --head deploy/ttrc-258 \
  --title "TTRC-258: Add Article Scraping for Story Enrichment" \
  --body "See TTRC-258 for details. Tested in TEST environment."
```

#### 3. Merge PR (Auto-Deploys to PROD)

- Review PR in GitHub
- Merge to `main`
- Netlify auto-deploys to trumpytracker.com
- Worker code is updated (no restart needed)

#### 4. Add Feeds to PROD Database

**Connect to PROD Supabase:** https://supabase.com/dashboard/project/YOUR_PROD_PROJECT/sql/new

**Run the same SQL from Step 3:**

```sql
INSERT INTO feed_registry (
  feed_url,
  feed_name,
  source_name,
  topics,
  tier,
  is_active
) VALUES
  (
    'https://rss.csmonitor.com/feeds/politics',
    'CSM Politics',
    'Christian Science Monitor',
    ARRAY['politics'],
    2,
    true
  ),
  (
    'https://www.pbs.org/newshour/feeds/rss/politics',
    'PBS Politics',
    'PBS NewsHour Politics',
    ARRAY['politics'],
    2,
    true
  ),
  (
    'https://www.propublica.org/feeds/propublica/main.rss',
    'ProPublica Main',
    'ProPublica',
    ARRAY['politics', 'investigations'],
    2,
    true
  )
ON CONFLICT (feed_url) DO NOTHING;
```

#### 5. Trigger RSS Fetch (PROD)

**Option A:** Wait for scheduled job (auto-runs every 1-2 hours)

**Option B:** Manual trigger via Edge Function (same as TEST Step 4)

#### 6. Monitor PROD Worker

If worker runs on a server:
```bash
ssh your-server
tail -f /path/to/worker.log
```

If worker runs locally, start it:
```bash
node scripts/job-queue-worker.js
```

Watch for `scraped_ok` logs.

---

## Configuration (Optional)

### Environment Variables

Add these to your worker environment to customize behavior:

```bash
# Customize allowed domains (comma-separated, no spaces)
export SCRAPE_DOMAINS="csmonitor.com,pbs.org,propublica.org,npr.org"

# Adjust per-host rate limit (milliseconds)
export SCRAPE_MIN_GAP_MS=2000  # 2 seconds between requests to same host
```

**Where to set these:**
- Local: `.env` file
- Server: System environment or process manager config

---

## Troubleshooting

### Problem: Worker crashes with "enrichArticlesForSummary is not a function"

**Cause:** Code not deployed  
**Fix:** 
```bash
git checkout test
git pull origin test
node scripts/job-queue-worker.js
```

---

### Problem: No `scraped_ok` logs, only `fallback_rss`

**Cause:** No articles from allowed domains in database  
**Fix:** 
1. Verify feeds added: `SELECT * FROM feed_registry WHERE source_name LIKE '%Monitor%'`
2. Check articles exist: `SELECT COUNT(*) FROM articles WHERE source_domain LIKE '%csmonitor%'`
3. If 0 articles, trigger RSS fetch (Step 4)

---

### Problem: `scraped_fail` with 403/404 errors

**Cause:** Publisher blocking or URL changed  
**Fix:** This is expected - scraper falls back to RSS (no action needed)

**If excessive 403s:**
- Check User-Agent in `scraper.js` line 114
- Increase `SCRAPE_MIN_GAP_MS` to 2000+ (slower rate)

---

### Problem: Cost increase higher than expected

**Check token usage:**
```sql
SELECT 
  DATE(last_enriched_at) as day,
  COUNT(*) as stories_enriched,
  COUNT(*) * 0.0002 as estimated_cost_usd
FROM stories
WHERE last_enriched_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(last_enriched_at)
ORDER BY day DESC;
```

**Emergency disable scraping:**
```bash
export SCRAPE_DOMAINS=""  # Empty = disable all scraping
# Restart worker
```

---

## Rollback Plan

### If Issues Occur in PROD

**1. Emergency Kill-Switch (no code changes):**
```bash
export SCRAPE_DOMAINS=""
# Restart worker - will use RSS-only enrichment
```

**2. Revert Code (permanent rollback):**
```bash
git checkout main
git revert <scraper-commit-hash>
git push origin main
# Netlify auto-deploys rollback
```

**3. Remove Feeds (stop new CSM/PBS articles):**
```sql
UPDATE feed_registry
SET is_active = false
WHERE source_name IN ('Christian Science Monitor', 'PBS NewsHour Politics', 'ProPublica');
```

---

## Success Criteria

✅ **You'll know it's working when:**
1. Worker logs show `scraped_ok host=www.csmonitor.com len=1500+`
2. Story summaries are more detailed (compare before/after)
3. No worker crashes or errors
4. Cost increase is ~$0.40-0.60/month (acceptable)

---

## Summary: What You Actually Need to Do

**For TEST (already done):**
- ✅ Code deployed to `test` branch
- ⏳ Add 3 feeds to Supabase (Step 3)
- ⏳ Run worker and validate (Steps 4-6)

**For PROD (when ready):**
- Cherry-pick commits to `main` via PR
- Add same 3 feeds to PROD Supabase
- Monitor worker logs
- Validate summary quality

**No migrations, no schema changes, no complex setup.** Just add feeds and run.

---

**Questions?** See validation report: `docs/handoffs/2025-11-07-ttrc258-validation.md`

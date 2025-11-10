# TTRC-260 Deployment Guide: Mozilla Readability Scraper

**Ticket:** [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)  
**Feature:** Three-tier fallback scraper (Readability → Regex → RSS)  
**Status:** ✅ Ready for Testing on TEST  
**Created:** 2025-11-09

---

## Pre-Deployment Checklist

### Code Status
- ✅ All code merged to TEST branch (commit `1876190`)
- ✅ Expert code review complete (4 issues fixed)
- ✅ AI code review passed (GitHub Actions)
- ✅ Dependencies installed (`jsdom`, `@mozilla/readability`)
- ✅ Tests passing (`scripts/tests/test-scraper-readability.mjs`)

### Environment Verification
- ✅ TEST environment: Supabase TEST database
- ✅ Worker script: `scripts/job-queue-worker.js`
- ✅ RSS pipeline: Active (GitHub Actions every 2 hours)

---

## Testing on TEST Environment

### Option 1: Wait for Automatic RSS Run (Easiest)
**Timeline:** Next run within 2 hours

GitHub Actions runs RSS fetch every 2 hours. Worker processes jobs automatically.

**Monitor logs:**
```bash
node scripts/job-queue-worker.js

# Watch for:
# - scraped_ok method=readability (success!)
# - scraped_ok method=regex_fallback (fallback used)
# - scrape_fallback_to_rss (both failed, RSS used)
```

### Option 2: Manual RSS Trigger (Fastest)
**Timeline:** Immediate

```bash
# Get credentials from .env
SUPABASE_URL="https://wnrjrywpcadwutfykflu.supabase.co"
EDGE_CRON_TOKEN="<from .env>"

# Trigger RSS enqueue
curl -X POST "$SUPABASE_URL/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer $EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'

# Run worker
node scripts/job-queue-worker.js
```

### Option 3: Direct Story Enrichment Test
**Timeline:** Immediate, tests scraper directly

```sql
-- Find story needing enrichment
SELECT id, primary_headline
FROM stories
WHERE status = 'active' AND summary_neutral IS NULL
LIMIT 1;

-- Enqueue enrichment job
INSERT INTO job_queue (job_type, job_data, status)
VALUES ('story.enrich', jsonb_build_object('story_id', <STORY_ID>), 'pending');
```

Then run worker and watch scraper logs.

---

## Monitoring & Success Criteria

### What to Monitor (2-3 Days)

**1. Scraper Success Rates**
```bash
# Count successes by method
grep "scraped_ok method=readability" worker.log | wc -l
grep "scraped_ok method=regex_fallback" worker.log | wc -l
grep "scrape_fallback_to_rss" worker.log | wc -l

# Target: >70% success rate (readability + regex)
```

**2. Worker Memory**
```bash
# Check memory usage (should be stable)
ps aux | grep job-queue-worker | awk '{print $6/1024 " MB"}'

# Expected: 100-200MB stable
# If >500MB after 24h: Memory leak investigation needed
```

**3. Summary Quality**
```sql
-- Check enriched stories
SELECT id, primary_headline, LENGTH(summary_neutral), summary_neutral
FROM stories
WHERE status = 'active' 
  AND summary_neutral IS NOT NULL
  AND updated_at > NOW() - INTERVAL '24 hours'
ORDER BY updated_at DESC
LIMIT 10;

-- Verify: Specific facts, 100-200 words, no ads/nav text
```

### Success Criteria

**✅ Ready for PROD:**
- Success rate >70%
- Worker memory stable (<300MB for 24+ hours)
- Zero HTTP 429 errors
- Summary quality improved
- Zero crashes

**❌ Need Investigation:**
- Success rate <70%
- Memory growing continuously
- HTTP 429 errors
- Worker crashes

---

## Deployment to PROD

### Prerequisites
- TEST monitoring complete (2-3 days)
- Success rate >70%
- PROD migration complete (`stories` table exists)

### Steps

**1. Create Deployment Branch**
```bash
git checkout main
git pull origin main
git checkout -b deploy/ttrc-260-readability
```

**2. Cherry-Pick Commits**
```bash
git cherry-pick 701a5f4  # Initial implementation
git cherry-pick d502954  # Documentation
git cherry-pick 2f6572b  # Critical fixes
git cherry-pick 1876190  # URL parsing fix
```

**3. Create PR to Main**
```bash
gh pr create --base main \
  --title "deploy: Mozilla Readability scraper (TTRC-260)" \
  --body "Tested on TEST for 3 days. Success rate: XX%. Memory stable. Zero errors."
```

**4. Merge PR**
- Auto-deploys to trumpytracker.com
- Monitor for 24 hours

---

## Rollback Plan

### When to Rollback
- Worker crashes
- Memory leak (>500MB)
- Success rate <50%
- HTTP 429 errors

### How to Rollback

**Option 1: Revert Commits**
```bash
git revert 1876190 2f6572b d502954 701a5f4
git push origin main
```

**Option 2: Emergency Disable Scraping**
```bash
# In Supabase env vars, set:
SCRAPE_DOMAINS=""
# Forces RSS-only mode (100% safe)
```

---

## Troubleshooting

**Memory Growing:** Verify `dom.window.close()` in finally block  
**HTTP 429:** Increase `PER_HOST_MIN_GAP_MS` to 2000ms  
**Low Success:** Check which sites failing with `grep "readability_fail"`  

---

## Cost Impact

**Before:** $20/month (OpenAI only)  
**After:** $20/month (no change)  
**Dependencies:** +2MB (jsdom + readability), $0 cost

---

## References

**JIRA:** [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)  
**PR:** #21 - https://github.com/AJWolfe18/TTracker/pull/21  
**Commits:** 701a5f4, d502954, 2f6572b, 1876190

---

**Last Updated:** 2025-11-09  
**Status:** ✅ Ready for Testing

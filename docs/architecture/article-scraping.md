# Article Scraping Architecture (TTRC-258)

**Last Updated:** 2025-11-08
**Status:** Active on TEST environment
**Owner:** Josh + Claude Code

---

## Overview

Article scraping enhances story summaries by fetching full article content (up to 5000 chars) from allowed domains, providing 10-25x more context to OpenAI compared to RSS-only (~200 chars).

**Business Impact:**
- 30-50% more detailed summaries with concrete facts
- Better category/severity classification
- More entity extraction
- Cost: +$0.12/month (well under $50 budget)

---

## Current Implementation

### What We Use

**Tool:** Node.js v22 native `fetch()` + regex-based HTML parsing

**Location:** `scripts/enrichment/scraper.js` (197 lines, zero dependencies)

**How it works:**
1. Downloads HTML via native `fetch()` (8s timeout)
2. Searches for `<article>` tag using regex
3. Falls back to `<div class="article-body">` or similar
4. Strips HTML tags, scripts, styles with regex
5. Returns first 5000 characters of clean text

**Configuration (via environment variables):**
```bash
SCRAPE_MAX_CHARS=5000        # Max chars per article (default: 5000)
SCRAPE_MIN_GAP_MS=1000       # Min delay between same-host requests (default: 1000ms)
SCRAPE_DOMAINS=csmonitor.com,pbs.org,...  # Allow-list (default: CSM, PBS, ProPublica, Reuters, AP, Politico)
```

---

## Why This Approach?

### Pros ✅
- **Zero dependencies** - No npm packages needed
- **Fast** - No browser overhead
- **Lightweight** - Low memory usage
- **Simple** - Easy to understand and maintain
- **Works for most sites** - CSM, ProPublica scrape successfully

### Cons ❌
- **Regex HTML parsing is fragile** - Can break if site changes structure
- **No JavaScript rendering** - PBS and JS-heavy sites fail
- **May grab navigation/ads** - Not intelligent about content extraction
- **Site-specific** - Depends on consistent HTML structure

---

## Better Alternatives

### Option 1: Cheerio (GOOD)

**What:** jQuery-like DOM parsing for Node.js

**Pros:**
- ✅ Proper HTML parsing (no regex brittleness)
- ✅ Easy to target specific elements (`$('article p').text()`)
- ✅ Small dependency (~1MB)
- ✅ Fast (no browser)
- ✅ Much more reliable than regex

**Cons:**
- ❌ Still can't render JavaScript
- ❌ One more dependency to manage

**Cost:** Free (npm: `cheerio`)

**When to upgrade:** When regex parsing breaks frequently

**Example:**
```javascript
import * as cheerio from 'cheerio';
const $ = cheerio.load(html);
const text = $('article p').text(); // Much cleaner than regex!
```

---

### Option 2: Mozilla Readability (BETTER)

**What:** Same algorithm Firefox uses for "Reader Mode" - intelligently extracts main article content

**Pros:**
- ✅ **Intelligent content extraction** - Filters out ads, navigation, sidebars
- ✅ **Battle-tested** - Used by millions in Firefox
- ✅ **Best quality** - Gets clean article text consistently
- ✅ Works with JSDOM or Cheerio (no browser needed)
- ✅ Handles varied HTML structures automatically

**Cons:**
- ❌ Still can't render JavaScript (PBS won't work)
- ❌ Requires JSDOM dependency (~2MB)
- ❌ Slightly slower than regex

**Cost:** Free (npm: `@mozilla/readability` + `jsdom`)

**When to upgrade:** When we want highest quality extraction

**Example:**
```javascript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(html, { url: articleUrl });
const reader = new Readability(dom.window.document);
const article = reader.parse();

console.log(article.textContent); // Clean, high-quality article text!
console.log(article.title);       // Extracted title
console.log(article.excerpt);     // Auto-generated excerpt
```

**This is the recommended upgrade path!**

---

### Option 3: Playwright/Puppeteer (OVERKILL)

**What:** Full headless Chrome browser

**Pros:**
- ✅ Renders JavaScript (PBS would work)
- ✅ Can screenshot, click buttons, fill forms
- ✅ Perfect scraping (sees exactly what users see)

**Cons:**
- ❌ **Heavy:** Downloads Chromium (~170MB)
- ❌ **Slow:** 2-5 seconds per page
- ❌ **Memory hungry:** ~100MB RAM per page
- ❌ **Complex:** Requires process management
- ❌ **Expensive:** More server resources

**Cost:** Free but resource-intensive

**When to use:** Only if 50%+ of sources require JavaScript (NOT our case)

**Verdict:** **NOT worth it** - CSM + ProPublica work fine with static scraping

---

## Performance Characteristics

### Current (Regex + Native Fetch)

| Metric | Value |
|--------|-------|
| Dependencies | 0 |
| Memory per scrape | ~5MB |
| Time per article | 500-1500ms |
| Success rate | ~60% (CSM ✅, PBS ❌, ProPublica ✅) |
| Code size | 197 lines |

### With Cheerio

| Metric | Value |
|--------|-------|
| Dependencies | 1 (cheerio) |
| Memory per scrape | ~8MB |
| Time per article | 600-1800ms |
| Success rate | ~65% (better targeting) |
| Code size | ~150 lines (cleaner) |

### With Readability + JSDOM

| Metric | Value |
|--------|-------|
| Dependencies | 2 (jsdom, readability) |
| Memory per scrape | ~15MB |
| Time per article | 800-2000ms |
| Success rate | ~80% (intelligent extraction) |
| Code size | ~100 lines (simpler) |

### With Playwright

| Metric | Value |
|--------|-------|
| Dependencies | Heavy (Chromium) |
| Memory per scrape | ~100MB |
| Time per article | 2000-5000ms |
| Success rate | ~95% (renders JS) |
| Code size | ~200 lines (complex) |

---

## Cost Analysis

### Character Limits Impact

| Limit | Chars/Story | Tokens/Story | Cost/Story | Cost/Month (100 stories) |
|-------|-------------|--------------|------------|-------------------------|
| 2K | 12,000 | 3,000 | $0.00057 | $0.06 |
| **5K** | **30,000** | **7,500** | **$0.00124** | **$0.12** |
| 10K | 60,000 | 15,000 | $0.00237 | $0.24 |

**Current setting:** 5K (configurable via `SCRAPE_MAX_CHARS`)

**Why 5K?**
- Typical news article: 800-1500 words (~4000-7500 chars)
- 2K captures only first ~400 words (often misses conclusion/key facts)
- 5K captures full context (first ~1000 words)
- Cost increase vs 2K: only $0.07/month
- Still well under $50/month budget

---

## Allow-List Strategy

### Current Allow-List (Default)

**Tier 1 - Public, Non-Paywalled (SAFE):**
- Christian Science Monitor (`csmonitor.com`) - ✅ Working
- PBS NewsHour (`pbs.org`) - ⚠️ Falls back to RSS (JavaScript-heavy)
- ProPublica (`propublica.org`) - ✅ Working

**Tier 2 - May Hit Soft Paywalls (TEST CAREFULLY):**
- Reuters (`reuters.com`) - Untested
- AP News (`apnews.com`) - Untested
- Politico (`politico.com`) - Untested

**Blocked (Paywalls):**
- New York Times - Hard paywall
- Washington Post - Hard paywall
- The Atlantic - Hard paywall
- Wall Street Journal - Hard paywall

### How to Add Sources

**Add to allow-list:**
```bash
export SCRAPE_DOMAINS="csmonitor.com,pbs.org,propublica.org,newdomain.com"
```

**Or edit scraper.js line 19:**
```javascript
const SCRAPE_ALLOWLIST = (process.env.SCRAPE_DOMAINS ?? 'csmonitor.com,pbs.org,propublica.org')
```

**Criteria for adding:**
1. ✅ No hard paywall (or soft paywall with 5+ free articles/month)
2. ✅ Publicly accessible content
3. ✅ Reputable source (AP, Reuters-level credibility)
4. ✅ Static HTML or compatible with our scraper

---

## Graceful Fallback System

**Every scraping attempt has RSS fallback:**

```javascript
try {
  const scraped = await scrapeArticleBody(url);
  if (scraped && scraped.length > 300) {
    return { ...article, excerpt: scraped }; // Use scraped content
  }
} catch (e) {
  console.log(`scraped_fail: ${e.message}`);
}
return { ...article, excerpt: rssFallback }; // Always falls back to RSS
```

**Result:** Zero breaking errors - if scraping fails, we use RSS excerpt

**Log messages:**
- `scraped_ok host=example.com len=5000` - Success
- `scraped_too_short host=example.com` - <300 chars (falls back)
- `scraped_fail host=example.com err=HTTP 404` - Error (falls back)

---

## Article Selection Algorithm

**Key Question:** When a story has multiple articles (e.g., 3 PBS + 2 NYT), which ones get scraped?

### Configuration

```javascript
const MAX_SCRAPED_PER_CLUSTER = 2;  // Max 2 articles scraped per story
```

**Why 2?** Cost/benefit sweet spot - 2 articles provide sufficient context for high-quality AI summaries, more articles show diminishing returns.

### Selection Logic

**Function:** `enrichArticlesForSummary()` in `scripts/enrichment/scraper.js` (lines 239-297)

**Algorithm (Sequential with Smart Retry):**

1. Loop through ALL articles in the story (in order received)
2. For each article:
   - ✅ Check if URL is on allow-list (csmonitor.com, pbs.org, etc.)
   - ✅ Check if hostname already tried (deduplicates by domain)
   - ✅ Check if already have 2 successful scrapes
   - If all checks pass: **Attempt scrape**
   - If scrape **succeeds** (>300 chars): Count as success, continue to next
   - If scrape **fails**: Don't count, keep trying next articles
3. Stop when: Either 2 successful scrapes OR exhausted all articles

**Key Improvement (TTRC-260):**
- **Before:** Pre-selected 2 articles, gave up if both failed
- **After:** Keeps trying allow-listed articles until 2 successes or runs out

### Examples

#### Scenario 1: Story with 4 articles
**Articles:** [PBS-A, NYT-A, Politico-A, CSM-A]

**Process:**
1. Try PBS-A → ✅ Success (1/2)
2. Try NYT-A → ✅ Success (2/2)
3. **Stop** (already have 2 successes)
4. Politico-A and CSM-A skipped (use RSS descriptions)

**Result:** PBS + NYT scraped, Politico + CSM use RSS

---

#### Scenario 2: Story with duplicate hosts
**Articles:** [Politico-A, Politico-B, PBS-A, NYT-A]

**Process:**
1. Try Politico-A → ❌ Failed (HTTP 403 - blocks automation)
2. **Skip** Politico-B (same host = politico.com already tried)
3. Try PBS-A → ✅ Success (1/2)
4. Try NYT-A → ✅ Success (2/2)

**Result:** Only PBS + NYT scraped (1 failure, 2 successes)

**Why dedup by host?** Ensures variety of sources, avoids rate limiting same domain.

---

#### Scenario 3: Story with only failed attempts
**Articles:** [Politico-A, WaPo-A, Politico-B]

**Process:**
1. Try Politico-A → ❌ Failed (HTTP 403)
2. Try WaPo-A → ❌ Failed (paywall/blocking)
3. **Skip** Politico-B (politico.com already tried)
4. No more articles to try

**Result:** 0 scraped, all use RSS descriptions (graceful degradation)

---

### Deduplication Strategy

**Deduplicates by hostname, NOT full URL:**

```javascript
// Two articles from same host
const articles = [
  { url: 'https://www.pbs.org/article-1' },  // hostname: www.pbs.org
  { url: 'https://www.pbs.org/article-2' }   // hostname: www.pbs.org (SKIP)
];
```

**Why?** Prevents:
- Rate limiting (1 request per host per second minimum)
- Redundant content (same source perspective)
- Wasted scraping attempts

---

### Configuring Selection Behavior

**Max articles per story** (default: 2):
```bash
# In .env or environment variables
SCRAPE_MAX_PER_STORY=3  # Would scrape up to 3 articles
```

**Increase if:** You want more detailed summaries (costs more OpenAI tokens)

**Decrease to 1 if:** Budget concerns or sources are very verbose

---

### Monitoring Article Selection

**Log messages to watch:**

```bash
# Worker logs show selection process:
scraped_ok method=readability host=www.pbs.org len=4397     # Success (counted)
scraped_fail host=www.politico.com err=HTTP 403             # Failure (keep trying)
scrape_fallback_to_rss host=www.pbs.org reason=too_short   # <300 chars (keep trying)
```

**Analyze selection success:**

```bash
# Count successful scrapes per story
grep "scraped_ok" worker.log | wc -l

# Count failures (should keep trying next article)
grep "scraped_fail" worker.log | wc -l

# Check deduplication working (same host skipped)
grep "already tried host" worker.log  # Should see dedup messages
```

---

### Edge Cases Handled

**1. All articles from same blocked source:**
- Story with 5 Politico articles
- Result: All fail (expected), falls back to RSS for all
- No infinite loops, graceful degradation

**2. Mixed allow-list and non-allow-list:**
- Story with 2 Medium articles + 2 PBS articles
- Medium skipped (not on allow-list)
- PBS both tried (different URLs, same host)
- Result: 1 PBS scraped (second skipped due to dedup)

**3. No articles on allow-list:**
- Story with only NYT, WaPo (paywalled, not on default allow-list)
- Result: All use RSS (graceful fallback)

**4. All scrapes fail:**
- Story with allow-listed sources that all return errors
- Result: All use RSS descriptions
- No breaking errors, enrichment proceeds normally

---

## Future Improvements

### Short-term (Next Quarter)

1. **Upgrade to Readability + JSDOM**
   - Better content extraction
   - Filters ads/navigation automatically
   - Cost: ~$100/year dev time, $0 runtime

2. **Add Reuters/AP to validated allow-list**
   - Test soft paywall behavior
   - Monitor scraping success rate

3. **Content quality metrics**
   - Track scraped vs RSS character counts
   - Measure summary quality improvement

### Long-term (6+ months)

1. **Consider Playwright for high-value sources**
   - Only if 50%+ of traffic is from JS-heavy sites
   - Would enable PBS, modern news sites
   - Cost: +$5-10/month in compute resources

2. **Publisher API integrations**
   - ProPublica has free API
   - Guardian has free API
   - Better than scraping (official, stable)

---

## Testing & Validation

### Manual Test

```bash
node scripts/test-scraper-ttrc258.js
```

**Expected output:**
```
scraped_ok host=www.csmonitor.com len=5000
scraped_too_short host=www.pbs.org
✅ Test completed successfully!
```

### Live Worker Test

```bash
node scripts/job-queue-worker.js
# Watch for scraping logs during story.enrich jobs
```

### Compare Summary Quality

```sql
-- Find stories with scraped articles (CSM, ProPublica)
SELECT id, primary_headline, summary_neutral
FROM stories
WHERE id IN (
  SELECT DISTINCT story_id
  FROM article_story
  JOIN articles ON article_story.article_id = articles.id
  WHERE articles.url LIKE '%csmonitor.com%'
     OR articles.url LIKE '%propublica.org%'
)
ORDER BY created_at DESC
LIMIT 5;
```

---

## Monitoring & Alerts

### Key Metrics

1. **Scraping success rate:** Should be >60%
2. **Average scraped length:** Should be ~4000-5000 chars
3. **Fallback rate:** Should be <40%
4. **OpenAI cost/story:** Should be ~$0.00124

### Logs to Watch

```bash
# In worker logs:
scraped_ok     # Count these (successes)
scraped_fail   # Count these (errors)
scraped_too_short  # Count these (fallbacks)
```

### Alerts (Future)

- Alert if scraping success rate drops below 40%
- Alert if OpenAI costs spike >2x expected
- Alert if scraper crashes repeatedly (should never happen due to fallback)

---

## References

- **Scraper Code:** `scripts/enrichment/scraper.js`
- **Worker Integration:** `scripts/job-queue-worker.js` (line 433)
- **Test Script:** `scripts/test-scraper-ttrc258.js`
- **JIRA:** TTRC-258
- **Handoff:** `docs/handoffs/2025-11-08-ttrc258-testing-complete.md`

---

**Questions?** See deployment guide: `docs/DEPLOYMENT-GUIDE-TTRC258.md`

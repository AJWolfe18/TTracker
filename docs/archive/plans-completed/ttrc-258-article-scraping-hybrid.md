# TTRC-258: Article Scraping for Story Enrichment (Hybrid Approach)

**Created:** November 6, 2025
**Epic:** TTRC-250 (RSS Feed Expansion)
**Priority:** Medium
**Estimated Effort:** 1 story point (2-3 hours)

---

## Problem Statement

Current story enrichment uses only RSS `<description>` tags (~200 chars per article), resulting in shallow summaries. RSS feeds don't provide full article text—just 1-sentence teasers.

**Current Context to OpenAI:**
- 6 article titles
- 6 RSS descriptions (1 sentence each ≈ 30 words)
- **Total: ~200 words**

**Result:** Summaries are surface-level because input is surface-level.

---

## Solution: Pragmatic Hybrid Enrichment

**Strategy:**
- Use RSS feeds for discovery & clustering (keep as-is)
- Scrape full articles **only for enrichment** on allowed domains
- Respect paywalls and copyright (hardcoded block-list)
- Fall back to RSS on any error

**Why This Works:**
- Legal: Only scrape public, non-paywalled content
- Cost-effective: Scrape max 2 articles per cluster
- Safe: Timeouts, size limits, graceful fallbacks
- Simple: No schema changes, no new dependencies

---

## Technical Implementation

### File Structure

```
scripts/
  enrichment/
    scraper.js         ← NEW: Article scraping logic
    prompts.js         ← Existing: OpenAI prompts
  job-queue-worker.js  ← MODIFY: Call scraper in enrichStory()
```

### 1. Create `scripts/enrichment/scraper.js`

**Full Implementation (Node.js):**

```javascript
// Article scraper for story enrichment with legal/cost guardrails
// Node.js v22+ (uses native fetch + AbortController)
// No external dependencies needed

// ---------- Configuration ----------
const SCRAPE_ALLOWLIST = (process.env.SCRAPE_DOMAINS ?? 'csmonitor.com,pbs.org,propublica.org')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MAX_SCRAPED_PER_CLUSTER = 2;
const MAX_EXCERPT_CHARS = 2000;
const MAX_BYTES = 1_500_000;       // 1.5 MB
const FETCH_TIMEOUT_MS = 8000;
const PER_HOST_MIN_GAP_MS = Number(process.env.SCRAPE_MIN_GAP_MS ?? 1000);

const lastHit = new Map();

// ---------- Utilities ----------

/**
 * Check if domain is on allow-list and uses safe protocol
 */
function domainAllowed(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;  // Only http/https
    const h = u.hostname;
    return SCRAPE_ALLOWLIST.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

/**
 * Decode common HTML entities
 */
function decodeEntities(str) {
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };

  // Named entities
  str = str.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, match => map[match] ?? match);

  // Numeric entities
  str = str.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));

  return str;
}

/**
 * Fetch with timeout using native AbortController
 */
async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/**
 * Stream body to avoid unbounded memory if Content-Length is absent
 */
async function readTextWithCap(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) return await res.text(); // Fallback; Node 22 should have web stream

  const dec = new TextDecoder('utf-8');
  let received = 0;
  let out = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) throw new Error(`Too large (> ${maxBytes} bytes)`);
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

/**
 * Respect per-host rate limiting to prevent IP bans
 */
async function respectPerHostRate(url) {
  const host = new URL(url).hostname;
  const now = Date.now();
  const last = lastHit.get(host) ?? 0;
  const delta = now - last;
  if (delta < PER_HOST_MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, PER_HOST_MIN_GAP_MS - delta));
  }
  lastHit.set(host, Date.now());
}

/**
 * Scrape article body from URL
 * Returns cleaned text excerpt or empty string on failure
 */
async function scrapeArticleBody(url) {
  await respectPerHostRate(url);

  const res = await fetchWithTimeout(url, {
    headers: {
      // Honest UA with contact; many servers block "bare" bots
      'User-Agent': 'Mozilla/5.0 TrumpyTrackerBot/1.0 (+https://trumpytracker.com/contact)',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  }, FETCH_TIMEOUT_MS);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) throw new Error(`Bad content-type: ${ct}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  if (len && len > MAX_BYTES) throw new Error(`Too large: ${len}`);

  const html = await readTextWithCap(res, MAX_BYTES);

  // Prefer <article>, then common content containers
  let m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  let chunk = m?.[1];
  if (!chunk) {
    m = html.match(/<(div|section)\b[^>]*(article-body|story-body|entry-content|content__article-body)[^>]*>([\s\S]*?)<\/\1>/i);
    chunk = m?.[3];
  }
  if (!chunk) return '';

  const text = decodeEntities(
    chunk
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  return text.slice(0, MAX_EXCERPT_CHARS);
}

/**
 * Enrich articles for story enrichment
 * Scrapes up to 2 articles from allowed domains, falls back to RSS for others
 *
 * @param {Array} articles - Array of article objects with url, source_domain, title, description
 * @returns {Promise<Array>} Articles with enriched excerpts
 */
export async function enrichArticlesForSummary(articles) {
  // Choose up to 2 allowed domains (distinct hosts)
  const picks = [];
  const seen = new Set();

  for (let i = 0; i < articles.length && picks.length < MAX_SCRAPED_PER_CLUSTER; i++) {
    const a = articles[i];
    if (!a?.url || !domainAllowed(a.url)) continue;
    const host = new URL(a.url).hostname;
    if (seen.has(host)) continue;
    seen.add(host);
    picks.push(i);
  }

  return await Promise.all(articles.map(async (a, idx) => {
    const fallback = (a.excerpt ?? a.description ?? '').slice(0, MAX_EXCERPT_CHARS);

    if (!picks.includes(idx)) {
      return { ...a, excerpt: fallback };
    }
    try {
      const scraped = await scrapeArticleBody(a.url);
      if (scraped && scraped.length > 300) {
        console.log(`scraped_ok host=${new URL(a.url).hostname} len=${scraped.length}`);
        return { ...a, excerpt: scraped };
      }
      console.log(`scraped_too_short host=${new URL(a.url).hostname}`);
    } catch (e) {
      console.log(`scraped_fail host=${new URL(a.url).hostname} err=${e.message}`);
    }
    return { ...a, excerpt: fallback };
  }));
}
```

### 2. Update `scripts/job-queue-worker.js`

**Modify `enrichStory()` method (around line 422):**

```javascript
import { enrichArticlesForSummary } from './enrichment/scraper.js';

// ... existing code ...

async enrichStory(payload) {
  // ... existing code up to "3. FETCH ARTICLES & BUILD CONTEXT" ...

  const links = await this.fetchStoryArticles(story_id);
  if (!links.length) {
    console.error(`❌ No articles found for story ${story_id}`);
    throw new Error('No articles found for story');
  }

  // NEW: Enrich articles with scraping where allowed
  const articlesForEnrichment = links.map(({ articles }) => ({
    url: articles.url,
    source_domain: articles.source_domain,
    title: articles.title || '',
    source_name: articles.source_name || '',
    description: articles.content || articles.excerpt || ''
  }));

  const enriched = await enrichArticlesForSummary(articlesForEnrichment);

  const userPayload = buildUserPayload({
    primary_headline: story.primary_headline || '',
    articles: enriched
  });

  // ... rest of OpenAI call unchanged ...
}
```

---

## Domain Policy

### ✅ Allowed (Public, Non-Paywalled)

- `csmonitor.com` - Christian Science Monitor (public)
- `pbs.org` - PBS NewsHour (public broadcasting)
- `propublica.org` - ProPublica (non-profit, CC licensed)

### ❌ Blocked (Paywalled or Restricted)

- `nytimes.com` - Paywalled
- `wsj.com` - Paywalled
- `theatlantic.com` - Paywalled
- `newyorker.com` - Paywalled
- `fortune.com` - Paywalled
- `washingtonpost.com` - Paywalled (even with RSS)

**For blocked domains:** Use RSS description only (~200 chars)

---

## Guardrails

1. **Max 2 articles scraped per cluster** - Prevents cost explosion
2. **8s fetch timeout** - Don't wait forever for slow sites
3. **1.5 MB size limit** - Reject huge pages
4. **Content-Type check** - Only process `text/html`
5. **Graceful fallback** - Use RSS on any error
6. **No full-text persistence** - Store only summaries, not scraped content

---

## Testing Plan

### Test Case 1: Allowed Domain (CSM)

```sql
-- Manually enqueue enrichment job for testing
SELECT public.enqueue_fetch_job(
  'story.enrich',
  jsonb_build_object('story_id', 123),
  NULL
);

-- Check article sources
SELECT a.url, a.source_domain
FROM article_story ast
JOIN articles a ON a.id = ast.article_id
WHERE ast.story_id = 123;
```

**Expected:**
- Scraper fetches full article
- Logs: `✅ Scraped 1500 chars from csmonitor.com`
- Summary improves with more context

### Test Case 2: Blocked Domain (Atlantic)

**Expected:**
- Scraper skips (not in allow-list)
- Uses RSS description only
- Logs: No scrape attempt
- Summary based on 200-char RSS blurb

### Test Case 3: Scrape Failure

**Mock:** Timeout or 404 error

**Expected:**
- Logs: `⚠️ Scrape failed for URL: timeout`
- Falls back to RSS description
- No error thrown, enrichment continues

### Test Case 4: Mixed Sources

**Cluster with:** NYT + CSM + PBS

**Expected:**
- Scrapes CSM and PBS (2 max)
- Skips NYT (blocked)
- Final context: 2×2000 chars + 1×200 chars

---

## Cost Analysis

### Current Cost (RSS Only)

- Input: ~1200 chars (6 articles × 200 chars)
- Tokens: ~300 input tokens
- Cost: $0.000045 per story

### New Cost (With Scraping)

- Input: 2×2000 chars + 4×200 chars = 4800 chars
- Tokens: ~1200 input tokens
- Cost: $0.00018 per story

**Increase:** 4× cost, but still **$0.0002 per story**

**For 100 stories/day:** $0.02/day = $0.60/month (negligible)

**Node 22 Performance Benefits:**
- Native fetch eliminates node-fetch dependency overhead
- Native streams for memory-safe large page handling
- Built-in AbortController with zero external deps

---

## Acceptance Criteria

**Implementation:**
- [ ] `scripts/enrichment/scraper.js` created with Node 22 native implementation
- [ ] No `node-fetch` or `abort-controller` imports (uses native globals)
- [ ] `scripts/job-queue-worker.js` updated to use scraper
- [ ] ESM/CJS consistent (verified `package.json` has `"type": "module"`)

**Testing:**
- [ ] Test enrichment on story with CSM/PBS sources (verify scraping works)
- [ ] Test enrichment on story with Atlantic/NYT sources (verify RSS fallback)
- [ ] Test with network timeout/error (verify graceful fallback)
- [ ] Stream cap works (simulate missing Content-Length with large page)
- [ ] Per-host rate limit observed in logs (≥1s gap between same-host requests)
- [ ] Protocol validation rejects non-http/https URLs

**Quality:**
- [ ] Worker runs without errors
- [ ] Logs use standardized format: `scraped_ok`, `scraped_fail`, `scraped_too_short`, `fallback_rss`
- [ ] DB audit confirms no full text persisted (only summaries stored)
- [ ] Manual QA: Compare summaries before/after for 3-5 stories
- [ ] Note examples of materially richer summaries

**Documentation:**
- [ ] Document findings in handoff (`docs/handoffs/YYYY-MM-DD-ttrc258-complete.md`)

---

## Future Enhancements (Phase 2)

**When you hit 50+ feeds:**

1. **Publisher Policy Table**
   ```sql
   CREATE TABLE publisher_policy (
     source_domain text PRIMARY KEY,
     allow_scrape boolean,
     prefers_api boolean,
     api_name text
   );
   ```

2. **API Integrations**
   - Guardian Open Platform API
   - NPR API
   - NYT Article API (abstracts only)

3. **Better Extraction**
   - Use Mozilla Readability library
   - Better handling of dynamic content
   - Image extraction for context

4. **Robots.txt Compliance**
   - Check `robots.txt` before scraping
   - Respect `Crawl-delay` directive

---

## Rollback Plan

If scraping causes issues:

1. **Emergency disable (kill-switch):**
   ```bash
   export SCRAPE_DOMAINS=""  # Empty = disable all scraping
   # Worker will bypass scraper entirely, fall back to RSS-only
   ```

2. **Revert code:**
   ```bash
   git revert <commit-hash>
   git push origin test
   ```

3. **Verify:**
   - Check worker logs (no scrape attempts)
   - Summaries back to RSS-only baseline

---

## References

- JIRA: TTRC-258
- Epic: TTRC-250 (RSS Feed Expansion)
- Session: November 6-7, 2025
- Planning Handoff: `docs/handoffs/2025-11-06-ttrc258-article-scraping-plan.md`
- Implementation Handoff: TBD (`docs/handoffs/YYYY-MM-DD-ttrc258-complete.md`)

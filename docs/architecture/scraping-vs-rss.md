# Scraping vs RSS Feeds: How Services Like RSS.app Work

**Date:** 2025-11-11
**Context:** Understanding alternatives to dead RSS feeds (Reuters, AP News)

---

## The Problem

Many news sites have **killed their RSS feeds**:
- **Reuters:** Discontinued June 2020
- **AP News:** Discontinued public RSS (commercial licensing only)
- **Time:** RSS feed empty/unreliable

But services like **RSS.app, OpenRSS, and Apify** can still generate feeds for these sites. How?

---

## How RSS.app Works (The Secret Sauce)

### Step-by-Step Process

```
User subscribes to AP News feed
         ↓
RSS.app receives request
         ↓
Every 15 minutes (Developer plan):
  1. Scraper bot visits https://apnews.com/hub/politics
  2. Fetches HTML content
  3. Parses HTML structure
  4. Identifies article elements using:
     - CSS selectors (div.article-card)
     - Pattern matching (links to /article/*)
     - AI/ML models (identify content vs ads)
  5. Extracts data:
     - Title (h2/h3 tags)
     - URL (href attributes)
     - Excerpt (p tags or meta description)
     - Date (time tags or data attributes)
     - Image (img src)
  6. Converts to RSS 2.0 XML format
  7. Caches generated feed
  8. Serves to subscribers
```

### Technical Stack (Likely)

**Backend:**
- Node.js or Python
- **Web Scraping:** Puppeteer (headless Chrome) or Cheerio (HTML parsing)
- **Queue System:** Bull, RabbitMQ, or similar (scheduling scrapes)
- **Database:** PostgreSQL or MongoDB (cache feeds)
- **CDN:** Cloudflare (serve cached feeds fast)

**Infrastructure:**
- Docker containers (isolate scraping jobs)
- AWS/GCP/Azure (scalable compute)
- Proxies (avoid IP bans)
- Rate limiting (respect site ToS)

---

## How We Could Replicate It

### Option 1: Build Our Own Scraper (DIY RSS.app)

**Created:** `scripts/scrapers/ap-news-scraper.js` (template)

**Steps to Implement:**

1. **Install Dependencies**
   ```bash
   npm install cheerio axios
   # Or for JavaScript-heavy sites:
   npm install puppeteer
   ```

2. **Inspect Target Site Structure**
   - Visit https://apnews.com/hub/politics
   - Open DevTools (F12)
   - Find article containers:
     ```html
     <div class="PageList-items-item">
       <a href="/article/abc123">
         <h2>Article Title</h2>
         <p>Article excerpt...</p>
         <time datetime="2025-11-11">Nov 11</time>
       </a>
     </div>
     ```

3. **Write Scraper Logic**
   ```javascript
   const cheerio = require('cheerio');
   const axios = require('axios');

   async function scrapeAPNews() {
     const { data } = await axios.get('https://apnews.com/hub/politics', {
       headers: {
         'User-Agent': 'Mozilla/5.0...'
       }
     });

     const $ = cheerio.load(data);
     const articles = [];

     $('.PageList-items-item').each((i, elem) => {
       articles.push({
         title: $(elem).find('h2').text().trim(),
         url: 'https://apnews.com' + $(elem).find('a').attr('href'),
         excerpt: $(elem).find('p').text().trim(),
         pubDate: new Date($(elem).find('time').attr('datetime'))
       });
     });

     return articles;
   }
   ```

4. **Integrate with Job Queue**
   - Add "scraper" job type to `job-queue-worker.js`
   - Detect feed_url starting with `scraper://`
   - Route to appropriate scraper function

5. **Schedule Regular Scrapes**
   - Same as RSS: every 2-4 hours
   - Store in `articles` table (existing schema works)

**Pros:**
- ✅ **Free** (no subscription)
- ✅ **Full control** (customize extraction)
- ✅ **No third-party dependency**
- ✅ **Learning experience**

**Cons:**
- ❌ **Maintenance burden** (site changes break scraper)
- ❌ **Development time** (2-4 hours initial, ongoing fixes)
- ❌ **Legal gray area** (scraping ToS)
- ❌ **More complex** (need to handle rate limiting, errors, changes)

---

### Option 2: Use RSS.app (Outsource the Problem)

**Service:** https://rss.app/pricing
**Plan:** Developer ($20/month)

**What you get:**
- 100 feeds (use 3-5, have room to grow)
- 15-minute refresh rate
- They handle all scraping complexity
- Reliable infrastructure (used by Microsoft, HubSpot)
- Support team if issues arise

**Setup:**
1. Sign up for Developer plan
2. Generate feeds:
   - Input: https://apnews.com/hub/politics
   - Output: https://rss.app/feeds/abc123.xml
3. Add to `feed_registry` like normal RSS
4. Worker fetches via rss-parser (existing code)

**Pros:**
- ✅ **Fast** (working in 5 minutes)
- ✅ **Reliable** (they maintain scrapers)
- ✅ **Scalable** (100 feeds available)
- ✅ **Support** (help if problems)
- ✅ **Legal cover** (they handle ToS)

**Cons:**
- ❌ **Costs $20/month** ($240/year)
- ❌ **Third-party dependency** (if they go down, we're affected)
- ❌ **Less control** (can't customize extraction)
- ❌ **Potential ToS risk** (political content flag?)

---

### Option 3: Use OpenRSS (Nonprofit Alternative)

**Service:** https://openrss.org
**Cost:** Free (donation-funded)

**Format:** `https://openrss.org/apnews.com/hub/politics`

**Pros:**
- ✅ **Free**
- ✅ **Similar to RSS.app**
- ✅ **Nonprofit mission** (more legally defensible)

**Cons:**
- ❌ **Reliability unknown** (DDoS in Aug 2024)
- ❌ **Rate limits unknown**
- ❌ **No SLA** (best-effort service)
- ❌ **Might not support AP News** (needs testing)

---

### Option 4: Skip AP/Reuters (Focus on Native RSS)

**Strategy:** Ignore dead feeds, double down on quality RSS sources

**Available Native RSS:**
- NYT Politics ✅
- WaPo Politics ✅
- Politico ✅
- PBS NewsHour ✅
- CSM Politics ✅
- BBC News ✅ (TTRC-255)
- The Guardian ✅ (TTRC-255)
- The Economist ✅ (TTRC-255)
- Bloomberg ✅ (future)
- Financial Times ✅ (future)

**Rationale:**
- AP/Reuters content gets **republished** by other outlets
- Our **clustering** groups related stories
- We'll still capture major news, just via secondary sources
- No scraping complexity or costs

**Pros:**
- ✅ **Simple** (no new systems)
- ✅ **Free** (no subscriptions)
- ✅ **Legal** (using official RSS)
- ✅ **Reliable** (publishers maintain feeds)

**Cons:**
- ❌ **Less comprehensive** (miss some AP/Reuters-only stories)
- ❌ **Slower** (wait for republishing)
- ❌ **No wire service** (lose breaking news edge)

---

## Comparison Table

| Approach | Cost | Dev Time | Maintenance | Legal Risk | Speed | Reliability |
|----------|------|----------|-------------|------------|-------|-------------|
| **DIY Scraper** | $0 | 4-8h | High | Medium | Fast | Medium |
| **RSS.app** | $20/mo | 5min | None | Low | Fast | High |
| **OpenRSS** | $0 | 5min | None | Low | Medium | Medium |
| **Skip It** | $0 | 0h | None | None | N/A | High |

---

## How RSS.app Makes Money

**Business Model:**
- **Free users:** 2 feeds, 24h refresh (hook)
- **Basic:** $9/mo, 15 feeds, 60min refresh (casual users)
- **Developer:** $20/mo, 100 feeds, 15min refresh (businesses like us)
- **Pro:** $100/mo, 500 feeds, API access (enterprises)

**Value Proposition:**
- "We scrape so you don't have to"
- Handle site changes, rate limiting, legal risk
- Reliable infrastructure (better than DIY)
- Support multiple sources (100+ feeds)

**Why it works:**
- Scraping is hard to do well
- Sites change frequently (break scrapers)
- Rate limiting/IP bans are annoying
- $20/mo cheaper than developer time

---

## Legal Considerations

### Web Scraping Legality

**Generally Legal IF:**
- ✅ Publicly accessible data (no login required)
- ✅ Respect robots.txt (check allowed paths)
- ✅ Don't overwhelm servers (rate limit requests)
- ✅ Don't republish full articles (fair use excerpts)
- ✅ Commercial use with proper attribution

**Potential Issues:**
- ❌ Terms of Service violations (many sites ban scraping)
- ❌ Copyright infringement (if republishing full content)
- ❌ CFAA violations (unauthorized access)
- ❌ Trademark issues (brand confusion)

**Our Use Case:**
- **Public data:** AP News hub is public
- **Excerpts only:** We use 5000-char limit
- **Attribution:** We cite sources
- **Non-commercial:** TrumpyTracker is accountability journalism (arguably non-commercial)

**Risk Level:** LOW-MEDIUM (fair use, public interest, excerpts only)

**Mitigation:**
- Use RSS.app (they take legal risk)
- Or OpenRSS (nonprofit mission)
- Or stick to official RSS feeds (zero risk)

---

## Recommendation Decision Tree

```
Do you have $20/month budget?
├─ YES → Do you value speed > control?
│         ├─ YES → Use RSS.app (Developer plan)
│         └─ NO → Build DIY scraper
└─ NO → Can you spare 4-8 hours development?
          ├─ YES → Build DIY scraper
          └─ NO → Skip AP/Reuters, use native RSS sources
```

---

## Next Steps (If Building DIY Scraper)

### Phase 1: Prototype (2-4 hours)
1. Install Cheerio/Puppeteer
2. Inspect AP News HTML
3. Write scraper function
4. Test locally (get 10 articles)
5. Validate data quality

### Phase 2: Integration (2 hours)
6. Add "scraper" job type to worker
7. Update feed_registry schema (add `feed_type: 'rss' | 'scraper'`)
8. Route scraper:// URLs to appropriate function
9. Test end-to-end

### Phase 3: Production (1 hour)
10. Add error handling (site changes, timeouts)
11. Add rate limiting (respect AP ToS)
12. Deploy to TEST
13. Monitor for 48h

### Phase 4: Maintenance (Ongoing)
14. Monitor error logs
15. Update selectors when site changes
16. Add new scrapers for other dead feeds

**Total Time Investment:** 6-12 hours initial + ongoing maintenance

**Is it worth it vs $20/mo RSS.app?**
- $240/year = 12 hours of developer time at $20/hr
- If you value learning/control → YES
- If you value time/reliability → NO

---

## Conclusion

**How RSS.app works:** They scrape websites, parse HTML, extract articles, convert to RSS, cache, and serve to subscribers. That's it - no magic, just good engineering.

**Can we replicate it?** YES - it's 6-12 hours of work for AP/Reuters/Time.

**Should we replicate it?** Depends on your priorities:
- **Time > Money:** Use RSS.app ($20/mo)
- **Money > Time:** Build DIY scraper (free)
- **Simplicity > Coverage:** Skip AP/Reuters, use native RSS

**My recommendation:** Start with native RSS sources (9-12 quality feeds), revisit AP/Reuters later if coverage gaps emerge.

---

**References:**
- AP News Scraper Template: `scripts/scrapers/ap-news-scraper.js`
- RSS.app Pricing: https://rss.app/pricing
- OpenRSS: https://openrss.org
- Apify AP Scraper: https://apify.com/theo/ap-news-scraper

**Last Updated:** 2025-11-11

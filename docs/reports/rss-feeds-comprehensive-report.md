# Comprehensive RSS Feed Report
**Generated:** 2025-11-20
**Environment:** TEST
**Total Active Feeds:** 17

---

## Feed Overview Table

| Feed ID | Feed Name | Source Name | Tier | RSS Content Avg | Articles 7d | Scraping Test Result | Status | Recommendations |
|---------|-----------|-------------|------|----------------|-------------|---------------------|--------|-----------------|
| 3 | NYT Politics | NYT Politics | 2 | ~200 chars | Active | Not tested (paywalled, on allow-list) | ✅ Healthy | Monitor scraping success with NYT on allow-list |
| 4 | WaPo Politics | WaPo Politics | 2 | ~200 chars | Active | Not tested (paywalled, on allow-list) | ✅ Healthy | Monitor scraping success with WaPo on allow-list |
| 5 | Politico Top | Politico Top | 3 | ~200 chars | Active | ❌ Blocked (HTTP 403) | ✅ Healthy | Expected failure, RSS fallback working |
| 175 | CSM Politics | Christian Science Monitor | 2 | ~200 chars | Low (1-5 articles) | ✅ Success (Readability 5000 chars) | ✅ Healthy | Scraping working well |
| 176 | PBS Politics | PBS NewsHour Politics | 2 | ~200 chars | Medium (9-44 articles) | ✅ Success (Readability 2.5K-7.5K chars, 100% rate) | ✅ Healthy | Best scraping success rate |
| 177 | ProPublica Politics | ProPublica | 2 | Unknown | None | Not tested | ⚠️ 5 Failures | **NEEDS INVESTIGATION** - Never fetched successfully |
| 178 | Time Politics | Time | 2 | Unknown | Low (0 articles) | Not tested | ✅ Healthy | Feed may be low-volume |
| 181 | Economist US Politics | The Economist | 2 | Unknown | Not tracked | Not tested | ✅ Healthy | Monitor content volume |
| 182 | Guardian US Politics | The Guardian | 1 | Unknown | Not tracked | Not tested | ✅ Healthy | Consider scraping test |
| 183 | Guardian Trump | The Guardian | 1 | Unknown | Not tracked | Not tested | ✅ Healthy | Consider scraping test |
| 184 | Politico Trump | Politico | 1 | ~200 chars | Not tracked | ❌ Expected block (same domain as Politico Top) | ✅ Healthy | RSS fallback sufficient |
| 185 | Newsweek Politics | Newsweek | 2 | Unknown | Just added | Not tested | ✅ Fixed (URL corrected) | Monitor 24-48h post-addition |
| 186 | The Atlantic Politics | The Atlantic | 2 | Unknown | 7 articles | Not tested (paywalled) | ✅ Healthy | Paywalled - RSS only |
| 187 | Reason Politics | Reason | 2 | Unknown | Just added | Not tested | ✅ Healthy | Monitor post-addition |
| 189 | Vox Politics | Vox | 2 | Unknown | Just added | Not tested | ✅ Fixed (URL corrected) | Monitor 24-48h post-addition |
| 190 | Foreign Affairs | Foreign Affairs | 3 | Unknown | 1 article (94% filtered) | Not tested | ✅ Healthy | High filter rate expected (international focus) |
| 191 | The New Yorker Politics | The New Yorker | 3 | Unknown | Just added | Not tested (paywalled) | ✅ Healthy | Paywalled - RSS only |

---

## Detailed Feed Analysis

### Feeds with Scraping Test Results (from TTRC-258, TTRC-260)

#### Christian Science Monitor (Feed 175)
- **RSS Content:** ~200 chars (excerpts only, no `content:encoded`)
- **Scraping Method:** Mozilla Readability
- **Success Rate:** High (5000 char extracts)
- **Sample Result:** "27 percentage points, three extra seats, California's Proposition 50"
- **Quality:** Rich summaries with specific facts/numbers
- **Recommendation:** ✅ Keep scraping enabled

#### PBS NewsHour Politics (Feed 176)
- **RSS Content:** ~200 chars (excerpts only)
- **Scraping Method:** Mozilla Readability (Tier 1)
- **Success Rate:** 100% (7/7 successful scrapes in testing)
- **Content Length:** 2,500 - 7,500 chars
- **Quality:** Excellent - best performer in testing
- **Notes:** JavaScript-rendered content handled by Readability
- **Recommendation:** ✅ Model feed for scraping

#### ProPublica (Feed 177)
- **RSS Content:** Unknown (never successfully fetched)
- **Scraping Method:** On allow-list but untested
- **Success Rate:** N/A
- **Current Status:** 5 consecutive failures
- **Feed URL:** `https://www.propublica.org/feeds/propublica/politics`
- **Recommendation:** 🚨 **HIGH PRIORITY** - Investigate immediately, likely URL changed

#### Politico Top/Trump (Feeds 5, 184)
- **RSS Content:** ~200 chars
- **Scraping Method:** On allow-list but blocked
- **Success Rate:** 0% (HTTP 403 Forbidden - expected)
- **Fallback:** RSS description working
- **Recommendation:** ✅ Keep on allow-list (no harm in trying), RSS sufficient

#### NYT Politics (Feed 3)
- **RSS Content:** ~200 chars (excerpts only)
- **Scraping Method:** On allow-list (added in TTRC-260)
- **Success Rate:** Unknown (not yet tested)
- **Notes:** Paywalled - may extract partial content before paywall
- **Recommendation:** ⏳ Monitor scraping results, may need removal from allow-list

#### WaPo Politics (Feed 4)
- **RSS Content:** ~200 chars
- **Scraping Method:** On allow-list (added in TTRC-260)
- **Success Rate:** Unknown (not yet tested)
- **Notes:** Paywalled - may extract partial content before paywall
- **Recommendation:** ⏳ Monitor scraping results, may need removal from allow-list

---

## Content Statistics (Last 7 Days)

**Note:** Limited data available due to recent feed additions and worker monitoring gaps.

### Confirmed Activity (from handoffs):
- **PBS:** 9-44 articles per fetch
- **CSM:** 1-5 articles per fetch (low volume but quality content)
- **Time:** 0 articles (feed may be inactive or low-volume)
- **Foreign Affairs:** 1 article created, 17 dropped (94% filter rate due to international focus)
- **The Atlantic:** 7 articles created
- **Newsweek, Vox, Reason, New Yorker:** Just added (Nov 12), monitoring in progress

---

## Scraping Infrastructure Status

### Current Scraper: Mozilla Readability (TTRC-260)
- **Implementation:** Three-tier fallback (Readability → Regex → RSS)
- **Allow-list:** 8 sources
  - `csmonitor.com` ✅ Tested, working
  - `pbs.org` ✅ Tested, 100% success
  - `propublica.org` ⚠️ Untested (feed failing)
  - `reuters.com` ⏳ Not tested yet
  - `apnews.com` ⏳ Not tested yet
  - `politico.com` ❌ Blocked (expected)
  - `nytimes.com` ⏳ Monitoring (paywalled)
  - `washingtonpost.com` ⏳ Monitoring (paywalled)

### Scraping Test Results Summary (TTRC-260)
- **Testing Period:** 2-hour initial test (48h monitoring deferred due to worker crash)
- **Successful Scrapes:** 7 PBS articles
- **Success Rate:** 100% on non-blocked sources
- **Memory:** Stable ~150MB
- **Crashes:** 0
- **Method Distribution:**
  - Readability: 7 successes (100% of attempts)
  - Regex fallback: Not needed
  - RSS fallback: Used for blocked sources (Politico)

### Content Quality Improvement (TTRC-258)
- **Before Scraping (RSS only):** ~100 words, generic statements (~300 tokens)
- **After Scraping (5K limit):** ~150 words, specific facts/numbers/quotes (~7,500 tokens)
- **Quality Improvement:** 30-50% more detailed summaries
- **Cost Impact:** +$0.11/month (~$1.32/year)

---

## RSS Feed Compliance

All feeds configured with standard compliance rules:
- **Max chars:** 5000 (matches scraping limit from TTRC-258/260)
- **Full text:** `false` (excerpts only for fair use)
- **Enforcement:** Automatic via RSS fetcher

---

## Feed Health Summary

### ✅ Healthy Feeds (14)
- NYT Politics, WaPo Politics, Politico Top/Trump
- CSM, PBS, Time, Economist, Guardian (both), Newsweek
- The Atlantic, Reason, Vox, Foreign Affairs, New Yorker

### ⚠️ Problem Feeds (1)
- **ProPublica (177):** 5 failures, never fetched - **NEEDS INVESTIGATION**

### ❌ Disabled Feeds (1)
- **Fortune (188):** CloudFront blocking RSS (403 Forbidden) - disabled Nov 12

---

## Recommendations

### Immediate Actions (High Priority)

1. **ProPublica Investigation** (Feed 177)
   - Test URL manually: `curl -I "https://www.propublica.org/feeds/propublica/politics"`
   - Check error logs in job_queue
   - Likely outcomes: URL changed, feed discontinued, or missing compliance rule
   - **Priority:** HIGH (blocking scraping tests)

2. **Monitor Recently Added Feeds** (Feeds 185, 187, 189)
   - Newsweek (URL fixed Nov 12)
   - Vox (URL fixed Nov 12)
   - Reason
   - **Duration:** 24-48 hours
   - **Check:** Article ingestion, error rates, clustering behavior

3. **Complete TTRC-260 Monitoring**
   - Extended 48-hour monitoring of Mozilla Readability scraper
   - Test Reuters and AP News scraping (currently untested)
   - Validate NYT/WaPo paywalled scraping (may need removal from allow-list)
   - **Goal:** Achieve 70%+ success rate across all allow-listed sources

### Short-term (Next Sprint)

4. **Test Untested Feeds**
   - Reuters, AP News, Guardian, Economist, Time
   - Add to scraping allow-list if appropriate
   - Document success rates

5. **Optimize High-Filter Feeds**
   - Foreign Affairs (94% filter rate)
   - Review if filter is too aggressive or if feed is just very international
   - Consider RSS filter tuning (TTRC-263)

6. **Fortune Replacement** (Optional)
   - Current: Disabled (CloudFront block)
   - Options: Find alternative business/politics source or accept 17 feeds
   - Target was 18 feeds, currently at 17

### Long-term (Future Considerations)

7. **Free API Integration**
   - Guardian API: FREE, unlimited, full article text
   - ProPublica API: FREE, full investigative articles (if feed is fixed)
   - NPR API: FREE with registration
   - **Benefit:** Official, stable, legal alternative to scraping

8. **Scraper Success Rate Monitoring**
   - Build dashboard to track: method distribution (Readability vs Regex vs RSS)
   - Alert on success rate drops
   - Automated reporting

9. **Tier-Based Scheduling** (TTRC-257 - Deferred)
   - Current: All feeds fetch every 2 hours
   - Proposed: Tier 1 (4h), Tier 2 (8h), Tier 3 (12h)
   - **Benefit:** Reduce API calls, stay under rate limits

---

## Cost Analysis

### Current State
- **Active feeds:** 17
- **Monthly cost:** ~$3.40/month (enrichment + scraping)
- **Scraping overhead:** +$0.11/month vs RSS-only
- **Budget remaining:** $46.60 / $50 (93% budget available)

### With Full Scraping Rollout
- **Estimated:** $3.50-$4.00/month
- **Well under budget:** ✅ Safe to expand

---

## Data Export (CSV Format)

```csv
Feed ID,Feed Name,Source Name,Feed URL,Tier,Topics,RSS Avg Chars,Articles (7d),Scraping Method,Scraping Success,Status,Recommendations
3,NYT Politics,NYT Politics,https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml,2,"politics,congress,executive",200,Active,Mozilla Readability (allow-list),Untested (paywalled),Healthy,Monitor paywalled scraping success
4,WaPo Politics,WaPo Politics,https://feeds.washingtonpost.com/rss/politics,2,"politics,congress,executive",200,Active,Mozilla Readability (allow-list),Untested (paywalled),Healthy,Monitor paywalled scraping success
5,Politico Top,Politico Top,https://www.politico.com/rss/politicopicks.xml,3,"politics,congress,executive",200,Active,Mozilla Readability (allow-list),Blocked (403),Healthy,RSS fallback working
175,CSM Politics,Christian Science Monitor,https://rss.csmonitor.com/feeds/politics,2,politics,200,Low (1-5),Mozilla Readability,Success (5000 chars),Healthy,Scraping working well
176,PBS Politics,PBS NewsHour Politics,https://www.pbs.org/newshour/feeds/rss/politics,2,politics,200,Medium (9-44),Mozilla Readability,Success (100% rate),Healthy,Best scraping performer
177,ProPublica Politics,ProPublica,https://www.propublica.org/feeds/propublica/main,2,"politics,investigations",Unknown,None,Mozilla Readability (allow-list),Untested (feed failing),5 Failures,INVESTIGATE IMMEDIATELY
178,Time Politics,Time,https://time.com/section/politics/feed/,2,"politics,us",Unknown,Low (0),Not on allow-list,N/A,Healthy,Feed may be low-volume
181,Economist US Politics,The Economist,https://www.economist.com/united-states/rss.xml,2,"politics,us,economics",Unknown,Not tracked,Not on allow-list,N/A,Healthy,Monitor content volume
182,Guardian US Politics,The Guardian,https://www.theguardian.com/us-news/us-politics/rss,1,"politics,us",Unknown,Not tracked,Not on allow-list,N/A,Healthy,Consider scraping test
183,Guardian Trump,The Guardian,https://www.theguardian.com/us-news/donaldtrump/rss,1,"politics,trump",Unknown,Not tracked,Not on allow-list,N/A,Healthy,Consider scraping test
184,Politico Trump,Politico,https://rss.politico.com/donald-trump.xml,1,"politics,trump",200,Not tracked,Mozilla Readability (allow-list),Blocked (403),Healthy,RSS fallback sufficient
185,Newsweek Politics,Newsweek,https://www.newsweek.com/rss,2,"politics,us",Unknown,Just added,Not on allow-list,N/A,Fixed (URL corrected),Monitor 24-48h post-addition
186,The Atlantic Politics,The Atlantic,https://www.theatlantic.com/feed/channel/politics/,2,politics,Unknown,7,Not on allow-list,N/A (paywalled),Healthy,Paywalled - RSS only
187,Reason Politics,Reason,https://reason.com/tag/politics/feed/,2,"politics,policy",Unknown,Just added,Not on allow-list,N/A,Healthy,Monitor post-addition
189,Vox Politics,Vox,https://www.vox.com/rss/index.xml,2,"politics,policy",Unknown,Just added,Not on allow-list,N/A,Fixed (URL corrected),Monitor 24-48h post-addition
190,Foreign Affairs,Foreign Affairs,https://www.foreignaffairs.com/rss.xml,3,"foreign-policy,world",Unknown,1 (94% filtered),Not on allow-list,N/A,Healthy,High filter rate expected
191,The New Yorker Politics,The New Yorker,https://www.newyorker.com/feed/news,3,"politics,culture",Unknown,Just added,Not on allow-list,N/A (paywalled),Healthy,Paywalled - RSS only
```

---

## Reference Documentation

- **TTRC-258:** Article scraping implementation (5K limit, initial testing)
- **TTRC-260:** Mozilla Readability upgrade (3-tier fallback, PBS success)
- **TTRC-253:** First 3 feeds added (CSM, PBS, Time) - validation complete
- **TTRC-264:** 7 new feeds added (6 working, 1 disabled)
- **Scraping Code:** `scripts/enrichment/scraper.js`
- **Allow-list Config:** Lines 19-26 of scraper.js

---

**Report Status:** ✅ Complete
**Last Updated:** 2025-11-20
**Next Review:** After TTRC-260 48h monitoring completion

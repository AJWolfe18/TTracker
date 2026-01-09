# TrumpyTracker Content Enrichment Options
**Date:** November 8, 2025  
**Purpose:** Evaluation of methods to get full article content for better AI summaries  
**Current Issue:** RSS feeds only provide 200-500 chars, resulting in surface-level summaries  
**Budget Constraint:** Total system must stay under $50/month

---

## Current Implementation Status

### ✅ What You Have Working
- **OpenAI Integration:** GPT-4o-mini generating summaries ($0.0002/story)
- **Article Scraping:** Basic implementation for allowed domains (CSM, PBS, ProPublica)
- **RSS Pipeline:** Processing 6+ feeds successfully
- **Story Clustering:** Grouping related articles to reduce duplicates

### ❌ The Problem
- RSS feeds only provide headlines + 1-2 sentences (200-500 chars)
- Scraping is blocked by most major news sites (NYT, WaPo, CNN = 403 errors)
- OpenAI needs 1500+ chars of context to create meaningful summaries
- Current summaries are generic because AI lacks article details

---

## Option 1: Enhanced RSS Parsing (FREE - Immediate)

**Many RSS feeds include full content in hidden fields you're not parsing.**

### Implementation
```javascript
// Add to your RSS parser to extract ALL available fields:
const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],  // FULL ARTICLE HTML
      ['media:content', 'mediaContent'],      // Videos/images
      ['media:thumbnail', 'mediaThumbnail'],  // Image URLs
      ['dc:creator', 'creator']               // Author name
    ]
  }
});
```

### Which Sources Have Full Content?
**High Content (1000+ chars in content:encoded):**
- ProPublica: 2000+ chars
- NPR: 800-1500 chars  
- BBC: 600-1000 chars
- The Guardian: 800-1200 chars
- Most WordPress blogs
- Substack newsletters

**Test Your Feeds:**
```javascript
// Run this to see what you're missing:
feed.items.forEach(item => {
  console.log(`
    Title: ${item.title}
    Description length: ${item.description?.length || 0}
    Full content length: ${item.contentEncoded?.length || 0}  // ← YOU WANT THIS
    Has thumbnail: ${!!item.mediaThumbnail}
  `);
});
```

**Cost:** $0  
**Effort:** 30 minutes  
**Improvement:** 2-5x more content for many sources

---

## Option 2: AI-Powered URL Fetching Services ($20-30/month)

**Services that fetch and read URLs like ChatGPT does:**

### A. Perplexity API (RECOMMENDED)
```javascript
const response = await fetch('https://api.perplexity.ai/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'pplx-7b-online',  // Can fetch URLs
    messages: [{
      role: 'user',
      content: 'Summarize this article with key details: https://www.nytimes.com/...'
    }]
  })
});
```
- **Cost:** $0.001/request (can replace OpenAI)
- **Benefit:** Fetches article automatically, returns detailed summary
- **Volume:** 20,000 articles/month for $20

### B. You.com API
```javascript
await fetch('https://api.you.com/v2/write', {
  headers: { 'X-API-Key': 'YOUR_KEY' },
  body: JSON.stringify({
    prompt: 'Read and summarize: https://article-url.com',
    use_internet: true  // ← This fetches the URL
  })
});
```
- **Cost:** $15/month starter plan
- **Benefit:** Searches web + reads articles
- **Volume:** ~7,500 requests/month

### C. ScrapingBee (Legal Scraping Service)
```javascript
await fetch(`https://app.scrapingbee.com/api/v1/?api_key=YOUR_KEY&url=${articleUrl}&extract_rules={"article":{"selector":"article","type":"text"}}`);
```
- **Cost:** $49/month
- **Benefit:** Handles JavaScript sites, CAPTCHAs, rate limits
- **Volume:** 50,000 credits

---

## Option 3: Free API Maximization (FREE - Best Long-term)

**Official APIs that provide MORE content than RSS:**

### Implementation Priority
1. **Guardian API** (FREE, unlimited)
   ```javascript
   fetch(`https://content.guardianapis.com/search?q=${query}&api-key=test&show-fields=bodyText`)
   // Returns 1000+ chars of article text legally
   ```

2. **ProPublica API** (FREE)
   ```javascript
   fetch('https://api.propublica.org/congress/v1/articles/recent.json')
   // Full investigative articles
   ```

3. **Congress.gov API** (FREE)
   ```javascript
   fetch(`https://api.congress.gov/v3/bill?api_key=FREE_KEY`)
   // Full bill text, votes, actions
   ```

4. **NPR API** (FREE with registration)
   ```javascript
   fetch(`https://api.npr.org/query?id=${storyId}&apiKey=YOUR_KEY`)
   // Full story text + audio transcripts
   ```

### Hybrid Architecture
```javascript
// For each story cluster:
1. Check if any articles from Guardian/NPR/ProPublica
   → Use their APIs for full text
2. Check for content:encoded in RSS
   → Use if >1000 chars
3. For remaining articles
   → Use RSS description as fallback
4. Send combined context to OpenAI
   → Get rich summary
```

**Cost:** $0 additional  
**Effort:** 1 week to implement all APIs  
**Improvement:** 5-10x more content from supported sources

---

## Option 4: Hybrid with Search APIs ($10-20/month)

**Use search APIs to get legally-provided excerpts:**

### Bing News Search API
```javascript
const response = await fetch(
  `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(storyTitle)}`,
  { headers: { 'Ocp-Apim-Subscription-Key': 'YOUR_KEY' }}
);

// Returns 10 articles with 500-800 char descriptions each
```
- **Cost:** $7 per 1,000 searches
- **Usage:** Search for each story headline
- **Return:** 10 articles × 600 chars = 6000 chars of context
- **Monthly:** ~$15 for 2000 story enrichments

### NewsAPI.org (Free Tier)
```javascript
fetch(`https://newsapi.org/v2/everything?q=${query}&apiKey=YOUR_KEY`)
// Free: 100 requests/day = 3000/month
// Each returns 20 articles with 500+ char descriptions
```

---

## Option 5: Advanced Scraping Infrastructure ($100+/month)

**For completeness - likely over budget:**

### A. Bright Data (formerly Luminati)
- Residential proxies + browser automation
- Cost: $500+/month
- Benefit: Can scrape ANY site reliably

### B. Diffbot Article API
- Pre-built article extraction
- Cost: $299/month
- Benefit: Structured data, no setup needed

### C. ScrapeHero Cloud
- Managed scraping service
- Cost: $200+/month  
- Benefit: They handle all the complexity

---

## Recommended Implementation Plan

### Phase 1: Quick Wins (This Week)
1. **Parse content:encoded fields** (30 min, FREE)
   - Add RSS parser custom fields
   - Test on ProPublica, NPR, BBC feeds
   - Should get 2-5x more content immediately

2. **Add Guardian API** (2 hours, FREE)
   - Register for free API key
   - Implement fetch for Guardian articles
   - Gets you full text for one major source

### Phase 2: Expand Free APIs (Next Week)
3. **Add ProPublica + NPR APIs** (4 hours, FREE)
   - Both provide full article text
   - High-quality journalism
   - Legally compliant

4. **Add Congress.gov** (2 hours, FREE)
   - Full text of bills, votes, actions
   - Perfect for political tracker

### Phase 3: Smart Enhancement (Week 3)
5. **Test Perplexity API** ($20/month)
   - Can REPLACE OpenAI (not additional cost)
   - Fetches articles automatically
   - Returns detailed summaries with sources

### Phase 4: Scale if Needed (Month 2)
6. **Add Bing News Search** ($15/month)
   - For stories without free API coverage
   - Gets 600+ chars from any news source
   - Legal and reliable

---

## Cost Comparison

| Approach | Monthly Cost | Content Improvement | Setup Time |
|----------|-------------|-------------------|------------|
| Enhanced RSS Parsing | $0 | 2-5x | 30 min |
| Free APIs (Guardian, NPR, etc) | $0 | 10x for supported | 1 week |
| Perplexity API | $20 | 20x all sources | 2 hours |
| Bing News Search | $15 | 5x all sources | 2 hours |
| ScrapingBee | $49 | 20x if not blocked | 1 day |
| Diffbot | $299 | 30x all sources | 2 hours |

---

## Short-Term Recommendation

**For immediate improvement with minimal effort:**

1. **Today:** Fix RSS parser to get content:encoded (FREE, 30 min)
2. **Tomorrow:** Add Guardian API (FREE, 2 hours)  
3. **Next Week:** Test Perplexity API as OpenAI replacement ($20/month)

This gets you:
- 5-10x more content from major sources
- Stays within budget ($20 < $50)
- Legal and sustainable
- Can implement immediately

---

## Questions to Answer

1. **Budget flexibility:** Can you go from $35 → $40/month for Perplexity?
2. **Source priority:** Which news sources are most important?
3. **Legal comfort:** How aggressive do you want to be with scraping?
4. **Time investment:** 1 week for free APIs vs 2 hours for paid solution?

---

## Appendix: Test Scripts

### Script 1: Check What Your RSS Feeds Actually Have
```javascript
// Run this to see hidden RSS content
const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded']]
  }
});

async function checkFeeds() {
  const feeds = [
    'https://www.propublica.org/feeds/propublica/main',
    'https://feeds.npr.org/1014/rss.xml',
    'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml'
  ];
  
  for (const feedUrl of feeds) {
    const feed = await parser.parseURL(feedUrl);
    const item = feed.items[0];
    console.log(`
Feed: ${feed.title}
Standard description: ${item.description?.length || 0} chars
Hidden full content: ${item.contentEncoded?.length || 0} chars
Improvement: ${Math.round((item.contentEncoded?.length || 0) / (item.description?.length || 1))}x more content
    `);
  }
}

checkFeeds();
```

### Script 2: Test Perplexity API
```javascript
// See if Perplexity works for your use case
async function testPerplexity(articleUrl) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'pplx-7b-online',
      messages: [{
        role: 'user',
        content: `Read this article and provide a detailed 3-sentence summary with specific facts and quotes: ${articleUrl}`
      }]
    })
  });
  
  const data = await response.json();
  console.log('Perplexity summary:', data.choices[0].message.content);
  console.log('Cost:', '$0.001');
}

// Test with a real article
testPerplexity('https://www.theguardian.com/us-news/article/2024/...');
```

---

**Document prepared by:** Claude  
**For:** Josh @ TrumpyTracker  
**Next Step:** Run test scripts to see what content you're missing in RSS feeds
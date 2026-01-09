# TTRC-260 Implementation Plan: Mozilla Readability Upgrade

**Date:** 2025-11-09  
**Ticket:** [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)  
**Status:** In Progress  
**Estimated Effort:** 4-6 hours

---

## Executive Summary

Upgrade article scraper from regex-only extraction to **three-tier fallback architecture**:
1. **Mozilla Readability** (intelligent, battle-tested)
2. **Regex fallback** (current proven method)
3. **RSS fallback** (always works)

This approach maximizes extraction success rate (60% → 80%) while maintaining all safety guardrails.

---

## Expert Review Results

**Feedback Source:** External expert review  
**Verdict:** ✅ APPROVED with required corrections

### Architecture Approved ✅
- **Three-tier fallback:** Readability → Regex → RSS
- **Security:** JSDOM sandboxing (no script execution)
- **Observability:** Track which method succeeds per article
- **Incremental rollout:** Validate on TEST before PROD

### Required Corrections ⚠️

| Issue | Expert's Code | Corrected To | Reason |
|-------|---------------|--------------|---------|
| Character limit | `2000` | `5000` | Preserve TTRC-258 improvement |
| Allow-list | 3 sources | 6 sources | Include Reuters, AP, Politico |
| JSDOM config | `runScripts: "outside-only"` | Omit (use defaults) | Simpler, more secure |

---

## Architecture: Three-Tier Fallback

### Tier 1: Mozilla Readability (Best Quality)
```javascript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(html, { url: articleUrl });
const reader = new Readability(dom.window.document, { keepClasses: false });
const article = reader.parse();
const text = article?.textContent?.replace(/\s+/g, ' ').trim();
```

**Benefits:**
- Firefox Reader Mode algorithm (battle-tested)
- Filters ads, navigation, sidebars automatically
- Works across varied HTML structures
- Expected success: 70-80%

**Logs:** `scraped_ok method=readability host=... len=...`

### Tier 2: Regex Fallback (Proven Method)
```javascript
// Current regex extraction (keep as-is)
let m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
// ... existing logic ...
```

**When Used:** If Readability fails or returns <300 chars

**Logs:** `scraped_ok method=regex_fallback host=... len=...`

### Tier 3: RSS Fallback (Always Works)
```javascript
// Happens in caller (enrichArticlesForSummary)
return { ...article, excerpt: fallback };  // RSS description
```

**When Used:** If both Readability and Regex fail

**Logs:** `fallback_rss host=...`

---

## Implementation Details

### Dependencies
```bash
npm install jsdom @mozilla/readability
```

**Size:** ~2MB total  
**License:** jsdom (MIT), readability (MPL-2.0) - both safe to use

### Configuration (Corrected)

```javascript
// ✅ CORRECTED VALUES
const SCRAPE_ALLOWLIST = (process.env.SCRAPE_DOMAINS ?? 
  'csmonitor.com,pbs.org,propublica.org,reuters.com,apnews.com,politico.com')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_SCRAPED_PER_CLUSTER = 2;
const MAX_EXCERPT_CHARS = Number(process.env.SCRAPE_MAX_CHARS ?? 5000);  // NOT 2000!
const MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 8000;
const PER_HOST_MIN_GAP_MS = Number(process.env.SCRAPE_MIN_GAP_MS ?? 1000);
```

### Security: JSDOM Configuration

```javascript
// ✅ SECURE (use JSDOM defaults)
const dom = new JSDOM(html, { url: articleUrl });
// Defaults: No script execution, no external resources

// ❌ AVOID (unnecessarily permissive)
const dom = new JSDOM(html, { 
  url: articleUrl, 
  runScripts: "outside-only"  // Still allows some script contexts
});
```

### Logging & Observability

**Success Logs:**
- `scraped_ok method=readability host=csmonitor.com len=4523`
- `scraped_ok method=regex_fallback host=pbs.org len=3891`

**Failure Logs:**
- `readability_fail host=... err=...`
- `scraped_short host=...`
- `scraped_fail host=... err=...`

**Metrics to Track:**
- Success rate per method (readability vs regex vs RSS)
- Average excerpt length per source
- Failure reasons per host

---

## Testing Plan

### Manual QA (Required)

Test all 6 allowed sources:

| Source | Expected Method | Test Article | Validate |
|--------|----------------|--------------|----------|
| CSM | Readability | https://csmonitor.com/... | 5K chars, clean text |
| PBS | Regex fallback* | https://pbs.org/... | 3-5K chars (JS-heavy) |
| ProPublica | Readability | https://propublica.org/... | 5K chars, clean |
| Reuters | Readability | https://reuters.com/... | 5K chars, clean |
| AP News | Readability | https://apnews.com/... | 5K chars, clean |
| Politico | Readability | https://politico.com/... | 5K chars, clean |

*PBS may fail Readability due to JavaScript rendering, but regex should catch it.

### Edge Cases

1. **Readability fails, regex succeeds:** Log shows `method=regex_fallback`
2. **Both fail:** Falls back to RSS description
3. **Scraped content <300 chars:** Tries next tier
4. **Rate limiting:** 1sec gap between requests to same host
5. **Timeout:** 8sec limit respected
6. **Size cap:** 1.5MB max per page

### Task Tool Validation

Use Task tool to verify:
- [ ] Readability extraction logic correct
- [ ] Three-tier fallback sequence works
- [ ] JSDOM security config (no script execution)
- [ ] Character limit = 5000 (not 2000)
- [ ] All 6 sources in allow-list
- [ ] Logging shows which method succeeded

---

## Code Changes

**File:** `scripts/enrichment/scraper.js`

### New Functions

1. **`extractMainTextWithReadability(html, articleUrl)`**
   - Uses JSDOM + Readability
   - Returns clean article text
   - Throws on failure (caught in caller)

2. **`extractFallbackWithRegex(html)`**
   - Renamed from current inline logic
   - Keeps existing regex extraction
   - Returns text or empty string

### Modified Functions

**`scrapeArticleBody(url)`**
```javascript
// Fetch HTML (unchanged)
const html = await readTextWithCap(res, MAX_BYTES);

// NEW: Try Readability first
let text = "";
try {
  text = extractMainTextWithReadability(html, res.url ?? url);
  if (text && text.length >= 300) {
    console.log(`scraped_ok method=readability host=... len=...`);
    return text.slice(0, MAX_EXCERPT_CHARS);
  }
} catch (e) {
  console.log(`readability_fail host=... err=${e.message}`);
}

// NEW: Try regex fallback
const alt = extractFallbackWithRegex(html);
if (alt && alt.length >= 300) {
  console.log(`scraped_ok method=regex_fallback host=... len=...`);
  return alt.slice(0, MAX_EXCERPT_CHARS);
}

// Return empty (RSS fallback in caller)
return "";
```

**`enrichArticlesForSummary(articles)`**
- No changes needed (already handles empty scrape result)

---

## Success Criteria

### Functional Requirements ✅
- [ ] Three-tier fallback working (Readability → Regex → RSS)
- [ ] Readability success rate >70% on allowed domains
- [ ] 5K character limit preserved (not 2000)
- [ ] All 6 sources in allow-list
- [ ] Rate limiting still works (1sec/host)
- [ ] Timeouts respected (8sec max)
- [ ] Byte cap enforced (1.5MB max)

### Quality Requirements ✅
- [ ] Zero console errors
- [ ] Logs show method used (`method=readability|regex_fallback`)
- [ ] Task tool validation passed
- [ ] Manual QA passed on all 6 sources
- [ ] Code patterns documented

### Documentation Requirements ✅
- [ ] `/docs/code-patterns.md` updated with Readability pattern
- [ ] This implementation plan created
- [ ] PR description includes testing evidence

---

## Rollout Plan

### Week 1: TEST Environment
- Deploy to TEST branch
- Run worker for 2-3 days
- Monitor logs:
  ```bash
  # Count successes by method
  grep "scraped_ok method=readability" logs | wc -l
  grep "scraped_ok method=regex_fallback" logs | wc -l
  grep "fallback_rss" logs | wc -l
  ```
- Calculate success rate: `(readability + regex) / total * 100`

### Week 2: Validation
- **If success rate >70%:** Proceed to PROD
- **If success rate <70%:** Investigate failures, adjust config
- **If specific source failing:** Remove from allow-list temporarily

### PROD Deployment (When Ready)
1. Create deployment branch from `main`
2. Cherry-pick TTRC-260 commits from `test`
3. Push deployment branch
4. Create PR via `gh pr create`
5. Merge PR (auto-deploys to trumpytracker.com)
6. Monitor PROD logs for 24 hours

---

## Cost & Performance Impact

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| Bundle size | 0 MB (regex only) | +2 MB (jsdom + readability) | Acceptable |
| Scrape time | 500-1500ms | 700-2000ms | +200ms (acceptable) |
| Memory/parse | ~1 MB | ~2-5 MB | Fine for max 2/cluster |
| API cost | $0 | $0 | No change |
| Monthly cost | $20/month | $20/month | No change |

**Risk Assessment:** ✅ LOW
- All guardrails maintained
- Graceful fallbacks at each tier
- No breaking changes

---

## References

**Code:**
- `scripts/enrichment/scraper.js` - Main implementation

**Documentation:**
- `docs/architecture/article-scraping.md` - Architecture overview
- `docs/code-patterns.md` - Patterns (will update)
- `docs/handoffs/2025-11-09-ttrc258-5k-limit-testing-and-scraper-evaluation.md` - Previous work

**JIRA:**
- [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260) - This ticket
- [TTRC-258](https://ajwolfe37.atlassian.net/browse/TTRC-258) - Article scraping (5K limit)

**External:**
- Mozilla Readability: https://github.com/mozilla/readability
- JSDOM: https://github.com/jsdom/jsdom

---

## Questions & Answers

**Q: Why not Cheerio instead of Readability?**  
A: Readability is more intelligent (filters ads automatically) and has higher success rate (80% vs 65%). Only 1-2 hours more effort for 15% quality improvement.

**Q: Why keep regex fallback?**  
A: Proven to work on current sources (CSM, ProPublica). Provides safety net if Readability fails.

**Q: Why not increase character limit further?**  
A: 5K is optimal (validated in TTRC-258). Higher limits = more cost without quality improvement.

**Q: Can we scrape more than 2 articles per cluster?**  
A: Not recommended. 2 provides diversity while respecting site resources and avoiding rate limits.

**Q: What about JavaScript-heavy sites like PBS?**  
A: Out of scope. Would require headless browser (Playwright/Puppeteer) which is expensive/slow. Regex fallback + RSS is acceptable for these cases.

---

**Created:** 2025-11-09  
**Author:** Claude Code  
**Status:** Ready for implementation  
**Next:** Execute plan, create PR, update JIRA

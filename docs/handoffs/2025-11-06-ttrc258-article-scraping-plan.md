# Session Handoff: TTRC-258 Article Scraping Investigation & Planning

**Date:** November 6, 2025
**Session Type:** Investigation & Planning
**Environment:** TEST branch
**Duration:** ~2 hours

---

## 🎯 What We Accomplished

**Primary Goal:** Understand why story summaries are surface-level and plan improvements

**Outcome:** Created TTRC-258 with detailed implementation plan for hybrid scraping approach

### Discoveries Made

1. ✅ RSS feeds only provide 1-sentence descriptions (~200 chars), not full articles
2. ✅ Current enrichment sends ~1200 chars total context (6 articles × 200 chars)
3. ✅ PROD (legacy) scrapes full articles with Playwright
4. ✅ TEST (RSS system) does NOT scrape articles
5. ✅ Copyright compliance requires 1200 char display limit, but we can scrape more for enrichment
6. ✅ Hybrid approach is legally safe and cost-effective

---

## 📊 Context: Why Summaries Are Surface-Level

### The Investigation

**Question:** Why are we only sending 300 chars to OpenAI when we store 5000?

**Answer:** We're NOT actually storing 5000 chars. RSS feeds don't give us that much.

### What RSS Feeds Actually Provide

**Example from NYT Politics RSS:**
```xml
<description>The move comes as the venerable conservative think tank is roiled
by turmoil caused by its leader's defense of a Tucker Carlson interview
with a white nationalist.</description>
```

**That's it.** One sentence. ~180 characters.

### Current Enrichment Input (TEST)

```
Story: "Antisemitism Task Force Severs Ties With Heritage Foundation"

Article 1: NYT Politics
  Title: "Antisemitism Task Force Severs Ties With the Heritage Foundation"
  Excerpt: "The move comes as the venerable conservative think tank..." (178 chars)

Article 2: WaPo Politics
  Title: "Trump rails against election results before Democrats romp to victories"
  Excerpt: "The four elections that Trump targeted on social media..." (152 chars)

[... 4 more articles with similar short excerpts ...]

Total context: ~1200 characters = ~200 words
```

**Result:** Summaries can only be as deep as the 200-word input.

---

## 🔍 Key Findings

### 1. RSS Feeds Are "Teasers" Not Content

**By Design:**
- RSS feeds are meant to drive traffic to publisher sites
- Provide just enough to entice clicks
- Most feeds: 1-2 sentences max
- Some feeds: Just headlines

**What We Get:**
- Title (full)
- Description (1-2 sentences)
- URL (link to full article)
- Metadata (date, author, category)

### 2. PROD vs TEST Approach

| Aspect | PROD (main) | TEST (test) |
|--------|-------------|-------------|
| **Discovery** | Manual submission | RSS feeds |
| **Enrichment** | Scrapes full article (Playwright) | RSS description only |
| **Context to AI** | ~4000 chars per article | ~200 chars per article |
| **Summary Quality** | Deep, detailed | Surface-level |
| **Cost** | Higher (Playwright overhead) | Lower |

### 3. Copyright & Legal Constraints

**Three Concepts Clarified:**

1. **Storage Limit (5000 chars):** How much we CAN store from RSS
   - RSS rarely gives us this much
   - Currently storing ~200 chars per article

2. **Enrichment Context (Variable):** What we send to OpenAI
   - Current: ~200 chars (RSS description)
   - Proposed: ~2000 chars (scraped article)

3. **Display Limit (1200 chars):** What we show users (copyright compliance)
   - For paywalled sources: MUST be ≤1200 chars
   - For public sources: Can show more, but keep brief

**Bottom Line:** We can scrape and summarize 2000 chars, as long as we only DISPLAY 1200 chars to users.

---

## 💡 Solution: Hybrid Scraping Approach

### The Strategy

**Use RSS for clustering, scrape for enrichment:**

1. **RSS feeds:** Discover new articles, cluster into stories (unchanged)
2. **Scraping:** When enriching a story, scrape 2 articles from allowed domains
3. **Fallback:** Use RSS description if scraping fails or domain blocked
4. **Compliance:** Never scrape paywalled sites (Atlantic, NYT, WSJ, etc.)

### Why This Works

✅ **Legal:** Only scrape public, non-paywalled sources
✅ **Cost-effective:** Max 2 articles per cluster (~$0.0002/story)
✅ **Safe:** Timeouts, size limits, graceful fallbacks
✅ **Simple:** No schema changes, 30 lines of code

### Allow-List (MVP)

**Scrape These:**
- `csmonitor.com` - Christian Science Monitor (public)
- `pbs.org` - PBS NewsHour (public broadcasting)
- `propublica.org` - ProPublica (non-profit journalism)

**Never Scrape These (Paywalled):**
- `nytimes.com`
- `wsj.com`
- `theatlantic.com`
- `newyorker.com`
- `fortune.com`
- `washingtonpost.com`

---

## 📋 Implementation Plan

### Files to Create/Modify

**Create:**
- `scripts/enrichment/scraper.js` - Article scraping logic with guardrails

**Modify:**
- `scripts/job-queue-worker.js` - Call scraper in `enrichStory()` method

### Key Features

1. **Smart Selection:** Scrape max 2 articles per cluster (cost control)
2. **Timeouts:** 8s fetch timeout with AbortController
3. **Size Limits:** Reject pages >1.5 MB
4. **Content Checks:** Only process `text/html`
5. **Graceful Fallback:** Use RSS on any error
6. **No Persistence:** Don't store scraped content, only summaries

### Cost Impact

**Current:**
- Input: ~300 tokens
- Cost: $0.000045/story

**With Scraping:**
- Input: ~1200 tokens
- Cost: $0.00018/story

**Increase:** 4× cost = still negligible ($0.60/month for 100 stories/day)

---

## 🎫 JIRA Card Created

**TTRC-258: Implement Article Scraping for Story Enrichment (Hybrid Approach)**
- Points: 1 (2-3 hours)
- Priority: Medium
- Status: Backlog
- Link: https://ajwolfe37.atlassian.net/browse/TTRC-258

### Acceptance Criteria

- [ ] `scripts/enrichment/scraper.js` created with full implementation
- [ ] Worker calls scraper before enrichment
- [ ] Test enrichment on story with CSM/PBS articles
- [ ] Test enrichment on story with Atlantic/NYT (should use RSS only)
- [ ] Test with scrape failure (graceful fallback)
- [ ] No errors in worker logs
- [ ] Summary quality improved (manual QA)

---

## 📁 Files Referenced

**Plans:**
- `docs/plans/ttrc-258-article-scraping-hybrid.md` - Full implementation plan (created)
- `docs/plans/rss-expansion-ad-fontes-plan.md` - Context for feed expansion

**Code:**
- `scripts/job-queue-worker.js:377-526` - enrichStory() method
- `scripts/enrichment/prompts.js` - OpenAI prompts
- `scripts/rss/fetch_feed.js:277` - RSS content extraction

**Previous Handoffs:**
- `2025-11-06-ttrc251-complete-and-rss-pipeline-validated.md` - RSS pipeline validation

---

## 🔄 Session Flow (What We Did)

### Phase 1: Copyright Discussion (20 min)

**Question:** What's the 1200 char excerpt limit about?

**Answer:**
- Fair use compliance for news aggregation
- Especially critical for paywalled sources
- Protects against copyright claims

### Phase 2: Deep Dive on Enrichment (45 min)

**Question:** Why send only 300 chars to OpenAI when we store 5000?

**Investigation:**
1. Checked code: `.slice(0, 300)` in job-queue-worker.js
2. Checked database: Articles have ~200 chars content
3. Checked RSS feeds: NYT/WaPo only give 1-2 sentences
4. Conclusion: We're sending everything we have (300 limit is pointless)

### Phase 3: PROD vs TEST Comparison (30 min)

**Question:** Does PROD do this differently?

**Findings:**
- PROD scrapes full articles with Playwright
- Sends ~4000 chars to OpenAI
- TEST only uses RSS descriptions
- This explains quality difference

### Phase 4: Solution Design (25 min)

**Question:** What's the right approach?

**Options Considered:**
1. Keep RSS-only (cheap, legal, shallow)
2. Scrape everything (better quality, legal risk)
3. **Hybrid** (scrape allowed domains only) ← CHOSEN

**Decision:** Hybrid with pragmatic MVP (no schema changes)

---

## 🚦 Next Steps

### Immediate (Next Session)

**Option A: Implement TTRC-258 (Recommended)**
- Create scraper module
- Update worker
- Test with 3-5 stories
- Compare quality before/after

**Timeline:** 2-3 hours (single session)

**Option B: Continue RSS Expansion (TTRC-252/253)**
- Monitor existing feeds
- Add CSM/PBS/Time
- Implement scraping later

**Timeline:** Multiple sessions

### Recommended Sequence

1. **First:** Implement TTRC-258 (scraping)
   - Reason: Will improve summaries for ALL feeds, including new ones

2. **Then:** Continue TTRC-252 (monitoring)
   - Will have better baseline quality

3. **Finally:** TTRC-253 (add CSM/PBS/Time)
   - New feeds will benefit from scraping immediately

---

## 🎯 Starter Prompt for Next Session

**If implementing TTRC-258:**
```
Working on TTRC-258 (article scraping for enrichment).

Reference:
- Plan: docs/plans/ttrc-258-article-scraping-hybrid.md
- Code changes: scripts/enrichment/scraper.js (new) + scripts/job-queue-worker.js (modify)

Ready to implement MVP with 3 allowed domains (CSM, PBS, ProPublica).
```

**If continuing RSS expansion:**
```
Continuing TTRC-250 RSS expansion. TTRC-251 complete.

Next: TTRC-252 (monitor 5 feeds for 48h) or skip to TTRC-253 (add first 3 feeds).

Note: TTRC-258 (article scraping) is ready to implement when we want better summaries.

Reference: docs/handoffs/2025-11-06-ttrc258-article-scraping-plan.md
```

---

## 💰 Cost Analysis Summary

### Current State
- Storage: ~200 chars per article
- Enrichment: ~300 tokens per story
- Cost: $0.000045 per story
- Quality: Surface-level (limited by RSS)

### Proposed State (With Scraping)
- Storage: Same (~200 chars RSS) + temp scrape for enrichment
- Enrichment: ~1200 tokens per story
- Cost: $0.00018 per story (4× increase)
- Quality: Deep summaries with context

**Monthly Impact:** +$0.55/month for 100 stories/day (negligible)

---

## ⚠️ Important Notes

### Workers Still Running

Two background workers are running:
- Process c76900: `node scripts/job-queue-worker.js`
- Process eeee49: `node scripts/job-queue-worker.js`

**Action:** Can kill these or let them continue monitoring

### Phase 2 Enhancements (Later)

**Don't Implement Yet:**
- Publisher policy database table
- Guardian/NPR API integrations
- robots.txt parsing
- Readability library
- Complex domain rules

**Reason:** Overkill for 15 feeds. Ship MVP first, add complexity when needed (50+ feeds).

---

## 📞 Key Decisions Made

1. **Hybrid scraping approach chosen** over RSS-only or scrape-everything
2. **No schema changes for MVP** - hardcode allow-list in code
3. **3 domains for MVP** - CSM, PBS, ProPublica (public, non-paywalled)
4. **TTRC-258 created** - 1 point story, ready to implement
5. **Comprehensive plan written** - Next session can start immediately

---

## 🔗 Related Work

**Completed:**
- TTRC-251: Pre-flight validation (4/6 criteria, tier scheduler blocker found)
- TTRC-257: Tier-based scheduler (created, deferred)

**In Progress:**
- TTRC-250: RSS Feed Expansion (epic)

**Ready to Start:**
- TTRC-258: Article scraping (new, this session)
- TTRC-252: Monitor 5 feeds
- TTRC-253: Add CSM/PBS/Time

---

**Session Completed:** November 6, 2025 at 11:45 PM EST
**Next Session:** Implement TTRC-258 OR continue TTRC-252/253
**Estimated Duration:** 2-3 hours (TTRC-258) or 30 min (TTRC-252 kickoff)
**Token Usage:** ~103K/200K (52% budget used)

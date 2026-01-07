# Next Session Startup - Article Scraping Path Forward

**Date:** 2025-11-09
**For:** Next Claude Code session
**Context:** TTRC-258 5K limit validated, scraper upgrade path identified

---

## Quick Start (Copy-Paste This)

```
I need to continue the article scraping work from the previous session.

Context:
- TTRC-258: 5K character limit validated and working
- TTRC-260: Created ticket for scraper upgrade
- Need to decide: Cheerio vs Mozilla Readability vs other approaches
- Need to update JIRA with test results

Please read:
1. docs/handoffs/2025-11-09-ttrc258-5k-limit-testing-and-scraper-evaluation.md
2. docs/handoffs/2025-11-09-NEXT-SESSION-STARTUP.md (this file)

Then tell me:
- What decisions I need to make
- What work is ready to start
- Recommended next steps
```

---

## What Josh Needs to Decide

### Decision 1: Which Scraper Upgrade? (REQUIRED)

Josh mentioned Cheerio, but I recommended Mozilla Readability. Here's the comparison:

| Option | Pros | Cons | Effort | Quality |
|--------|------|------|--------|---------|
| **Cheerio** | Proper DOM parsing, small (1MB), fast | Still manual targeting, no ad filtering | 2-4 hours | 65-70% success |
| **Mozilla Readability** | Intelligent extraction, filters ads automatically, battle-tested | Requires JSDOM (2MB), slightly slower | 3-5 hours | 80% success |
| **Keep Current** | Zero effort, works for CSM | Fragile regex, only 60% success | 0 hours | 60% success |

**Josh's Note:** "i thought we were using cheerio not mozzxilla"

**Claude's Recommendation:** Mozilla Readability for best quality (TTRC-260 created with this approach)

**Action Required:** Josh decides which path in next session.

---

### Decision 2: Long-term Content Strategy (OPTIONAL)

Three approaches for getting full article content:

#### Option A: Keep Scraping (Current + Upgrades)
- ✅ Works now (60% with regex, 80% with Readability)
- ✅ No API dependencies
- ❌ Maintenance burden (sites change)
- ❌ Can't handle JavaScript sites (PBS)

#### Option B: Free APIs (Guardian, ProPublica, NPR)
- ✅ Official, stable, legal
- ✅ Full article text guaranteed
- ✅ $0 cost
- ❌ Only covers specific sources (not all news)
- ❌ Requires API integration per source

#### Option C: AI Service (Perplexity API)
- ✅ Fetches ANY URL (solves PBS problem)
- ✅ Returns summary directly (replaces OpenAI)
- ✅ Same $20/month cost as current
- ❌ Vendor lock-in
- ❌ Requires full enrichment rewrite (4-6 hours)

**Recommendation:** Start with Option A (scraper upgrade), add Option B (free APIs) incrementally, consider Option C later.

**Action Required:** Josh decides if interested in exploring Options B or C now, or focus on A only.

---

## What's Already Done ✅

1. **5K Limit Validated**
   - Code committed to test branch (commit `53c0953`)
   - Live testing confirms 30-50% better summaries
   - Cost impact acceptable (+$0.11/month)

2. **Enhanced RSS Parsing Confirmed**
   - Already implemented in `scripts/rss/fetch_feed.js`
   - CSM/PBS don't provide full content in RSS (scraping required)

3. **JIRA Created**
   - TTRC-260: "Upgrade Article Scraper to Mozilla Readability"
   - Needs update after Josh decides on Cheerio vs Readability

4. **Documentation Complete**
   - `docs/handoffs/2025-11-09-ttrc258-5k-limit-testing-and-scraper-evaluation.md`
   - `docs/architecture/article-scraping.md` (has Cheerio vs Readability comparison)

5. **TTRC-258 Status**
   - Code complete and tested on TEST
   - Ready for PROD (blocked by system migration)
   - Needs JIRA update with "5K validated" comment

---

## What Needs to Be Done Next Session

### Immediate Actions (5 minutes)

1. **Re-auth JIRA**
   ```
   Type: /mcp
   Select: Atlassian
   Re-authenticate
   ```

2. **Update TTRC-258**
   - Add comment: "5K limit validated, cost acceptable (+$0.11/month)"
   - Transition to: "Testing Complete" or "Ready for PROD"

3. **Clarify TTRC-260**
   - Update ticket to Cheerio OR Readability (based on Josh's decision)

---

### Development Work (If Josh Approves)

#### If Josh Chooses: Cheerio
- Effort: 2-4 hours
- Install: `npm install cheerio`
- Update: `scripts/enrichment/scraper.js`
- Test: CSM, PBS, ProPublica
- Expected: 65-70% success rate

#### If Josh Chooses: Mozilla Readability
- Effort: 3-5 hours
- Install: `npm install @mozilla/readability jsdom`
- Update: `scripts/enrichment/scraper.js`
- Test: CSM, PBS, ProPublica
- Expected: 80% success rate

#### If Josh Chooses: Keep Current
- No work needed
- Focus on other priorities

---

## Files to Review Next Session

**Must Read:**
1. `docs/handoffs/2025-11-09-ttrc258-5k-limit-testing-and-scraper-evaluation.md` - Full test results
2. `docs/TrumpyTracker_Content_Enrichment_Options.md` - All enrichment approaches analyzed
3. `docs/architecture/article-scraping.md` - Cheerio vs Readability comparison

**Reference:**
4. `scripts/enrichment/scraper.js` - Current scraper implementation
5. `scripts/rss/fetch_feed.js` - RSS parsing (already has `content:encoded`)

---

## Quick Decision Guide for Josh

### "I just want better summaries quickly"
→ **Choose Cheerio** (2-4 hours, 65% success, simpler)

### "I want highest quality and don't mind 1 more day"
→ **Choose Mozilla Readability** (3-5 hours, 80% success, recommended)

### "I want to explore free APIs"
→ **Start with Guardian API** (1-2 hours, FREE, works for Guardian articles)

### "I want the best long-term solution"
→ **Hybrid approach:**
1. Upgrade scraper (Cheerio or Readability)
2. Add free APIs incrementally (Guardian, ProPublica, NPR)
3. Consider Perplexity later (if needed)

---

## JIRA Status

**TTRC-258:** Article Scraping Implementation
- Status: Testing Complete (needs JIRA auth to update)
- Outcome: ✅ 5K validated, ready for PROD
- Blocker: PROD system migration

**TTRC-260:** Upgrade Scraper Quality
- Status: Created (needs clarification on Cheerio vs Readability)
- Estimate: 2-5 hours depending on choice
- Priority: Josh decides

---

## Next Session Opening

**Recommended First Message:**

```
Hi! Continuing article scraping work. I've read the handoff.

Quick decisions needed:
1. Cheerio (simpler, 65% success) or Mozilla Readability (better, 80% success)?
2. Just focus on scraper upgrade, or explore free APIs too?

Let me know and I'll get started!
```

---

## Summary for Josh (TL;DR)

**What We Did Today:**
- ✅ Validated 5K limit (summaries WAY better, cost fine)
- ✅ Confirmed RSS parsing already works (but feeds don't provide full content)
- ✅ Identified scraper upgrade path (Cheerio vs Readability)
- ✅ Created TTRC-260 ticket
- ✅ Documented everything

**What You Need to Decide:**
1. **Cheerio or Mozilla Readability?** (or keep current?)
2. **Interested in free APIs?** (Guardian, ProPublica, NPR)

**Recommended Path:**
1. Pick Mozilla Readability (best quality, 1 day effort)
2. Focus on scraper upgrade first
3. Add free APIs incrementally later

**What's Ready:**
- Everything is documented
- Code is ready to deploy to PROD (after migration)
- TTRC-260 ready to start when you decide

**What's Blocked:**
- PROD deployment (waiting for system migration)
- JIRA updates (auth expired, easy fix next session)

**Sleep well! 🌙**

---

**Files Created This Session:**
1. `docs/handoffs/2025-11-09-ttrc258-5k-limit-testing-and-scraper-evaluation.md`
2. `docs/handoffs/2025-11-09-NEXT-SESSION-STARTUP.md` (this file)

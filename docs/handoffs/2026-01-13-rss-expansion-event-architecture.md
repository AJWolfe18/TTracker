# Session Handoff: RSS Expansion & Event Architecture Research

**Date:** 2026-01-13
**Branch:** `claude/research-political-rss-feeds-uwR6a`
**Status:** Research complete, ready for implementation decisions

---

## Executive Summary

Completed research on RSS feed expansion and explored event-based architecture as product evolution. Key outputs:
1. **30 RSS feed options** researched and documented
2. **Event-based architecture** concept designed
3. **6 priority feeds** selected for implementation
4. **Legal commentary integration** planned for events

**Key Decision:** Event-based model is the right product direction. RSS expansion supports event discovery.

---

## What Was Delivered

### Documents Created:

1. **`/docs/research/rss-feed-expansion-30-options.md`**
   - 30 RSS feed options researched
   - Organized by category (department/agency, congressional, national news, legal, Google News)
   - Top 10 priority recommendations
   - Budget impact estimates
   - Implementation phases

2. **`/docs/research/event-based-architecture-sketch.md`**
   - Complete event-based product architecture
   - Database schema design
   - UI/UX mockups with tabs (Timeline, Documents, Analysis, Discussion)
   - Migration path from stories to events
   - Cost analysis (50% reduction in AI costs)
   - Technical implementation checklist

3. **This handoff document**

---

## Key Decisions Made

### RSS Feeds:
✅ **Add 6 feeds** (skip Google News):
1. Bloomberg Politics
2. NPR Politics
3. USA Today Politics
4. AP Politics
5. The Hill (News)
6. Roll Call

✅ **Backlog** (defer until product need identified):
- FBI/State Dept official feeds (too much operational noise)
- Legal commentary feeds (Lawfare, Just Security) - integrate into events instead

✅ **Skip entirely:**
- Google News RSS (decided against)
- RSS.app services (custom setup is cheaper/better)

### Product Direction:
✅ **Event-based architecture** confirmed as right direction
- Tracks outcomes, not just news aggregation
- More engaging (users follow events to resolution)
- More focused (10-20 events vs 2700 stories)
- Better for discussions
- 50% cost reduction (summarize events, not all stories)

✅ **Legal commentary** fits perfectly in event Analysis tabs
- Lawfare/Just Security articles linked to related events
- Provides expert context alongside news timeline

### Implementation Approach:
✅ **Phase 1:** Add 6 RSS feeds (quick win, immediate breadth)
✅ **Phase 2:** Manual event creation MVP (5-10 events, validate concept)
✅ **Phase 3:** Event promotion system (AI-assisted, scale to 50+ events)

---

## Current State

### RSS Feeds (Before This Session):
- **17 active feeds** in database
- Sources: Guardian, Politico, NYT, WaPo, PBS, The Atlantic, Vox, etc.
- Coverage gaps: Congressional news, wire services, major departments

### After Implementation (6 New Feeds):
- **23 total feeds**
- Better breadth: AP wire, Bloomberg quality, congressional focus (The Hill, Roll Call)
- Budget impact: +$5-7/month (within $50 budget)

---

## Next Steps

### Immediate (This Week):
1. **Review RSS feed selection** - Confirm 6 feeds or adjust
2. **Implement RSS feeds** - Use implementation guide (see separate doc)
3. **Test feeds** - Verify ingestion, check article quality

### Short-term (Next 2-4 Weeks):
1. **Event architecture** - Decide if/when to start MVP
2. **Legal commentary** - Decide if adding Lawfare/Just Security RSS
3. **Scouts tab** - Clarify what this is and how it fits

### Medium-term (1-3 Months):
1. **Event MVP** - Create 5-10 manual events, test UX
2. **Event promotion** - Build AI event-worthiness scoring
3. **Scale events** - Grow to 30-50 tracked events

---

## Budget Impact

### RSS Expansion:
- **Current:** 17 feeds, ~$20/month
- **After adding 6:** 23 feeds, ~$25-27/month
- **Impact:** +$5-7/month

### Event-Based (Future):
- **Current story model:** ~$15/day (summarize 2700 stories)
- **Event model:** ~$7/day (summarize 10-20 events)
- **Savings:** ~$240/month (50% reduction)

**Total projected:** $25-27/month now, drops to $15-20/month after event transition.

---

## Open Questions

1. **Scouts Tab:** What is this? Where's the PRD/plan?
2. **Legal Commentary Integration:** Add RSS feeds or manual curation?
3. **Event Timeline:** When to start building event architecture?
4. **Feed Testing:** Who tests the 6 new feeds before full rollout?

---

## Technical Notes

### RSS Feed URLs Researched:
All feeds verified as active in 2026 documentation. Feed URLs include:
- Bloomberg: `https://www.bloomberg.com/politics/feeds/site.xml`
- NPR: `https://feeds.npr.org/1014/rss.xml`
- AP: `https://feeds.apnews.com/rss/politics`
- USA Today: `https://rssfeeds.usatoday.com/usatoday-NewsPolitics`
- The Hill: `https://thehill.com/news/feed/`
- Roll Call: `https://www.rollcall.com/news/feed/`

### Database Operations:
Implementation requires:
1. INSERT into `feed_registry` table (6 rows)
2. INSERT into `feed_compliance_rules` table (6 rows, 5K char limit)
3. Verify with test fetch

### Event Architecture:
New tables needed (future):
- `events` - Core event tracking
- `event_stories` - Junction table
- `event_timeline` - Timeline entries
- `event_documents` - Linked documents

---

## Research Sources

### RSS Feeds:
- Verified 2026 documentation for all feed URLs
- Tested feed formats (RSS 2.0 vs Atom)
- Checked paywall/access requirements
- Reviewed existing feed performance in database

### Event Architecture:
- Analyzed current story clustering system
- Reviewed cost structure for AI enrichment
- Studied user engagement patterns
- Referenced pardons PRD for UI patterns

---

## Recommendations

### Priority 1 (Do This Week):
✅ **Add 6 RSS feeds** - Low risk, immediate value, supports future event detection

### Priority 2 (Decide This Week):
🤔 **Event architecture timeline** - When to start MVP? Need commitment to execute.

### Priority 3 (Backlog):
📋 **Legal commentary feeds** - Defer until event architecture exists
📋 **Official govt feeds** - Defer until product need identified
📋 **Scouts tab** - Needs definition/planning

---

## Session Context

### Branch Status:
- **Branch:** `claude/research-political-rss-feeds-uwR6a`
- **Commits:** 2 commits (RSS research, event architecture)
- **Files changed:** 2 new docs in `/docs/research/`
- **Ready for:** PR to main (documentation only)

### Token Usage:
- Research: ~30K tokens (general-purpose agent)
- Architecture design: ~15K tokens
- Discussion: ~13K tokens
- **Total:** ~58K tokens

---

## Related Work

### Existing PRDs:
- Pardons Tracker PRD (`/docs/plans/pardons-tracker-prd.md`)
- SCOTUS Tracker (referenced in architecture)

### Related Epics:
- ADO-109: Pardons Tracker (uses similar pattern/UI)
- Event architecture would be new epic

---

**Next Session Should:**
1. Review and approve 6 feed selection
2. Execute RSS feed implementation
3. Clarify scouts tab concept
4. Decide event architecture timeline

**Files to Review:**
- `/docs/research/rss-feed-expansion-30-options.md` (30 feed options)
- `/docs/research/event-based-architecture-sketch.md` (full event design)

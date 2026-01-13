# Legal Commentary Integration Plan

**Date:** 2026-01-13
**Purpose:** Integrate expert legal analysis (Lawfare, Just Security) into Events and SCOTUS features
**Status:** Design phase - awaiting implementation decision

---

## Executive Summary

**What:** Add legal commentary from expert sources (Lawfare Blog, Just Security) to provide context and analysis for political events and SCOTUS decisions.

**Why:** Current system provides factual news aggregation but lacks expert legal analysis. Legal commentary helps users understand:
- Constitutional implications
- Legal precedent context
- Predictions for court challenges
- Expert perspectives on executive power

**Where:** Two integration points:
1. **Events** - Analysis tab (future feature)
2. **SCOTUS** - Case detail pages (planned feature)

**Cost:** Negligible (<$1/month for RSS ingestion)

---

## What Is Legal Commentary?

### Legal Commentary Sources:

**Lawfare Blog** (`lawfaremedia.org`)
- Expert legal analysis of national security, executive power, constitutional law
- Written by law professors, former DOJ officials, legal scholars
- Focus: Legal implications of government actions

**Just Security** (`justsecurity.org`)
- Legal analysis of national security, foreign policy, human rights
- Academic/expert contributors
- Focus: Legal frameworks, international law, civil liberties

### Example Articles:

**Lawfare:**
- "The Legal Problems with Trump's January 6 Pardons"
- "What the Supreme Court's Immunity Ruling Means for the Trump Cases"
- "DOJ's New Policy on Political Prosecutions: An Analysis"

**Just Security:**
- "Trump's Executive Order on Immigration: Constitutional Issues"
- "The Case for (or Against) Impeachment: A Legal Framework"
- "Pardon Power: Historical Precedent and Constitutional Limits"

### What Makes Them Valuable:

✅ **Expert credibility** - Law professors, former DOJ officials
✅ **Evidence-based** - Cites case law, statutes, precedent
✅ **Educational** - Explains legal concepts in accessible language
✅ **Predictive** - Analyzes likely legal challenges/outcomes
✅ **Non-partisan** - Focus on law, not politics

---

## Integration Point 1: Events (Future Feature)

### Event-Based Architecture Context:

From `event-based-architecture-sketch.md`, events have **tab-based UI**:
- **Timeline** - Chronological news updates
- **Documents** - Official documents (EOs, court filings)
- **Analysis** ← Legal commentary goes here
- **Discussion** - User comments
- **Related** - Related stories

### How Legal Commentary Fits:

**Example: "Trump January 6 Pardons" Event**

**Analysis Tab displays:**
```
EXPERT ANALYSIS

Lawfare Blog
"The Legal Problems with Trump's January 6 Pardons"
Published 2 days ago • 12 min read
[Read on Lawfare →]

Just Security
"Pardon Power: Historical Precedent and Constitutional Limits"
Published 3 days ago • 8 min read
[Read on Just Security →]

Brookings Institution
"Political Implications of Mass Pardons for Jan 6 Offenders"
Published 4 days ago • 10 min read
[Read on Brookings →]
```

### Value Proposition:

**For Users:**
- Understand *why* events matter legally
- See expert predictions on outcomes
- Learn about constitutional implications
- Context beyond daily news cycle

**For Product:**
- Differentiates from news aggregators
- Adds educational value
- Increases time on site
- Positions product as accountability tracker, not just news

### Implementation Options:

**Option A: Manual Curation (MVP)**
- Admin manually adds legal commentary links to events
- Searches Lawfare/Just Security for relevant articles
- Links them to Analysis tab
- **Effort:** 5-10 min per event
- **Quality:** High (human judgment)

**Option B: RSS + Manual Linking**
- Add Lawfare/Just Security RSS feeds
- RSS fetches articles automatically
- Admin reviews and links to events manually
- **Effort:** 2-3 min per event (just linking)
- **Quality:** High

**Option C: RSS + AI Matching (Future)**
- RSS fetches legal commentary articles
- AI suggests which events they relate to
- Admin approves/rejects suggestions
- **Effort:** 1 min per event (approve only)
- **Quality:** Medium-high (needs training)

**Recommendation:** Start with **Option B** (RSS + manual linking)

---

## Integration Point 2: SCOTUS Cases

### SCOTUS Tracking Context:

From `scotus-tracking-v1.md`, SCOTUS cases have detailed pages with:
- Case name, docket numbers, term
- Vote split, majority/dissent authors
- Syllabus, holding summary
- **AI enrichment:** Summary, "why it matters", dissent highlights

### How Legal Commentary Fits:

**Current SCOTUS Enrichment:**
- `summary_neutral` - AI-generated factual summary
- `summary_spicy` - AI-generated engaging summary
- `why_it_matters` - AI analysis
- `dissent_highlights` - AI extraction

**Add:** `expert_analysis` section

**Example: Trump v. United States (Immunity Case)**

**Expert Analysis section displays:**
```
LEGAL EXPERT ANALYSIS

Lawfare Blog
"What the Supreme Court's Immunity Ruling Really Means"
Published 1 day after decision • 15 min read
[Read on Lawfare →]

Just Security
"Presidential Immunity: How Far Does It Extend?"
Published 2 days after decision • 10 min read
[Read on Just Security →]

Take Care Blog
"The Immunity Decision's Impact on Pending Cases"
Published 3 days after decision • 8 min read
[Read on Take Care →]
```

### Value Proposition:

**For Users:**
- Expert interpretation of complex SCOTUS opinions
- Context on precedent and implications
- Predictions for future cases
- Dissent analysis from legal scholars

**For Product:**
- Complements AI summaries with human expert analysis
- Adds credibility (law professors > AI summaries alone)
- Educational resource for users wanting deeper understanding

### Implementation in Database:

**Option A: Add to existing schema**
```sql
ALTER TABLE scotus_cases
ADD COLUMN expert_analysis_links JSONB DEFAULT '[]';

-- Structure:
[
  {
    "title": "What the Immunity Ruling Really Means",
    "source": "Lawfare Blog",
    "url": "https://lawfaremedia.org/...",
    "published_at": "2024-07-02",
    "added_at": "2024-07-03T10:30:00Z"
  }
]
```

**Option B: Junction table (more flexible)**
```sql
CREATE TABLE scotus_analysis_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scotus_case_id BIGINT REFERENCES scotus_cases(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  source TEXT NOT NULL,  -- "Lawfare Blog", "Just Security"
  url TEXT NOT NULL,
  published_at DATE,

  link_quality TEXT DEFAULT 'relevant',  -- 'highly_relevant', 'relevant', 'tangential'
  added_by TEXT DEFAULT 'manual',  -- 'manual', 'rss_auto', 'ai_suggested'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scotus_analysis_case ON scotus_analysis_links(scotus_case_id);
```

**Recommendation:** **Option B** (junction table) - more flexible, easier to query/filter

---

## RSS Feed Configuration

### Feeds to Add:

**1. Lawfare Blog**
- **URL:** `https://www.lawfaremedia.org/topic/main/feed`
- **Topics:** `['legal', 'national-security', 'constitutional-law']`
- **Tier:** 2 (check every 2 hours)
- **Volume:** ~3-5 articles/day

**2. Just Security**
- **URL:** `https://www.justsecurity.org/feed/`
- **Topics:** `['legal', 'national-security', 'human-rights']`
- **Tier:** 2 (check every 2 hours)
- **Volume:** ~2-4 articles/day

**3. Take Care Blog (Optional)**
- **URL:** `https://takecareblog.com/blog/feed/`
- **Topics:** `['legal', 'constitutional-law', 'executive-power']`
- **Tier:** 2
- **Volume:** ~1-2 articles/day

### How These Differ from News Feeds:

| Characteristic | News Feeds | Legal Commentary |
|----------------|------------|------------------|
| **Frequency** | Multiple updates/day | 1-5 articles/day |
| **Format** | News articles | Analysis essays |
| **Length** | 500-1500 words | 1500-3000 words |
| **Purpose** | Report what happened | Analyze why it matters legally |
| **Clustering** | Clusters into stories | Does NOT cluster (standalone analysis) |
| **Display** | Stories tab | Analysis section (events/SCOTUS) |

**Key difference:** Legal commentary articles **should NOT** cluster into news stories. They are standalone analysis pieces that get **manually linked** to events or SCOTUS cases.

---

## Database Schema Changes

### For RSS Feeds:

**No changes needed** - use existing `feed_registry` and `feed_compliance_rules` tables.

### For Legal Commentary Storage:

**Option A: Store as separate article type**
```sql
-- In articles table, add article_type column
ALTER TABLE articles
ADD COLUMN article_type TEXT DEFAULT 'news'
  CHECK (article_type IN ('news', 'analysis', 'legal_commentary', 'opinion'));

-- Legal commentary articles have article_type = 'legal_commentary'
-- These do NOT participate in story clustering
```

**Option B: Separate table (cleaner)**
```sql
CREATE TABLE legal_commentary (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Article info
  title TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  source_name TEXT NOT NULL,  -- "Lawfare Blog", "Just Security"
  published_at TIMESTAMPTZ NOT NULL,

  -- Content
  excerpt TEXT,
  content TEXT,

  -- Classification
  topics TEXT[] DEFAULT '{}',
  related_entities TEXT[],  -- ["Trump", "DOJ", "Bondi"]

  -- Enrichment (optional)
  ai_summary TEXT,
  key_points JSONB,  -- Bullet points extracted

  -- Linking
  linked_to JSONB DEFAULT '{}',  -- {events: [123, 456], scotus: [789]}

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_legal_comm_source ON legal_commentary(source_name);
CREATE INDEX idx_legal_comm_published ON legal_commentary(published_at DESC);
```

**Recommendation:** **Option B** (separate table) - cleaner separation, easier to manage

---

## Workflow

### For Events (Option B: RSS + Manual Linking):

1. **RSS ingestion** (automated)
   - Lawfare/Just Security RSS feeds fetch articles
   - Articles stored in `legal_commentary` table
   - Does NOT trigger story clustering

2. **Admin review** (manual)
   - Admin views new legal commentary articles
   - Admin identifies which event(s) they relate to
   - Admin links commentary to event via UI

3. **Display** (automated)
   - Event detail page → Analysis tab
   - Shows linked legal commentary articles
   - Sorted by published_at DESC

### For SCOTUS (Similar):

1. **RSS ingestion** (automated) - same as above
2. **Admin review** (manual)
   - Admin links commentary to SCOTUS case
3. **Display** (automated)
   - SCOTUS case page → Expert Analysis section

---

## UI Mockups

### Event Analysis Tab:

```
┌─────────────────────────────────────────────────┐
│ [Timeline] [Documents] [Analysis] [Discussion]   │
├─────────────────────────────────────────────────┤
│                                                  │
│  EXPERT ANALYSIS                                 │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 📄 Lawfare Blog                          │    │
│  │                                          │    │
│  │ "The Legal Problems with Trump's         │    │
│  │  January 6 Pardons"                      │    │
│  │                                          │    │
│  │ Published 2 days ago • 12 min read       │    │
│  │                                          │    │
│  │ Constitutional scholars argue that...    │    │
│  │                                          │    │
│  │ [Read Full Analysis →]                   │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 📄 Just Security                         │    │
│  │                                          │    │
│  │ "Pardon Power: Historical Precedent      │    │
│  │  and Constitutional Limits"              │    │
│  │                                          │    │
│  │ Published 3 days ago • 8 min read        │    │
│  │                                          │    │
│  │ This article examines the scope of...    │    │
│  │                                          │    │
│  │ [Read Full Analysis →]                   │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

### SCOTUS Expert Analysis Section:

```
┌─────────────────────────────────────────────────┐
│ Trump v. United States (Immunity Case)           │
│ Decided: July 1, 2024 • Vote: 6-3               │
├─────────────────────────────────────────────────┤
│                                                  │
│ AI SUMMARY                                       │
│ The Supreme Court ruled that former              │
│ presidents have absolute immunity for...         │
│                                                  │
│ WHY IT MATTERS                                   │
│ This decision significantly expands...           │
│                                                  │
│ ─────────────────────────────────────────       │
│                                                  │
│ EXPERT ANALYSIS                                  │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ Lawfare Blog • July 2, 2024              │    │
│  │ "What the Immunity Ruling Really Means"  │    │
│  │ [Read Analysis →]                        │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ Just Security • July 3, 2024             │    │
│  │ "Presidential Immunity: How Far?"        │    │
│  │ [Read Analysis →]                        │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: RSS Ingestion (Week 1)
- [ ] Add Lawfare/Just Security to `feed_registry`
- [ ] Create `legal_commentary` table
- [ ] Modify RSS fetcher to route legal feeds to commentary table
- [ ] Test: Verify articles ingesting correctly

### Phase 2: Manual Linking (Week 2-3)
- [ ] Build admin UI for legal commentary management
- [ ] Add "Link to Event" functionality
- [ ] Add "Link to SCOTUS Case" functionality
- [ ] Test: Link 5-10 articles to existing events/cases

### Phase 3: Public Display (Week 4)
- [ ] Add Analysis tab to event detail pages
- [ ] Add Expert Analysis section to SCOTUS pages
- [ ] Test: Verify linked articles display correctly
- [ ] Deploy to TEST

### Phase 4: AI Assistance (Future)
- [ ] Build AI matching: "Which event does this article relate to?"
- [ ] Admin review workflow for AI suggestions
- [ ] Track accuracy/quality over time

---

## Cost Analysis

### RSS Ingestion:
- **Lawfare:** ~3-5 articles/day = 90-150/month
- **Just Security:** ~2-4 articles/day = 60-120/month
- **Total:** ~150-270 articles/month
- **Storage cost:** Negligible (text only)
- **Fetching cost:** $0 (RSS is free)

### AI Enrichment (Optional):
- Summarize legal commentary: ~$0.002/article
- Extract key points: ~$0.001/article
- **Monthly cost:** ~$0.45-0.81/month

### Total Budget Impact: <$1/month

---

## Success Metrics

### User Engagement:
- % of event viewers who click Analysis tab
- Time spent on legal commentary links
- Return visits after reading analysis

### Content Quality:
- # of legal commentary articles linked per event
- Relevance ratings (if collecting feedback)
- User feedback on value

### Coverage:
- % of major events with legal analysis
- % of SCOTUS cases with expert commentary
- Time lag between event and analysis link

---

## Open Questions

1. **When to implement?**
   - After event architecture MVP?
   - Alongside SCOTUS feature?
   - Independent feature?

2. **Which sources beyond Lawfare/Just Security?**
   - Take Care Blog?
   - Volokh Conspiracy?
   - SCOTUSblog?

3. **Auto-linking feasibility:**
   - Can AI reliably match commentary to events?
   - What accuracy threshold is acceptable?
   - How much manual review is acceptable?

4. **User-submitted links:**
   - Allow users to suggest legal commentary?
   - Moderation workflow?
   - Quality control?

---

## Related Documents

- `/docs/research/event-based-architecture-sketch.md` - Event tab design
- `/docs/plans/scotus-tracking-v1.md` - SCOTUS feature plan
- `/docs/plans/pardons-tracker-prd.md` - Similar pattern for "receipts"

---

## Next Steps

**Decision needed:**
1. ✅ Add Lawfare/Just Security RSS feeds now?
2. ✅ Wait until event architecture exists?
3. ✅ Implement for SCOTUS first (simpler integration point)?

**Recommendation:**
- **Now:** Add RSS feeds (captures articles for later use)
- **Phase 1:** Integrate with SCOTUS (simpler, fewer events)
- **Phase 2:** Integrate with Events (after event architecture MVP)

**This way:** Legal commentary accumulates while building features, ready to link when needed.

---

**Document Status:** Design complete, awaiting implementation decision
**Estimated Effort:** 2-3 weeks for full implementation (all phases)
**Budget Impact:** <$1/month

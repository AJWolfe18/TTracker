# Event-Based Architecture Sketch

**Date:** 2026-01-13
**Purpose:** Explore transition from story aggregation to event tracking model
**Status:** Concept / Design Phase

---

## Executive Summary

**Current Model:** RSS feeds → Articles → AI clusters into Stories (~2700 stories)
**Proposed Model:** RSS feeds → Articles → Stories → **Promoted to Events** → Tracked outcomes

**Key Insight:** Stories are inputs, Events are the product.

---

## The Problem with Story-Based Model

### Current User Experience:
1. User lands on homepage
2. Sees 50+ "active" stories scrolling by
3. Generic headlines: "Trump Criticizes...", "GOP Lawmakers..."
4. No way to track outcomes
5. No focused discussions
6. User leaves (low engagement)

### Why This Happens:
- RSS finds 100+ articles/day
- AI clusters into 20-30 stories/day
- Most stories are incremental news updates
- No distinction between **major events** vs **daily noise**
- User can't follow a story arc to resolution

---

## Event-Based Model Vision

### User Experience:
1. User lands on homepage
2. Sees **10-20 major events** (not 50+ stories)
3. Specific, trackable: "Trump January 6 Pardons", "Bondi Fires DOJ Prosecutors", "Smith Documents Case"
4. Each event has:
   - **Timeline** - Chronological updates
   - **Key Documents** - EOs, court filings, official statements
   - **Analysis** - Expert legal/policy commentary
   - **Discussion** - Focused debate per event
   - **Outcome Status** - "Ongoing", "Resolved", "Appealed", etc.
5. User bookmarks events they care about
6. Returns to check updates
7. Participates in focused discussions

### Why This Works:
- **Curated** - 10-20 events vs 2700 stories
- **Trackable** - Events have outcomes/resolutions
- **Engaging** - Users invested in specific events
- **Differentiated** - Not just another news aggregator
- **Sticky** - Users return to track outcomes
- **Discussable** - Focused debates, not scattered comments

---

## Architecture Design

### Database Schema Changes

#### New Table: `events`
```sql
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,

  -- Identity
  title TEXT NOT NULL,                    -- "Trump January 6 Pardons"
  slug TEXT UNIQUE NOT NULL,              -- "trump-jan6-pardons"
  description TEXT,                       -- Brief overview

  -- Categorization
  event_type TEXT NOT NULL,               -- 'executive_order', 'court_case', 'scandal', 'legislation', 'appointment'
  category TEXT,                          -- Same as stories category
  severity TEXT,                          -- 'critical', 'severe', 'moderate', 'minor'

  -- Status & Tracking
  status TEXT DEFAULT 'active',           -- 'emerging', 'active', 'resolved', 'archived'
  outcome TEXT,                           -- 'passed', 'blocked', 'guilty', 'dismissed', 'ongoing'

  -- Dates
  started_at TIMESTAMPTZ NOT NULL,
  last_updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  -- Metadata
  key_actors TEXT[],                      -- ['Trump', 'Bondi', 'Smith']
  related_entities JSONB,                 -- Orgs, agencies involved

  -- Engagement
  follower_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,

  -- AI
  summary TEXT,                           -- AI-generated event summary
  timeline_summary TEXT,                  -- "What's happened so far"

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_status ON events(status, last_updated_at DESC);
CREATE INDEX idx_events_type ON events(event_type);
```

#### New Junction: `event_stories`
```sql
CREATE TABLE event_stories (
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,

  added_at TIMESTAMPTZ DEFAULT NOW(),
  is_primary BOOLEAN DEFAULT false,       -- Which story triggered event creation

  PRIMARY KEY (event_id, story_id)
);
```

#### New Table: `event_timeline`
```sql
CREATE TABLE event_timeline (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,

  -- Timeline Entry
  happened_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,                    -- "House Votes to Impeach"
  description TEXT,                       -- Details

  -- Source
  source_type TEXT,                       -- 'story', 'document', 'manual'
  source_id TEXT,                         -- story_id or document_id
  source_url TEXT,                        -- Link to source

  -- Significance
  is_major BOOLEAN DEFAULT false,         -- Major milestone vs minor update

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeline_event ON event_timeline(event_id, happened_at DESC);
```

#### New Table: `event_documents`
```sql
CREATE TABLE event_documents (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,

  -- Document
  title TEXT NOT NULL,                    -- "Executive Order 14343"
  doc_type TEXT,                          -- 'executive_order', 'court_filing', 'legislation', 'statement'
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,

  -- Content
  summary TEXT,                           -- AI summary of document
  full_text TEXT,                         -- Scraped content if available

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Modified: `stories` table
```sql
ALTER TABLE stories
ADD COLUMN promoted_to_event BIGINT REFERENCES events(id),
ADD COLUMN is_event_worthy BOOLEAN DEFAULT false;

-- Index for finding stories that should be promoted
CREATE INDEX idx_stories_event_worthy ON stories(is_event_worthy, promoted_to_event);
```

---

## Event Types & Examples

### 1. Executive Orders
- **Example:** "Trump Immigration EO", "Pardon Proclamation"
- **Timeline:** Signed → Challenged → Court ruling → Enforced/Blocked
- **Documents:** EO text, court filings, agency memos
- **Outcome:** "Enforced", "Blocked by court", "Modified"

### 2. Court Cases
- **Example:** "Trump NY Hush Money Trial", "Jack Smith Documents Case"
- **Timeline:** Indictment → Trial → Verdict → Appeal
- **Documents:** Indictments, motions, rulings
- **Outcome:** "Guilty", "Dismissed", "Appealed", "Ongoing"

### 3. Scandals
- **Example:** "Trump Cabinet Nominee Ethics Issues"
- **Timeline:** Revelation → Investigation → Hearings → Resolution
- **Documents:** Ethics reports, hearing transcripts
- **Outcome:** "Confirmed", "Withdrawn", "Ongoing"

### 4. Legislation
- **Example:** "Debt Ceiling Standoff 2026"
- **Timeline:** Introduced → Committee → Floor vote → Signed/Vetoed
- **Documents:** Bill text, amendments, CBO score
- **Outcome:** "Passed", "Failed", "Modified", "Tabled"

### 5. Appointments
- **Example:** "Pam Bondi AG Confirmation"
- **Timeline:** Nominated → Hearings → Vote → Confirmed/Rejected
- **Documents:** Nomination, hearing testimony, vote record
- **Outcome:** "Confirmed", "Rejected", "Withdrawn"

---

## Event Promotion Logic

### How Stories Become Events

**Option A: Manual Curation (MVP)**
1. Human reviews top stories daily
2. Manually creates events for major developments
3. Links related stories to events
4. Updates timeline manually

**Option B: AI-Assisted (Phase 2)**
1. AI scores stories for "event-worthiness"
2. Criteria:
   - High severity (critical/severe)
   - Multiple sources (5+ articles)
   - Contains outcome-trackable elements (court case, legislation, EO)
   - Sustained coverage (3+ days)
3. Human reviews AI suggestions
4. Approves promotion to event

**Option C: Fully Automated (Future)**
1. AI auto-creates events
2. AI maintains timeline
3. AI links related stories
4. Human spot-checks only

**Recommendation:** Start with **Option A** (manual), evolve to **Option B** within 2-3 months.

---

## Product Features

### Homepage
```
┌─────────────────────────────────────┐
│  TrumpyTracker - Event Dashboard    │
├─────────────────────────────────────┤
│  [Active Events] [Resolved] [All]   │
├─────────────────────────────────────┤
│  🔴 CRITICAL                         │
│  ┌─────────────────────────────────┐│
│  │ Trump January 6 Pardons         ││
│  │ 127 updates • 3.2K following    ││
│  │ Last update: 2 hours ago        ││
│  │ Status: Legal challenges filed  ││
│  └─────────────────────────────────┘│
│                                      │
│  🟠 SEVERE                           │
│  ┌─────────────────────────────────┐│
│  │ Bondi Fires DOJ Prosecutors     ││
│  │ 43 updates • 1.8K following     ││
│  │ Last update: 6 hours ago        ││
│  │ Status: Congressional inquiry   ││
│  └─────────────────────────────────┘│
│                                      │
│  🟡 MODERATE                         │
│  ┌─────────────────────────────────┐│
│  │ Debt Ceiling Negotiations       ││
│  │ 89 updates • 945 following      ││
│  │ Last update: 1 day ago          ││
│  │ Status: Talks ongoing           ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### Event Detail Page
```
┌─────────────────────────────────────┐
│  Trump January 6 Pardons             │
│  [Follow] [Share]                    │
├─────────────────────────────────────┤
│  Status: Legal challenges filed      │
│  Started: Jan 5, 2026                │
│  Last Update: 2 hours ago            │
├─────────────────────────────────────┤
│  [Timeline] [Documents] [Analysis]   │
│  [Discussion] [Related]              │
├─────────────────────────────────────┤
│  TIMELINE                            │
│  ─────────────────────────────────  │
│                                      │
│  ● 2 hours ago                       │
│    ACLU Files Legal Challenge        │
│    "Constitutional questions raised  │
│     about scope of pardon power"     │
│    [23 articles] [Court filing]      │
│                                      │
│  ● Yesterday 3pm                     │
│    DOJ Issues Guidance on Pardons    │
│    "Memo instructs prosecutors on    │
│     releasing pardoned individuals"  │
│    [15 articles] [DOJ memo]          │
│                                      │
│  ● Jan 5, 11am                       │
│    ⭐ Trump Signs Pardon Order        │
│    "1,500+ Jan 6 defendants to be    │
│     released immediately"            │
│    [89 articles] [Executive Order]   │
│                                      │
│  ● Jan 4, 8pm                        │
│    Trump Announces Pardon Plans      │
│    "President signals broad clemency │
│     for Capitol riot participants"   │
│    [45 articles]                     │
└─────────────────────────────────────┘
```

### Documents Tab
```
┌─────────────────────────────────────┐
│  KEY DOCUMENTS                       │
├─────────────────────────────────────┤
│  📄 Executive Order 14501            │
│     "Pardon for Jan 6 Offenses"      │
│     Jan 5, 2026 • [Full text]        │
│     [AI Summary]                     │
│                                      │
│  ⚖️  ACLU v. Trump                   │
│     Legal Challenge Filing           │
│     Jan 13, 2026 • [Court doc]       │
│     [AI Summary]                     │
│                                      │
│  📋 DOJ Internal Memo                │
│     Guidance on Pardon Implementation│
│     Jan 12, 2026 • [Leaked doc]      │
│     [AI Summary]                     │
└─────────────────────────────────────┘
```

### Analysis Tab
```
┌─────────────────────────────────────┐
│  EXPERT ANALYSIS                     │
├─────────────────────────────────────┤
│  Lawfare Blog                        │
│  "The Legal Problems with Trump's    │
│   January 6 Pardons"                 │
│  2 days ago • 12 min read            │
│                                      │
│  Just Security                       │
│  "Pardon Power: Historical Precedent │
│   and Constitutional Limits"         │
│  3 days ago • 8 min read             │
│                                      │
│  Brookings Institution               │
│  "Political Implications of Mass     │
│   Pardons for Jan 6 Offenders"       │
│  4 days ago • 10 min read            │
└─────────────────────────────────────┘
```

---

## Migration Path from Stories to Events

### Phase 1: Parallel Systems (Months 1-2)
- Keep current story system running
- Add events database schema
- Manually create 5-10 major events
- Link existing stories to events
- Test event UI with small user group

### Phase 2: Event Promotion (Months 2-4)
- Add "Promote to Event" button in admin UI
- Build AI event-worthiness scoring
- Train AI on which stories become events
- Create 30-50 total events
- Shift homepage to feature events prominently

### Phase 3: Event-First (Months 4-6)
- Homepage shows events by default
- Stories become background/discovery
- Users follow events, not stories
- RSS feeds optimized for event detection
- Reduce story AI cost (only summarize event-worthy stories)

### Phase 4: Full Transition (Month 6+)
- Events are primary product
- Stories archived after clustering
- RSS = event discovery only
- Add event predictions, outcome tracking
- User-submitted events

---

## Cost Analysis

### Current System Costs:
- **Story clustering:** ~$5/day
- **Story enrichment:** ~$10/day (GPT-4o-mini)
- **Total:** ~$450/month (if running daily)

### Event-Based Costs:
- **Event detection:** ~$2/day (score stories for event-worthiness)
- **Event summarization:** ~$3/day (10-20 events vs 2700 stories)
- **Timeline generation:** ~$2/day (AI updates timelines)
- **Total:** ~$210/month

**Savings: ~50% reduction in AI costs** because you're summarizing 10-20 events instead of 2700 stories.

---

## Technical Implementation Checklist

### Database
- [ ] Create `events` table
- [ ] Create `event_stories` junction
- [ ] Create `event_timeline` table
- [ ] Create `event_documents` table
- [ ] Alter `stories` table for event promotion
- [ ] Write RPCs for event operations

### Backend
- [ ] Event creation API
- [ ] Story → Event promotion logic
- [ ] Timeline update functions
- [ ] Document attachment handling
- [ ] Event following/bookmarking

### AI/ML
- [ ] Event-worthiness scoring model
- [ ] Event summary generation
- [ ] Timeline auto-update logic
- [ ] Document summarization

### Frontend
- [ ] Event dashboard homepage
- [ ] Event detail page with tabs
- [ ] Timeline UI component
- [ ] Document viewer
- [ ] Follow/bookmark functionality
- [ ] Event-based discussions

### Admin
- [ ] Manual event creation UI
- [ ] Story promotion interface
- [ ] Timeline editing tools
- [ ] Event status management

---

## Open Questions

### Product
1. **How many events?** 10? 50? 100?
2. **Event resolution?** Archive after outcome, or keep forever?
3. **User event creation?** Allow users to suggest events?
4. **Event predictions?** "Outcome: Likely to pass" with confidence scores?

### Technical
1. **Event detection threshold?** How to identify event-worthy stories?
2. **Timeline automation level?** Manual, AI-assisted, or fully auto?
3. **RSS optimization?** Filter feeds for event-relevant articles only?
4. **Search/discovery?** Events vs stories vs articles?

### Business
1. **Engagement metrics?** Track followers, comments per event?
2. **Notification system?** Alert followers when events update?
3. **Premium features?** Event predictions, advanced tracking?

---

## Next Steps (If Moving Forward)

### Immediate (Week 1):
1. Create events database schema
2. Manually create 5 test events
3. Link existing stories to events
4. Build basic event detail page

### Short-term (Weeks 2-4):
1. Add event dashboard homepage
2. Build timeline UI
3. Add document attachment system
4. Test with 10-20 events

### Medium-term (Months 2-3):
1. Build AI event detection
2. Add promotion workflow
3. Scale to 50+ events
4. User following/bookmarks

### Long-term (Months 4-6):
1. Full event-first product
2. Predictive outcomes
3. User-submitted events
4. Mobile app

---

## Conclusion

**Event-based model = better product fit for political accountability tracking.**

- More engaging (trackable outcomes)
- More focused (curated events vs noise)
- More scalable (fewer AI calls)
- More differentiated (not just aggregation)

**RSS expansion still makes sense** - more feeds = better event detection.

**Legal commentary fits perfectly** - analysis tab on event pages.

**This is the inevitable direction** if goal is accountability tracking with engaged users, not passive news scrolling.

---

**Document Status:** Concept sketch for discussion
**Next Step:** Get feedback, decide if/when to implement
**Estimated Implementation:** 2-3 months for MVP

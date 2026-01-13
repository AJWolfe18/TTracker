# PRD: Trump Pardons Tracker

**Status:** In Progress - MVP Complete, AI Enrichment In Progress
**Created:** 2026-01-10
**Updated:** 2026-01-13 (Added Perplexity integration approach)
**Author:** Josh + Claude
**Related ADO:** Epic 109 (Trump Pardons Tracker)

> **Note:** This PRD expands on and aligns with the existing ADO-109 epic.
> Key additions: data sources research, schema definition, implementation phases.
> Future PRDs will use OpenAI PRD template format.

---

## 1. Overview

### Problem Statement
Trump has issued 142+ individual pardons, 28 commutations, and ~1,500 mass pardons (Jan 6) in his second term. Users want to understand:
- WHO was pardoned and their relationship to Trump
- WHAT crimes they committed
- WHY it matters (pattern analysis, corruption implications)

Currently, pardons are scattered across news stories without structured tracking or analysis.

### Solution
A dedicated Pardons Tracker that:
1. Lists all Term 2 pardons with structured data
2. Categorizes by **relationship to Trump** (family, ally, donor, etc.)
3. Provides AI-enriched analysis (why it matters, shady news, severity rating)
4. Links to related news coverage from existing RSS feeds

---

## 2. Scope

### In Scope (MVP) - ✅ COMPLETE
- **Term 2 only** (2025-present) ✅
- Individual named pardons + mass pardons (Jan 6, fake electors) ✅
- Relationship-based categorization ✅
- DOJ scraper for automated ingestion ✅ (ADO-250)
- Frontend UI with filtering and search ✅

### In Progress (AI Enrichment)
- Perplexity API for research/facts (ADO-253)
- GPT for editorial tone generation (ADO-246)
- Related stories linking (ADO-248)

### Out of Scope (Future)
- Term 1 backfill (could add later)
- Pardon request tracking (rumors/pending)
- Connection network visualization

---

## 3. Data Sources

### Layer 1: Official Pardon Facts (DOJ)
**Source:** [DOJ Office of the Pardon Attorney](https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present)

| DOJ Provides | DOJ Does NOT Provide |
|--------------|---------------------|
| Recipient name | Relationship to Trump |
| Pardon date | Donation history |
| Offense (brief) | Full crime context |
| District convicted | "Shady news" background |

### Layer 2: Relationship Research (Original Research)
For each pardon, we research the Trump connection using factual sources:

| Source | What It Provides | URL |
|--------|-----------------|-----|
| **FEC Donation Records** | Campaign contribution amounts | opensecrets.org, fec.gov |
| **Court Filings (PACER)** | Conviction details, sentencing | pacer.uscourts.gov |
| **ProPublica Investigations** | Investigative reporting on pardons | propublica.org |
| **News Archives** | Relationship context, Mar-a-Lago visits | Our RSS feeds + targeted search |
| **Ballotpedia** | Political background, roles | ballotpedia.org |
| **CNS Maryland Timeline** | Structured pardon data | [cnsmaryland.org](https://cnsmaryland.org/interactives/fall2025/pardons/) |

### Layer 3: Aggregators (Reference Only)
- **Wikipedia** - Starting point for leads, but verify all claims with primary sources
- **codeddarkness Database** - [Community tracker](https://codeddarkness.github.io/taco_pardons/) with FBI/court filing sources

### Research Workflow
```
1. DOJ announces pardon → Enter name, date, offense
2. Search FEC for donations → Enter donation_amount_usd
3. Search news for relationship → Enter connection_type, trump_connection_detail
4. Search PACER for conviction → Enter original_sentence, conviction_date
5. Search for shady news → Build receipts_timeline
6. AI enriches → Generate summary_spicy, why_it_matters
```

---

## 4. Data Pipeline (Automated)

```
DOJ publishes pardon
    ↓
DOJ Scraper (daily via GitHub Actions)           [ADO-250 ✅]
    ├── Scrapes DOJ clemency page
    ├── Extracts: name, date, district, offense
    ├── Deduplicates via source_key hash
    └── Inserts with is_public=false, research_status='pending'
    ↓
Perplexity Research (daily via GitHub Actions)   [ADO-253]
    ├── Queries Perplexity Sonar for each pardon
    ├── Researches: Trump connection, corruption indicators
    ├── Populates: connection_type, corruption_level, receipts_timeline
    └── Sets research_status='complete'
    ↓
GPT Tone Generation                              [ADO-246]
    ├── Takes research data from Perplexity
    ├── Generates: summary_spicy, why_it_matters, pattern_analysis
    ├── Sets is_public=true
    └── Updates enriched_at timestamp
    ↓
Public display on Pardons tab
```

### Two-Phase AI Pipeline

| Phase | Tool | Purpose | Cost |
|-------|------|---------|------|
| **Research** | Perplexity Sonar | Gather facts (connection, corruption, timeline) | ~$0.0065/pardon |
| **Tone** | GPT-4o-mini | Generate editorial content (spicy summaries) | ~$0.003/pardon |

**Why split?** Perplexity excels at web research with citations. GPT excels at creative writing with specific tone. Combined: ~$0.01/pardon.

---

## 5. Status Definitions

| Status | Definition | Use Case |
|--------|------------|----------|
| **Confirmed** | Official pardon issued and verified | Default for all entries |
| **Reported** | News reports but awaiting official confirmation | Breaking news situations |

**Note:** Unlike SCOTUS (which has Pending → Argued → Decided lifecycle), pardons are binary - they're either issued or not. Status is simpler.

---

## 6. Connection Type (Primary Classification)

Per ADO-109 pattern, categorize by recipient's connection to Trump:

| Category | Database Value | Badge Display | Examples |
|----------|---------------|---------------|----------|
| **Mar-a-Lago VIP** | `mar_a_lago_vip` | MAR-A-LAGO VIP | Inner circle, frequent guests |
| **Major Donor** | `major_donor` | MAJOR DONOR | $100K+ contributors |
| **Family** | `family` | FAMILY | Kushners, potential self-pardon |
| **Political Ally** | `political_ally` | POLITICAL ALLY | Giuliani, Meadows, Bannon |
| **Campaign Staff** | `campaign_staff` | CAMPAIGN STAFF | Former managers, advisors |
| **Business Associate** | `business_associate` | BUSINESS ASSOCIATE | Trump Org connections |
| **Jan 6 Defendant** | `jan6_defendant` | JAN 6 DEFENDANT | Named rioters, organizers |
| **Fake Electors** | `fake_electors` | FAKE ELECTOR | Election subversion scheme |
| **Celebrity** | `celebrity` | CELEBRITY | Ross Ulbricht, Todd Chrisley |
| **No Known Connection** | `no_connection` | NO KNOWN CONNECTION | Criminal justice reform cases |

---

## 7. Crime Categories (Secondary Classification)

For filtering by what they were convicted of:

| Category | Database Value | Examples |
|----------|---------------|----------|
| **White Collar/Fraud** | `white_collar` | Tax evasion, bank fraud, wire fraud |
| **Obstruction/Cover-up** | `obstruction` | Obstruction of justice, perjury, witness tampering |
| **Political Corruption** | `political_corruption` | Bribery, campaign finance, abuse of power |
| **Violent Crime** | `violent` | Assault, war crimes (rare for pardons) |
| **Drug Offenses** | `drug` | Drug trafficking, distribution |
| **Election Related** | `election` | Fake electors, election interference |
| **Jan 6 Related** | `jan6` | Insurrection, trespassing, assault on officers |
| **Other** | `other` | Miscellaneous |

---

## 8. Corruption Level (Spicy Severity)

Following ADO-109's established pattern, use a **5-level "Corruption Level"** scale with snarky labels:

| Level | Spicy Label | Database Value | Criteria |
|-------|-------------|---------------|----------|
| **5** | "Paid-to-Play" | `paid_to_play` | Direct financial quid pro quo, donor bought the pardon |
| **4** | "Friends & Family Discount" | `friends_family` | Inner circle, personal relationship, self-dealing |
| **3** | "Swamp Creature" | `swamp_creature` | Political ally, lobbyist connection, covers up wrongdoing |
| **2** | "Celebrity Request" | `celebrity_request` | Kim K called, media campaign, no direct corruption |
| **1** | "Broken Clock" | `broken_clock` | Actually arguably justified, criminal justice reform |

**Note:** Scale goes from most corrupt (5) to least corrupt (1).

---

## 9. Database Schema (Proposed)

```sql
CREATE TABLE pardons (
  -- Identity
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_name TEXT NOT NULL,
  recipient_slug TEXT UNIQUE,  -- URL-safe name: "rudy-giuliani"
  nickname TEXT,  -- Spicy nickname: "America's Mayor (LOL)"
  photo_url TEXT,  -- Mugshot or headshot

  -- Pardon Details
  pardon_date DATE NOT NULL,
  clemency_type TEXT NOT NULL CHECK (clemency_type IN ('pardon', 'commutation', 'pre_emptive')),
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'reported')),

  -- Crime Info
  crime_description TEXT NOT NULL,
  crime_category TEXT NOT NULL,
  original_sentence TEXT,  -- "Life in prison", "10 years", etc.
  conviction_date DATE,

  -- Classification
  primary_connection_type TEXT NOT NULL,  -- Main reason for pardon: "mar_a_lago_vip", "major_donor", etc.
  secondary_connection_types TEXT[],  -- Other relevant relationships
  corruption_level SMALLINT NOT NULL CHECK (corruption_level BETWEEN 1 AND 5),

  -- Research Status
  research_status TEXT DEFAULT 'complete' CHECK (research_status IN ('complete', 'in_progress', 'pending')),
  -- 5 = "Paid-to-Play", 4 = "Friends & Family", 3 = "Swamp Creature",
  -- 2 = "Celebrity Request", 1 = "Broken Clock"

  -- Post-Pardon Tracking (What Happened Next)
  post_pardon_status TEXT DEFAULT 'quiet' CHECK (post_pardon_status IN ('quiet', 'under_investigation', 're_offended')),
  post_pardon_notes TEXT,

  -- Research Data
  trump_connection_detail TEXT,  -- Longer description of relationship
  donation_amount_usd NUMERIC,  -- For donor connections: $$$ amount

  -- The Receipts (Timeline Data)
  receipts_timeline JSONB,  -- [{date, event_type, description}, ...]
  -- event_types: "donation", "conviction", "pardon_request", "pardon_granted", "mar_a_lago_visit"

  -- AI Enrichment
  summary_neutral TEXT,
  summary_spicy TEXT,  -- "THE REAL STORY" - T² editorial voice
  why_it_matters TEXT,
  pattern_analysis TEXT,  -- How this fits broader pardon patterns

  -- Enrichment Metadata
  enriched_at TIMESTAMPTZ,
  needs_review BOOLEAN DEFAULT false,

  -- Sources
  primary_source_url TEXT,  -- DOJ announcement, news article
  source_urls JSONB DEFAULT '[]',  -- Additional sources
  related_story_ids BIGINT[],  -- Links to stories table

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(recipient_name, '') || ' ' ||
      COALESCE(nickname, '') || ' ' ||
      COALESCE(crime_description, '') || ' ' ||
      COALESCE(trump_connection_detail, '') || ' ' ||
      COALESCE(summary_neutral, '')
    )
  ) STORED
);

-- Indexes
CREATE INDEX idx_pardons_date ON pardons(pardon_date DESC);
CREATE INDEX idx_pardons_connection ON pardons(primary_connection_type);
CREATE INDEX idx_pardons_crime ON pardons(crime_category);
CREATE INDEX idx_pardons_corruption ON pardons(corruption_level);
CREATE INDEX idx_pardons_post_status ON pardons(post_pardon_status);
CREATE INDEX idx_pardons_research ON pardons(research_status);
CREATE INDEX idx_pardons_search ON pardons USING GIN(search_vector);
```

---

## 10. AI Enrichment System

### Phase 1: Perplexity Research (ADO-253)

**Model:** Perplexity Sonar (~$0.0065/pardon)
**Trigger:** Daily GitHub Actions workflow (`research-pardons.yml`)

```
Research the following pardon recipient and provide structured JSON:

RECIPIENT: {recipient_name}
PARDON DATE: {pardon_date}
OFFENSE: {offense_raw}
DISTRICT: {conviction_district}

Return JSON with:
{
  "primary_connection_type": "major_donor|political_ally|family|business_associate|celebrity|jan6_defendant|fake_electors|no_connection",
  "trump_connection_detail": "2-3 sentence explanation of relationship to Trump",
  "corruption_level": 1-5,  // 5=paid-to-play, 1=arguably justified
  "corruption_reasoning": "Why this corruption level",
  "receipts_timeline": [
    {"date": "YYYY-MM-DD", "event_type": "donation|conviction|pardon_granted|mar_a_lago_visit|investigation|sentencing", "description": "What happened", "amount_usd": null, "source_url": "citation"}
  ],
  "donation_amount_usd": null,  // If applicable
  "sources": ["url1", "url2"]
}

RULES:
- Only include facts with citations
- If no Trump connection found, use "no_connection"
- Include FEC donation records if available
- Note any ongoing investigations affected by pardon
```

### Phase 2: GPT Tone Generation (ADO-246)

**Model:** GPT-4o-mini (~$0.003/pardon)
**Trigger:** After Perplexity research completes

```
You are writing for TrumpyTracker, a political accountability site with a sharp, snarky editorial voice.

Given this research data about a pardon:
{perplexity_research_output}

Generate:

1. SUMMARY_NEUTRAL: Factual 2-3 sentence summary (for accessibility)

2. SUMMARY_SPICY: "THE REAL STORY" - Sharp, engaging summary that:
   - Leads with the most damning detail
   - Uses active voice and punchy sentences
   - Calls out hypocrisy or corruption directly
   - Avoids both-sidesing obvious wrongdoing

3. WHY_IT_MATTERS: What this pardon means for:
   - The justice system ("rules for thee, not for me")
   - Ongoing investigations (did this kill a case?)
   - Pattern of corruption (how does this fit the broader scheme?)

4. PATTERN_ANALYSIS: How this fits Trump's pardon pattern:
   - Similar recipients pardoned
   - Timing significance
   - Who benefits (follow the money/power)

TONE GUIDELINES:
- Be factual but don't be boring
- Righteous anger is appropriate for corruption
- Use specific details, not vague accusations
- Cite the receipts timeline events
```

### Workflow Sequence

```
1. DOJ Scraper runs → inserts raw pardon data (research_status='pending')
2. Perplexity workflow runs → populates facts (research_status='complete')
3. GPT workflow runs → generates tone (is_public=true, enriched_at=NOW())
```

---

## 11. UI Design (Per ADO-109 Pattern)

### Tagline Options (Sets the Tone)
- "Who You Know > What You Did"
- "Tracking the Get-Out-of-Jail-Free Cards"
- "The Two-Tier Justice System, Exposed"

### Quick Stats Bar (Snarky Aggregate Metrics)
```
🎫 147 Pardons Tracked | 💰 $45.2M in Donor Connections | 🔄 12 Re-offended
Last updated: [Date]
```

### Pardons Tab
- **Location:** 4th tab after Stories | Executive Orders | Supreme Court
- **URL:** `/?tab=pardons` or `/pardons.html`

### Card Design (Spicy Version)
```
┌─────────────────────────────────────────┐
│ [MAR-A-LAGO VIP]  [OBSTRUCTION]  Jan 20 │
│                                         │
│ 👤 Rudy Giuliani                        │
│    "America's Mayor (LOL)"   ← nickname │
│                                         │
│ 📋 Original: 10 years federal → PARDONED│
│                                         │
│ THE REAL STORY:                         │
│ Trump's personal fixer who knew where   │
│ all the bodies were buried. Pre-emptive │
│ pardon ensures he never testifies.      │
│                                         │
│ ████████░░ Corruption: 5 "Paid-to-Play" │
│                                         │
│ [The Receipts]      [View Details →]    │
└─────────────────────────────────────────┘
```

### Filters
- Search: Name, crime, description
- Corruption Level pills: 5 | 4 | 3 | 2 | 1
- Connection Type dropdown: Mar-a-Lago VIP, Major Donor, Family, etc.
- Crime category dropdown: White collar, Obstruction, Jan 6, etc.
- Post-Pardon Status: Quiet, Under Investigation, Re-offended

### Detail Modal Sections

1. **The Pardon** - What happened, when, clemency type
2. **The Crime** - What they did, sentence, conviction details
3. **The Connection** - How they know Trump, relationship history
4. **The Real Story** - Spicy AI summary (T² editorial voice)
5. **The Receipts** - Timeline: donation dates, conviction, pardon request, pardon grant
6. **What Happened Next** - Post-pardon status tracking

### Unique Features (Per ADO-109)

| Feature | Description | Phase |
|---------|-------------|-------|
| **The Receipts** | Timeline showing donation→conviction→pardon chain | MVP |
| **What Happened Next** | Track post-pardon status (re-offended?) | MVP |
| **Social Sharing** | Share pardon cards to Twitter, Facebook, Copy Link (ADO-236) | MVP |
| **Connection Network** | Visual graph of relationships | Phase 3 |

---

## 12. Implementation Phases

### Phase 1: Foundation (MVP) ✅ COMPLETE
- [x] Database schema + migrations (ADO-241)
- [x] Edge Functions: pardons-active, pardons-detail, pardons-stats (ADO-242)
- [x] Pardons tab UI: list, cards, modal (ADO-251)
- [x] Receipts timeline + What Happened Next (ADO-244)
- [x] Filtering & Search (ADO-245)
- [x] DOJ Scraper - automated ingestion (ADO-250)

### Phase 2: AI Enrichment 🚧 IN PROGRESS
- [ ] **Perplexity Research Integration** (ADO-253)
  - [ ] Perplexity API client setup
  - [ ] Research prompt for facts extraction
  - [ ] GitHub Actions workflow (`research-pardons.yml`) - daily
  - [ ] Populate: connection_type, corruption_level, receipts_timeline
- [ ] **GPT Tone Generation** (ADO-246)
  - [ ] Tone prompt for editorial content
  - [ ] Generate: summary_spicy, why_it_matters, pattern_analysis
  - [ ] Set is_public=true after enrichment
- [ ] **Related Stories Linking** (ADO-248)
  - [ ] Query stories table for pardon mentions
  - [ ] Populate pardon_story junction table
- [ ] **Display Enrichment** (ADO-247)
  - [ ] Show why_it_matters in modal
  - [ ] Show pattern_analysis
  - [ ] Loading states for unenriched pardons

### Phase 3: Social & Polish
- [ ] Social sharing (ADO-236)
- [ ] Statistics dashboard enhancements
- [ ] Connection network visualization (future)

---

## 13. Cost Analysis

### Per-Pardon Costs

| Phase | Tool | Cost/Pardon | Notes |
|-------|------|-------------|-------|
| Research | Perplexity Sonar | ~$0.0065 | Tokens + request fee |
| Tone | GPT-4o-mini | ~$0.003 | ~1K tokens |
| **Total** | | **~$0.01** | Both phases |

### Estimated Spend

| Scenario | Pardons | Cost |
|----------|---------|------|
| Initial backfill | 92 | ~$0.92 |
| Monthly new pardons | ~10 | ~$0.10 |
| Re-enrichment buffer | ~20 | ~$0.20 |
| **Monthly total** | | **~$1-2/month** |

### Budget Impact

| Service | Monthly Cost | % of $50 Budget |
|---------|-------------|-----------------|
| Perplexity (pardons) | ~$1 | 2% |
| OpenAI (pardons + stories) | ~$20 | 40% |
| Supabase | Free tier | 0% |
| **Total** | ~$21-22 | 42-44% |

**Verdict:** Well within budget. Perplexity adds negligible cost for significant research quality improvement.

---

## 14. Decisions Made

1. **Jan 6 Mass Pardons:** ✅ Single group entry
   - Create one entry: "January 6th Mass Pardon"
   - Include: count (~1,500), date (Jan 20, 2025), notable names
   - Link to NPR's Jan 6 defendant database for details

2. **Fake Electors (77 people):** ✅ Notable names individually, group the rest
   - Individual entries for: Giuliani, Meadows, Powell, Ellis, Chesebro, Eastman
   - Group entry for remaining state-level officials

3. **Admin Interface:** ✅ Part of broader Admin Dashboard feature
   - MVP: Use Supabase dashboard directly for data entry
   - Future: Build unified admin dashboard (see Section 15)

## 15. Admin Dashboard Requirements (Future Feature)

The pardons tracker needs admin entry capabilities. Rather than building a one-off form, this should be part of a **unified Admin Dashboard** for the entire site.

### Admin Dashboard Scope

| Feature | Current State | Need |
|---------|--------------|------|
| **Pardons Entry** | None | Add/edit pardon records |
| **Story Management** | None | Edit story metadata, merge duplicates |
| **Feed Management** | SQL only | Add/edit RSS feeds, view status |
| **EO Management** | None | Add/edit executive orders |
| **SCOTUS Management** | None | Add/edit SCOTUS cases |
| **User Management** | None | (Future: if multi-user) |

### Pardons Admin Form Fields

**Required on entry:**
- Recipient name
- Pardon date
- Clemency type (pardon/commutation/pre-emptive)
- Crime description
- Crime category (dropdown)
- Relationship category (dropdown)
- Severity (dropdown)
- Primary source URL

**Optional/Later:**
- Trump connection detail (longer text)
- Original sentence
- Conviction date
- Shady news summary
- Related story IDs (link picker)

### Admin Dashboard Priority

This is a **separate JIRA epic** - not part of Pardons MVP. For MVP:
- Enter pardons directly via Supabase Table Editor
- Build admin dashboard as dedicated feature later
- Pardons form becomes first module in that dashboard

## 16. Open Questions (Remaining)

1. **Pardon Amendments:**
   - Can pardons be modified/revoked? (Extremely rare)
   - Add `revoked` status if needed?

2. **Enrichment Trigger:**
   - Auto-enrich on insert?
   - Or manual trigger button?

---

## 17. Success Metrics

### User Engagement (Primary)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Pardons tab visits** | 500+ visits/month | GA4 page_view |
| **Detail modal opens** | 30%+ of visitors click "View Details" | GA4 pardon_modal_open |
| **Time on page** | 2+ minutes average | GA4 engagement_time |
| **Return visitors** | 20%+ come back | GA4 new_vs_returning |
| **Cross-navigation** | 15%+ click to related Stories | GA4 related_story_click |

### User Acquisition
| Metric | Why It Matters | How to Measure |
|--------|---------------|----------------|
| **Traffic source breakdown** | Where do visitors come from? | GA4 source/medium |
| **Search terms** | What are people googling? | Google Search Console |
| **First-time vs returning** | Is content sticky? | GA4 new_vs_returning |

### Engagement Depth
| Metric | Why It Matters | How to Measure |
|--------|---------------|----------------|
| **Scroll depth** | Do users see all pardons? | GA4 scroll event |
| **Filter usage rate** | Which filters used most? | GA4 filter_applied |
| **Cards viewed per session** | Browsing or targeted? | GA4 pardon_card_click count |
| **Modal section views** | Which sections get read? | GA4 modal_section_view |

### Content Performance
| Metric | Why It Matters | How to Measure |
|--------|---------------|----------------|
| **Most viewed pardons** | What drives interest? | GA4 by pardon_id |
| **Views by corruption level** | Do users prefer scandal? | GA4 custom dimension |
| **Views by connection type** | Donors vs Family vs Jan 6? | GA4 custom dimension |

### Virality
| Metric | Why It Matters | How to Measure |
|--------|---------------|----------------|
| **Share button clicks** | Are users sharing? | GA4 share event |
| **Shares by platform** | Twitter vs Facebook? | GA4 share method |
| **Social referral traffic** | Did sharing work? | GA4 source/medium |

### Data Quality (Secondary)
| Metric | Target |
|--------|--------|
| All Term 2 pardons tracked | 100% completeness |
| Pardon facts accurate | 0 errors on date/crime/type |
| AI enrichment coverage | 100% have "The Real Story" |
| Relationship sourced | All connection_types have citation |

---

## 18. Sorting & Pagination

### Sort Options
| Option | Database Query | Default |
|--------|---------------|---------|
| **Date (Newest)** | `ORDER BY pardon_date DESC` | ✅ Default |
| **Corruption Level (Highest)** | `ORDER BY corruption_level DESC` | |
| **Name (A-Z)** | `ORDER BY recipient_name ASC` | |

### Pagination
- **Items per page:** 20 (matches Stories and EOs pattern)
- **Component:** Reuse existing `Pagination` component from app.js
- **Behavior:** Page numbers with prev/next buttons

---

## 19. URL Structure

### Routes
| Page | URL | Notes |
|------|-----|-------|
| **List view** | `/pardons` or `/?tab=pardons` | Main pardons page |
| **Individual pardon** | `/pardons?id=[slug]` | Deep link for sharing |

### Slug Format
- Pattern: `recipient-name-lowercase-hyphenated`
- Examples: `rudy-giuliani`, `steve-bannon`, `january-6th-mass-pardon`
- Generated from `recipient_slug` field in database

---

## 20. Empty & Error States

### Empty States
| State | Display |
|-------|---------|
| **No pardons yet** | "No pardons tracked yet. Check back soon." |
| **No filter results** | "No pardons match your filters" + [Clear Filters] button |
| **Loading** | Skeleton cards (3 placeholder cards with pulse animation) |

### Error States
| State | Display |
|-------|---------|
| **API failure** | "Unable to load pardons. Please refresh the page." + [Retry] button |
| **Pardon not found** | Redirect to list with toast: "Pardon not found" |

---

## 21. Photo Fallback

### When No Photo Available
- **Default image:** Trump mugshot silhouette
- **Alt text:** "Pardon recipient - photo unavailable"
- **Design notes:** Dark silhouette with orange background, on-brand with site's snarky tone

---

## 22. Research Status Display

### Status Badges
| Status | Badge Display | Card Behavior |
|--------|--------------|---------------|
| **complete** | (none) | Normal card display |
| **in_progress** | 🔍 INVESTIGATION IN PROGRESS | Partial info shown, some fields may be empty |
| **pending** | 📰 DEVELOPING STORY | Minimal info, placeholder for upcoming research |

### Display Rules
- Cards with `research_status != 'complete'` still appear in list (per decision to always show)
- Badge appears prominently on card
- Modal shows expanded message: "We're still researching this pardon. Check back for updates."

---

## 23. Mobile Responsiveness

### Breakpoints
| Screen | Cards Layout | Filters | Modal |
|--------|-------------|---------|-------|
| **Mobile (<640px)** | 1 column | Slide-out panel via "Filters" button | Full-screen |
| **Tablet (640-1024px)** | 2 columns | Horizontal pills | 90% width modal |
| **Desktop (>1024px)** | 3 columns | Sidebar or horizontal | Standard modal |

### Mobile-Specific Behavior
- Stats bar stacks vertically
- Corruption meter simplified to badge only
- Share buttons move to bottom of modal

---

## 24. Social Sharing

> **Related ADO:** [ADO-236: Add social sharing for pardon cards](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/236)

### Share Locations
- Share button on each pardon card
- Share button in detail modal header

### Platforms
- **Twitter/X** - Pre-filled tweet with spicy summary
- **Facebook** - Rich preview with photo and description
- **Copy Link** - Direct URL to pardon

### Share Text Template
```
🎫 PARDONED: [Name] - [Crime]

[Spicy summary snippet - first 100 chars]

Corruption Level: [X]/5 "[Label]"

See the full story: [URL]
```

### OpenGraph Meta Tags
```html
<meta property="og:title" content="PARDONED: [Name]" />
<meta property="og:description" content="[Spicy summary]" />
<meta property="og:image" content="[Photo URL or fallback]" />
<meta property="og:url" content="[Canonical URL]" />
<meta name="twitter:card" content="summary_large_image" />
```

---

## 25. Analytics Requirements

### GA4 Events to Implement
| Event | Trigger | Parameters |
|-------|---------|------------|
| `page_view` | Pardons tab load | `page_title: 'Pardons'` |
| `filter_applied` | User applies filter | `filter_type`, `filter_value` |
| `pardon_card_click` | User clicks card | `pardon_id`, `corruption_level`, `connection_type` |
| `pardon_modal_open` | Modal opens | `pardon_id` |
| `pardon_modal_section_view` | User views section | `pardon_id`, `section` |
| `share` | User clicks share | `method`, `content_type: 'pardon'`, `item_id` |
| `related_story_click` | User clicks related story | `source: 'pardon'`, `pardon_id`, `story_id` |

### Custom Dimensions (GA4)
- `corruption_level` (1-5)
- `primary_connection_type` (enum)
- `crime_category` (enum)

---

## 26. References

- [DOJ Clemency Grants Trump 2025+](https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present)
- [Wikipedia Term 2 Clemency List](https://en.wikipedia.org/wiki/List_of_people_granted_executive_clemency_in_the_second_Trump_presidency)
- [NPR Pardons Analysis](https://www.npr.org/2025/11/10/nx-s1-5587875/trump-pardons-insider-political-orbit-second-term)
- [ProPublica Pardons Investigation](https://www.propublica.org/article/trump-pardons-clemency-george-santos-ed-martin)
- [Ballotpedia Pardon Statistics](https://news.ballotpedia.org/2025/11/12/president-donald-trump-r-has-issued-142-pardons-in-second-term-so-far/)
- [CNS Maryland Pardons Timeline](https://cnsmaryland.org/interactives/fall2025/pardons/)
- [codeddarkness Community Tracker](https://codeddarkness.github.io/taco_pardons/)

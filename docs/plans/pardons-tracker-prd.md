# PRD: Trump Pardons Tracker

**Status:** Draft - Aligns with ADO-109
**Created:** 2026-01-10
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

### In Scope (MVP)
- **Term 2 only** (2025-present)
- Individual named pardons (not mass Jan 6 pardons initially)
- Relationship-based categorization
- Full AI analysis (severity, why it matters, background research)
- Admin manual entry (no automation)

### Out of Scope (Future)
- Term 1 backfill (could add later)
- Mass pardon tracking (1,500+ Jan 6 individuals)
- Automated ingestion from DOJ/news
- Pardon request tracking (rumors/pending)

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

## 4. User Workflow

```
DOJ/News announces pardon
    ↓
Admin enters pardon in system
    ├── Recipient name
    ├── Pardon date
    ├── Crime description
    └── Clemency type (pardon/commutation/pre-emptive)
    ↓
Admin/AI researches recipient
    ├── How they know Trump
    ├── Original conviction details
    └── Any "shady" news about the deal
    ↓
AI enrichment
    ├── Why it matters
    ├── Pattern analysis
    ├── Severity rating
    └── Related stories (from existing RSS)
    ↓
Public display on Pardons tab
```

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
  connection_type TEXT NOT NULL,  -- "mar_a_lago_vip", "major_donor", "family", etc.
  corruption_level SMALLINT NOT NULL CHECK (corruption_level BETWEEN 1 AND 5),
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

  -- Justice Gap (Comparison Data)
  average_sentence_comparison TEXT,  -- "Average American: 10 years. This guy: Pardoned"

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
CREATE INDEX idx_pardons_connection ON pardons(connection_type);
CREATE INDEX idx_pardons_crime ON pardons(crime_category);
CREATE INDEX idx_pardons_corruption ON pardons(corruption_level);
CREATE INDEX idx_pardons_status ON pardons(post_pardon_status);
CREATE INDEX idx_pardons_search ON pardons USING GIN(search_vector);
```

---

## 10. AI Enrichment Prompt (Draft)

```
You are analyzing a presidential pardon. Given the pardon details, provide:

1. SUMMARY_NEUTRAL: Factual 2-3 sentence summary of who was pardoned and why
2. SUMMARY_SPICY: Engaging summary with accountability framing
3. WHY_IT_MATTERS: What this pardon means for:
   - The justice system
   - Presidential power precedents
   - Ongoing investigations
   - Pattern of corruption
4. PATTERN_ANALYSIS: How this fits Trump's broader pardon pattern:
   - Similar recipients (allies, donors, etc.)
   - Timing (before trials, after conviction)
   - Benefits to Trump personally

CRITICAL RULES:
- All claims must be sourced/verifiable
- Note if recipient was cooperating with investigations
- Flag any evidence of quid pro quo
- Identify if pardon benefits Trump's legal exposure
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
6. **Justice Gap** - Side-by-side: "Average American gets X, this person got pardoned"
7. **What Happened Next** - Post-pardon status tracking

### Unique Features (Per ADO-109)

| Feature | Description | Phase |
|---------|-------------|-------|
| **The Receipts** | Timeline showing donation→conviction→pardon chain | MVP |
| **Justice Gap** | Compare to non-connected person's outcome | Phase 2 |
| **What Happened Next** | Track post-pardon status (re-offended?) | Phase 2 |
| **Connection Network** | Visual graph of relationships | Phase 3 |

---

## 12. MVP Phasing

### Phase 1: Foundation (MVP)
- [ ] Database schema + migrations
- [ ] Admin entry form (basic)
- [ ] Pardons tab UI (list view)
- [ ] Card component
- [ ] Detail modal
- [ ] Filtering (relationship, severity)

### Phase 2: Enrichment
- [ ] AI enrichment prompt
- [ ] Enrichment job type
- [ ] "Why it matters" + pattern analysis
- [ ] Related stories linking

### Phase 3: Polish
- [ ] Search functionality
- [ ] Crime category filtering
- [ ] Statistics dashboard (counts by category)
- [ ] Mass pardon summary (Jan 6 as single entry)

---

## 13. Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Database storage | Free | Within Supabase limits |
| Pardon enrichment | ~$0.003/pardon | GPT-4o-mini (~1K tokens) |
| 150 pardons (Term 2) | ~$0.45 total | One-time cost |
| Ongoing (monthly) | ~$0.05/month | ~15-20 new pardons/month |

**Budget Impact:** Negligible (<1% of monthly budget)

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
| **Pardons tab visits** | 500+ visits/month | Analytics |
| **Detail modal opens** | 30%+ of visitors click "View Details" | Click tracking |
| **Time on page** | 2+ minutes average | Analytics |
| **Return visitors** | 20%+ come back | Analytics |
| **Cross-navigation** | 15%+ click to related Stories | Click tracking |

### Data Quality (Secondary)
| Metric | Target |
|--------|--------|
| All Term 2 pardons tracked | 100% completeness |
| Pardon facts accurate | 0 errors on date/crime/type |
| AI enrichment coverage | 100% have "The Real Story" |
| Relationship sourced | All connection_types have citation |

---

## 18. References

- [DOJ Clemency Grants Trump 2025+](https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present)
- [Wikipedia Term 2 Clemency List](https://en.wikipedia.org/wiki/List_of_people_granted_executive_clemency_in_the_second_Trump_presidency)
- [NPR Pardons Analysis](https://www.npr.org/2025/11/10/nx-s1-5587875/trump-pardons-insider-political-orbit-second-term)
- [ProPublica Pardons Investigation](https://www.propublica.org/article/trump-pardons-clemency-george-santos-ed-martin)
- [Ballotpedia Pardon Statistics](https://news.ballotpedia.org/2025/11/12/president-donald-trump-r-has-issued-142-pardons-in-second-term-so-far/)
- [CNS Maryland Pardons Timeline](https://cnsmaryland.org/interactives/fall2025/pardons/)
- [codeddarkness Community Tracker](https://codeddarkness.github.io/taco_pardons/)

# Tech Spec: ICE Accountability Tracker

**Status:** Draft
**Created:** 2026-01-24
**Author:** Claude
**Related PRD:** `/docs/features/ice-tracker/prd.md`
**Related ADO:** [Epic 298 - ICE Accountability Tracker](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/298)

---

## 1. Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ ice_stats       │  │ ice_incidents   │  │ ice_evidence    │  │
│  │ (bulk stats)    │  │ (events)        │  │ (links/embeds)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ rapid_response  │  │ ice_feed_queue  │                       │
│  │ (action links)  │  │ (pending review)│                       │
│  └─────────────────┘  └─────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Edge Functions:                                                 │
│  - ice-stats          GET /ice-stats                            │
│  - ice-incidents      GET /ice-incidents?type=X&state=Y         │
│  - ice-incident       GET /ice-incident?id=X                    │
│  - rapid-response     GET /rapid-response?state=X               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  public/ice-tracker.html  OR  public/index.html (new tab)       │
│  public/js/ice-tracker.js                                       │
│  public/css/ice-tracker.css (or inline in main CSS)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
STATISTICS:
Deportation Data Project (quarterly) → Manual import → ice_stats table
TRAC Reports (monthly) → Manual import → ice_stats table
                                              ↓
                                    ice-stats edge function
                                              ↓
                                    Frontend charts (Chart.js)

INCIDENTS:
RSS Feeds (ACLU, House Oversight) → rss-ice-filter.js → ice_feed_queue
Josh reviews queue → Promotes to ice_incidents
                  → Adds evidence links to ice_evidence
                                              ↓
                                    ice-incidents edge function
                                              ↓
                                    Frontend incident list

MANUAL ENTRY:
Josh sees something on social media → Admin form → ice_incidents + ice_evidence
```

---

## 2. Database Schema

### Table: `ice_stats`
Aggregated statistics for dashboard charts.

```sql
CREATE TABLE ice_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Time period
  stat_date DATE NOT NULL,                    -- Month or year start date
  period_type TEXT NOT NULL CHECK (period_type IN ('month', 'quarter', 'fiscal_year', 'calendar_year')),
  fiscal_year INT,                            -- e.g., 2025

  -- Administration context
  administration TEXT,                        -- 'obama_1', 'obama_2', 'trump_1', 'biden', 'trump_2'

  -- Deportation stats
  total_deportations INT,
  interior_removals INT,                      -- ICE interior (not border)
  border_removals INT,                        -- CBP border
  title_42_expulsions INT,                    -- Pandemic-era (Biden)

  -- Detention stats
  detention_population INT,                   -- Point-in-time count

  -- Criminal breakdown (the key narrative data)
  pct_no_conviction DECIMAL(5,2),             -- 73%
  pct_nonviolent_conviction DECIMAL(5,2),     -- 22%
  pct_violent_conviction DECIMAL(5,2),        -- 5%

  -- Arrests
  total_arrests INT,
  arrests_no_criminal_record INT,
  arrests_violent_crime INT,

  -- Deaths
  deaths_in_detention INT,

  -- US Citizens
  citizens_detained INT,
  citizens_deported INT,

  -- Source tracking
  source_name TEXT,                           -- 'TRAC', 'ICE.gov', 'Deportation Data Project'
  source_url TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(stat_date, period_type, source_name)
);

-- Indexes
CREATE INDEX idx_ice_stats_date ON ice_stats(stat_date DESC);
CREATE INDEX idx_ice_stats_admin ON ice_stats(administration);
CREATE INDEX idx_ice_stats_fy ON ice_stats(fiscal_year);
```

### Table: `ice_incidents`
Individual incidents for the event tracker.

```sql
CREATE TYPE ice_incident_type AS ENUM (
  'death_detention',      -- Person dies in ICE custody
  'ice_killing',          -- ICE agent kills someone
  'citizen_detained',     -- US citizen wrongfully detained
  'citizen_deported',     -- US citizen deported
  'court_order_violated', -- ICE ignores federal court
  'sensitive_location',   -- Church, school, hospital raid
  'rights_violation',     -- Constitutional rights violated
  'agent_violence',       -- Excessive force
  'vehicle_incident',     -- Car accidents, roadside incidents
  'family_separation',    -- Children separated from parents
  'medical_neglect',      -- Denial of medical care
  'agent_arrested'        -- ICE agent charged with crime
);

CREATE TYPE ice_incident_outcome AS ENUM (
  'ongoing',              -- Still developing
  'released',             -- Person released
  'deported',             -- Person deported
  'died',                 -- Person died
  'charges_filed',        -- Legal action against ICE
  'charges_dropped',      -- Charges against ICE dropped
  'settlement',           -- Civil settlement
  'unknown'               -- Outcome not known
);

CREATE TYPE ice_verification_status AS ENUM (
  'verified',             -- Confirmed by vetted source
  'reported',             -- News/social media, awaiting confirmation
  'disputed'              -- Conflicting accounts
);

CREATE TABLE ice_incidents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Basic info
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  incident_type ice_incident_type NOT NULL,

  -- When/Where
  incident_date DATE NOT NULL,
  incident_time TIME,                         -- If known
  city TEXT,
  state TEXT,                                 -- 2-letter code
  location_detail TEXT,                       -- "Outside Home Depot on Main St"
  is_sanctuary_city BOOLEAN DEFAULT false,

  -- Who
  victim_name TEXT,                           -- If public/known
  victim_age INT,
  victim_is_citizen BOOLEAN,
  victim_count INT DEFAULT 1,                 -- For group incidents
  agent_name TEXT,                            -- If known (agent_arrested cases)

  -- Status
  outcome ice_incident_outcome DEFAULT 'ongoing',
  outcome_date DATE,
  outcome_notes TEXT,
  verification_status ice_verification_status DEFAULT 'reported',

  -- Context
  spicy_summary TEXT,                         -- Editorial voice version
  why_it_matters TEXT,                        -- Broader implications
  related_story_ids BIGINT[],                 -- Links to main stories table

  -- Display
  is_public BOOLEAN DEFAULT false,            -- Show on frontend
  is_featured BOOLEAN DEFAULT false,          -- Highlight on dashboard

  -- Metadata
  created_by TEXT DEFAULT 'manual',           -- 'manual', 'rss_import'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(headline, '') || ' ' ||
      COALESCE(summary, '') || ' ' ||
      COALESCE(victim_name, '') || ' ' ||
      COALESCE(city, '') || ' ' ||
      COALESCE(state, '')
    )
  ) STORED
);

-- Indexes
CREATE INDEX idx_ice_incidents_date ON ice_incidents(incident_date DESC);
CREATE INDEX idx_ice_incidents_type ON ice_incidents(incident_type);
CREATE INDEX idx_ice_incidents_state ON ice_incidents(state);
CREATE INDEX idx_ice_incidents_outcome ON ice_incidents(outcome);
CREATE INDEX idx_ice_incidents_public ON ice_incidents(is_public) WHERE is_public = true;
CREATE INDEX idx_ice_incidents_search ON ice_incidents USING GIN(search_vector);
```

### Table: `ice_evidence`
Links and embeds for incidents.

```sql
CREATE TYPE ice_evidence_type AS ENUM (
  'video_youtube',        -- YouTube embed
  'video_tiktok',         -- TikTok embed
  'video_other',          -- Other video link
  'news_article',         -- News source
  'court_document',       -- Legal filing
  'government_report',    -- Congressional, ACLU, etc.
  'social_media',         -- Twitter, etc. (link only)
  'photo'                 -- Image link
);

CREATE TABLE ice_evidence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES ice_incidents(id) ON DELETE CASCADE,

  evidence_type ice_evidence_type NOT NULL,
  url TEXT NOT NULL,
  embed_html TEXT,                            -- For YouTube/TikTok (cached)
  title TEXT,
  source_name TEXT,                           -- "ProPublica", "ACLU", etc.
  captured_date DATE,                         -- When evidence was captured/published

  -- For videos
  thumbnail_url TEXT,
  duration_seconds INT,

  -- Status
  is_primary BOOLEAN DEFAULT false,           -- Main evidence for incident
  is_removed BOOLEAN DEFAULT false,           -- Platform took it down
  removed_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ice_evidence_incident ON ice_evidence(incident_id);
CREATE INDEX idx_ice_evidence_type ON ice_evidence(evidence_type);
```

### Table: `rapid_response_networks`
Action directory by state.

```sql
CREATE TABLE rapid_response_networks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  state TEXT NOT NULL,                        -- 2-letter code
  region TEXT,                                -- "Los Angeles", "Bay Area", etc.
  organization_name TEXT NOT NULL,

  -- Contact
  hotline_phone TEXT,
  hotline_hours TEXT,                         -- "24/7" or "9am-5pm M-F"
  website_url TEXT,
  email TEXT,

  -- Services
  provides_legal_aid BOOLEAN DEFAULT false,
  provides_rapid_response BOOLEAN DEFAULT false,
  provides_know_your_rights BOOLEAN DEFAULT false,
  languages TEXT[],                           -- ['en', 'es', 'zh', ...]

  is_active BOOLEAN DEFAULT true,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rrn_state ON rapid_response_networks(state);
CREATE INDEX idx_rrn_active ON rapid_response_networks(is_active) WHERE is_active = true;
```

### Table: `ice_feed_queue`
RSS items pending review.

```sql
CREATE TABLE ice_feed_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Source
  feed_source TEXT NOT NULL,                  -- 'aclu', 'house_oversight', 'trac', etc.
  original_url TEXT NOT NULL UNIQUE,

  -- Content
  title TEXT NOT NULL,
  summary TEXT,
  published_at TIMESTAMPTZ,

  -- Review status
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'promoted', 'dismissed')),
  reviewed_at TIMESTAMPTZ,
  promoted_incident_id BIGINT REFERENCES ice_incidents(id),
  dismiss_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ice_feed_pending ON ice_feed_queue(review_status) WHERE review_status = 'pending';
CREATE INDEX idx_ice_feed_source ON ice_feed_queue(feed_source);
```

---

## 3. Edge Functions

### `ice-stats`
Returns aggregated statistics for dashboard charts.

```typescript
// GET /ice-stats
// Optional params: ?period=fiscal_year&admin=trump_2

interface IceStatsResponse {
  deportations_by_year: {
    fiscal_year: number;
    administration: string;
    total: number;
    interior: number;
    border: number;
  }[];

  criminal_breakdown: {
    period: string;
    no_conviction_pct: number;
    nonviolent_pct: number;
    violent_pct: number;
    source: string;
  };

  deaths_by_year: {
    year: number;
    deaths: number;
  }[];

  citizens_affected: {
    total_detained: number;
    total_deported: number;
    source: string;
  };

  current_detention_population: number;
  last_updated: string;
}
```

### `ice-incidents`
Returns paginated incident list with filters.

```typescript
// GET /ice-incidents
// Params: ?type=death_detention&state=CA&page=1&limit=20

interface IceIncidentsResponse {
  incidents: {
    id: number;
    headline: string;
    summary: string;
    incident_type: string;
    incident_date: string;
    city: string;
    state: string;
    outcome: string;
    verification_status: string;
    victim_is_citizen: boolean;
    evidence_count: number;
    has_video: boolean;
  }[];

  pagination: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };

  filters_applied: {
    type: string | null;
    state: string | null;
    outcome: string | null;
  };
}
```

### `ice-incident`
Returns single incident with full details and evidence.

```typescript
// GET /ice-incident?id=123

interface IceIncidentDetailResponse {
  incident: {
    id: number;
    headline: string;
    summary: string;
    spicy_summary: string;
    why_it_matters: string;
    incident_type: string;
    incident_date: string;
    city: string;
    state: string;
    location_detail: string;
    victim_name: string;
    victim_is_citizen: boolean;
    outcome: string;
    outcome_notes: string;
    verification_status: string;
  };

  evidence: {
    id: number;
    evidence_type: string;
    url: string;
    embed_html: string;
    title: string;
    source_name: string;
    is_primary: boolean;
    is_removed: boolean;
  }[];

  related_stories: {
    id: number;
    headline: string;
    published_at: string;
  }[];
}
```

### `rapid-response`
Returns rapid response networks by state.

```typescript
// GET /rapid-response?state=CA

interface RapidResponseResponse {
  state: string;
  networks: {
    organization_name: string;
    region: string;
    hotline_phone: string;
    hotline_hours: string;
    website_url: string;
    provides_legal_aid: boolean;
    provides_rapid_response: boolean;
    languages: string[];
  }[];

  know_your_rights_url: string;  // ILRC link
  ice_locator_url: string;       // ICE detainee locator
}
```

---

## 4. Frontend Implementation

### File Structure

```
public/
├── ice-tracker.html        # OR add tab to index.html
├── js/
│   └── ice-tracker.js      # ICE tracker logic
└── css/
    └── ice-tracker.css     # Styles (or add to main.css)
```

### Chart Library
Use **Chart.js** (already lightweight, no additional dependencies needed).

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

### Key Components

1. **Stats Dashboard**
   - Criminal breakdown pie chart
   - Deportations by year bar chart
   - Deaths in detention bar chart
   - Key stat cards (detention pop, citizens detained)

2. **Incident Timeline**
   - Filterable list (type, state, outcome)
   - Cards with headline, date, location, outcome badge
   - Click to expand for details + evidence

3. **Action Panel**
   - State dropdown → rapid response info
   - Know Your Rights links
   - Legal defense fund links

### YouTube Embed Handling

```javascript
// Generate YouTube embed from URL
function getYouTubeEmbed(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  return `<iframe
    width="100%"
    height="315"
    src="https://www.youtube.com/embed/${videoId}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen>
  </iframe>`;
}

function extractYouTubeId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}
```

---

## 5. Data Import Scripts

### Bulk Stats Import
One-time and periodic import from Deportation Data Project / TRAC.

```javascript
// scripts/ice/import-stats.js

// Run: node scripts/ice/import-stats.js --source=trac --file=data.csv

// Expected CSV format:
// fiscal_year,period_type,administration,total_deportations,pct_no_conviction,...
```

### RSS Filter for ICE Content

```javascript
// scripts/ice/filter-ice-feeds.js

const ICE_KEYWORDS = [
  'ice raid', 'ice arrest', 'deportation', 'immigration enforcement',
  'dhs', 'detention center', 'immigration detention', 'cbp',
  'sanctuary city', 'deportation flight', 'ice agent'
];

// Runs on RSS items, promotes matches to ice_feed_queue
```

### Backfill Script
Seed database from Wikipedia / ProPublica sources.

```javascript
// scripts/ice/backfill-incidents.js

// Manual process:
// 1. Extract incidents from Wikipedia page
// 2. Structure into JSON
// 3. Import to ice_incidents table
```

---

## 6. Admin Interface

### MVP: Supabase Dashboard
For Phase 1-2, use Supabase Table Editor directly.

### Future: Admin Form
Simple form for incident entry:

```
┌─────────────────────────────────────────────────────────────────┐
│  ADD ICE INCIDENT                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Headline: [___________________________________]                 │
│                                                                  │
│  Summary:                                                        │
│  [                                                    ]          │
│  [                                                    ]          │
│                                                                  │
│  Type: [Death in Detention ▼]                                   │
│                                                                  │
│  Date: [01/24/2026]    State: [CA ▼]    City: [________]        │
│                                                                  │
│  Victim Name: [_______________]  Is US Citizen? [x]             │
│                                                                  │
│  Outcome: [Ongoing ▼]                                           │
│                                                                  │
│  Evidence URLs:                                                  │
│  [https://youtube.com/...                        ] [+ Add More] │
│                                                                  │
│  Source URLs:                                                    │
│  [https://propublica.org/...                     ] [+ Add More] │
│                                                                  │
│  Verification: [Verified ▼]                                     │
│                                                                  │
│  [ ] Publish immediately                                         │
│                                                                  │
│                                          [Cancel] [Save]        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Phases

### Phase 1: Stats Dashboard (1-2 sessions)
- [ ] Create `ice_stats` table + migration
- [ ] Manual import of historical deportation data
- [ ] Create `ice-stats` edge function
- [ ] Frontend dashboard with Chart.js
- [ ] Add ICE Tracker tab to navigation

### Phase 2: Incident Database (2-3 sessions)
- [ ] Create `ice_incidents` + `ice_evidence` tables
- [ ] Create `ice-incidents` and `ice-incident` edge functions
- [ ] Frontend incident list with filters
- [ ] Incident detail modal with evidence display
- [ ] YouTube embed handling
- [ ] Backfill major 2025 incidents

### Phase 3: Automated Feed (2 sessions)
- [ ] Create `ice_feed_queue` table
- [ ] Add ACLU, House Oversight RSS sources
- [ ] Create ICE keyword filter script
- [ ] Review queue in admin (or Supabase dashboard)
- [ ] Promote-to-incident workflow

### Phase 4: Action Integration (1 session)
- [ ] Create `rapid_response_networks` table
- [ ] Populate with state hotlines
- [ ] Create `rapid-response` edge function
- [ ] Action section in frontend
- [ ] Know Your Rights resource links

---

## 8. Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| Database | $0 | Within Supabase free tier |
| Edge functions | $0 | Within free tier |
| Chart.js | $0 | Open source |
| Data import | $0 | Manual + free public data |
| AI enrichment | ~$0.003/incident | Optional spicy summaries |
| **Total** | **~$0-1/month** | Negligible |

---

## 9. Security Considerations

1. **No PII storage** - Don't store victim contact info, addresses
2. **Evidence links only** - Don't host potentially controversial content
3. **Verification badges** - Clearly distinguish verified vs reported
4. **Source attribution** - Always link to original source
5. **No agent doxxing** - Don't create searchable agent database (legal risk)

---

## 10. Future Enhancements

- **Geographic heat map** - Incidents by state/city
- **Timeline visualization** - Incidents over time
- **Comparison tool** - Side-by-side administration stats
- **Export functionality** - CSV download for researchers
- **API access** - Public API for other tools to use data
- **TRAC partnership** - Direct data feed instead of manual import

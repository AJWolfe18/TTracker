# SCOTUS Tracking - Implementation Plan (v1)

**Created:** 2025-12-30
**Status:** Draft - Awaiting Review
**Related Tickets:** TTRC-14, TTRC-17, TTRC-72

---

## Critical Design Decisions (from review)

### 1. Identity: Use CourtListener IDs, NOT docket numbers

**Problem:** `docket_number UNIQUE` is unsafe because:
- Consolidated cases have multiple docket numbers
- Formatting varies (23-939 vs No. 23-939)
- CourtListener's stable identifiers are internal IDs

**Solution:**
```sql
courtlistener_cluster_id BIGINT UNIQUE NOT NULL  -- canonical key
courtlistener_docket_id BIGINT NULL
docket_numbers TEXT[]  -- array, not single string
slug TEXT  -- derived for URLs
```

### 2. Taxonomy: Use Existing Category System

**Problem:** SCOTUS-specific enum drifts from global 7-category system.

**Solution:**
- `category TEXT` = existing 7 categories (justice_legal, democracy_elections, etc.)
- `scotus_issue_tags TEXT[]` = fine-grained SCOTUS labels (executive_power, voting_rights, etc.)

This ensures SCOTUS items appear in cross-navigation (Justice & Legal filter includes SCOTUS cases).

### 3. Severity: Separate Impact from Vote Split

**Problem:** Mapping 5-4 → "critical" is clickbait, not accuracy. A 9-0 ruling can be devastating.

**Solution:**
```sql
impact_severity TEXT  -- critical/severe/moderate/minor (existing system)
vote_fracture SMALLINT  -- margin (1, 2, 3, 4)
vote_split TEXT  -- "5-4", "6-3", "9-0" for display
```

Use `vote_fracture` as a **stability/durability signal** (likelihood of future reversal), NOT severity.

### 4. Pipeline: Reuse Existing Job Queue

**Problem:** Separate scripts + cost tables + dead-letter logic = 3 systems that "mostly work."

**Solution:** Add job types to existing queue:
```javascript
// In job-queue-worker.js
case 'scotus.fetch':
  // Incremental fetch from CourtListener
  break;
case 'scotus.enrich':
  // AI enrichment with evidence anchoring
  break;
```

Reuse existing:
- `job_queue` table
- `budgets` table for cost tracking
- Retry/dead-letter primitives

### 5. CourtListener API: Assume Auth + Throttling

**Requirements:**
- Token auth on ALL requests
- Exponential backoff on 429
- Incremental fetch (`since_last_seen` cursor)
- Cache responses by `cluster_id`

```javascript
// Fetch pattern
const lastSeen = await getLastSeenClusterId();
const cases = await courtListenerFetch('/clusters/', {
  token: process.env.COURTLISTENER_TOKEN,
  params: { modified__gt: lastSeen, order_by: 'date_modified' }
});
```

### 6. Enrichment Guardrails: Evidence-Based Outputs

**Problem:** LLM editorializing without evidence = credibility disaster.

**Requirements:**
```javascript
// Enrichment output schema
{
  summary: "...",
  why_it_matters: "...",
  dissent_highlights: "...",

  // Guardrails
  evidence_anchors: ["syllabus p.3", "majority opinion §II.A"],
  confidence: 0.85,
  needs_human_review: false,
  abstained_sections: ["media_spin"]  // couldn't generate reliably
}
```

**Prompt constraints:**
- Quote/anchor claims to syllabus + opinion text
- Output confidence score
- Allow "Not enough information to support this claim"
- Gate "Media Spin vs Reality" behind beta toggle

---

## Schema Design

```sql
CREATE TABLE scotus_cases (
  -- Identity
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  courtlistener_cluster_id BIGINT UNIQUE NOT NULL,
  courtlistener_docket_id BIGINT,
  docket_numbers TEXT[] NOT NULL DEFAULT '{}',
  slug TEXT UNIQUE,

  -- Case info
  case_name TEXT NOT NULL,
  case_name_short TEXT,
  term TEXT,  -- "OT2024", "OT2025"
  argued_at DATE,
  decided_at DATE,  -- NULL until decided

  -- Vote details
  vote_split TEXT,  -- "5-4", "6-3", "9-0"
  vote_fracture SMALLINT,  -- margin (1, 2, 3, 4)
  majority_author TEXT,
  dissent_authors TEXT[],
  justice_votes JSONB,  -- optional detailed breakdown

  -- Classification
  category TEXT REFERENCES category_enum,  -- global 7-category system
  scotus_issue_tags TEXT[] DEFAULT '{}',
  impact_severity TEXT,  -- critical/severe/moderate/minor

  -- Content
  syllabus TEXT,
  holding_summary TEXT,

  -- AI enrichment
  summary_neutral TEXT,
  summary_spicy TEXT,
  why_it_matters TEXT,
  dissent_highlights TEXT,
  media_spin_analysis TEXT,  -- beta only

  -- Enrichment metadata
  enriched_at TIMESTAMPTZ,
  prompt_version TEXT,
  confidence REAL,
  needs_review BOOLEAN DEFAULT false,

  -- Sources
  source_urls JSONB,  -- { courtlistener, scotus_slip, oyez, ... }

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_scotus_term ON scotus_cases(term);
CREATE INDEX idx_scotus_decided ON scotus_cases(decided_at DESC);
CREATE INDEX idx_scotus_category ON scotus_cases(category);
CREATE INDEX idx_scotus_severity ON scotus_cases(impact_severity);
```

---

## MVP Phasing

### Phase 1: Decisions/Opinions (MVP)
- Ingest decided cases from CourtListener
- Generate: plain-English summary + why it matters + dissent highlights
- **Gate "Media Spin vs Reality" behind beta toggle** until 30-50 outputs QA'd
- Display in UI with existing theme patterns

### Phase 2: Shadow Docket
- Harder: time-sensitive, less structured
- Emergency applications, stays, etc.
- Requires different ingestion cadence

### Phase 3: Calendar/Previews
- Upcoming oral arguments
- Case tracking before decision
- Nice engagement feature, lowest urgency

---

## Integration Points

### With Existing Systems

| System | Integration |
|--------|-------------|
| `job_queue` | Add `scotus.fetch`, `scotus.enrich` job types |
| `budgets` | Track CourtListener API calls + OpenAI enrichment costs |
| `category` enum | Use existing 7-category system |
| `severity` enum | Use existing critical/severe/moderate/minor |
| Theme Preview UI | Add SCOTUS tab (already stubbed as "Coming Soon") |

### UI Display

Reuse patterns from `docs/guides/ui-patterns.md`:
- Card component with severity badge
- Detail modal with scroll lock
- Deep-linking via `?case=<slug>` or `?scotus=<id>`
- Filter by category, severity, term

---

## Cost Estimates

| Operation | Cost | Notes |
|-----------|------|-------|
| CourtListener fetch | Free (with token) | Rate limited, cache aggressively |
| Case enrichment | ~$0.01/case | GPT-4o-mini, ~2K tokens in/out |
| Ongoing (50 cases/term) | ~$0.50/term | Negligible vs current $20/mo |

---

## Open Questions

1. **CourtListener token:** Do we have one? Need to apply?
2. **Beta toggle implementation:** Feature flag in DB or localStorage?
3. **Review workflow:** Who QAs enrichment outputs before going live?
4. **Historical backfill:** How far back? OT2024? OT2020?

---

## References

- CourtListener API: https://www.courtlistener.com/api/
- SCOTUS slip opinions: https://www.supremecourt.gov/opinions/slipopinion/
- Oyez: https://www.oyez.org/
- Existing category system: `docs/guides/ui-patterns.md`

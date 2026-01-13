# Plan: Pardons Tracker Epic Breakdown (ADO-109)

**Status:** IN PROGRESS - MVP Complete, AI Enrichment Code Complete
**Created:** 2026-01-11
**Updated:** 2026-01-13 (Session 9 - ADO-253 code complete, migration pending)
**PRD:** `docs/features/pardons-tracker/prd.md`

## Overview

Break down Epic 109 (Trump Pardons Tracker) into Features and User Stories following the PRD phases.

## PRD Summary

The Pardons Tracker is a dedicated section tracking presidential pardons with:
- Person-centric cards (photo, name, crime, connection type)
- **Group/mass pardon support** (Jan 6 ~1,500 people as single entry)
- Corruption Level meter (1-5 "spicy" scale)
- "The Receipts" timeline showing donation→conviction→pardon chain
- "What Happened Next" post-pardon tracking
- Filtering by connection type, crime category, corruption level

**PRD Location:** `docs/features/pardons-tracker/prd.md`

---

## ADO Structure (Current)

```
Epic 109: Trump Pardons Tracker
├── Feature: Pardons Tracker MVP (ADO-239) ✅ COMPLETE
│   ├── Story 1.1: Database Schema & Migrations (ADO-241) ✅ Ready for Prod
│   ├── Story 1.2: Backend Edge Functions (ADO-242) ✅ Ready for Prod
│   ├── Story 1.3A: Frontend List + Cards + Basic Modal (ADO-251) ✅ Closed
│   ├── Story 1.3B: Receipts Timeline + What Happened Next (ADO-244) 🧪 Testing
│   ├── Story 1.4: Filtering & Search (ADO-245) 🧪 Testing
│   └── Story 1.5: DOJ Scraper - Pardon Ingestion (ADO-250) ✅ Ready for Prod
│
├── Feature: Pardons AI Enrichment (ADO-240) ← ACTIVE
│   ├── Story 2.0: Perplexity Research Integration (ADO-253) 🔨 CODE COMPLETE
│   │   └── Migration pending, then test + backfill 92 pardons
│   ├── Story 2.1: GPT Tone Generation (ADO-246) ← NEXT (depends on 253)
│   │   └── summary_spicy, why_it_matters, pattern_analysis
│   ├── Story 2.2: Display Enrichment (ADO-247)
│   │   └── Show AI content in modal
│   └── Story 2.3: Related Stories Linking (ADO-248)
│       └── Link pardons to news stories
│
├── Feature: Social Sharing for Pardon Cards (ADO-236)
│   └── Story 3.1: Social Sharing + OG Meta Endpoint
│
└── Feature: Admin Dashboard - Pardons (future)
    └── (Stories TBD when prioritized)
```

### ADO-250 Scope Refinement (Session 8)

**Original scope:** DOJ Scraper + AI Enrichment (too large)
**New scope:** DOJ Scraper only (AI enrichment → Feature 2)

**ADO-250 Acceptance Criteria (Refined):**
- [x] DOJ registry scraper extracts: name, date, offense, district
- [x] Idempotent: doesn't duplicate existing pardons (uses source_system + source_key)
- [x] Sets is_public = false until enrichment complete
- [x] Manual trigger script: npm run ingest:pardons
- [ ] ~~AI prompt researches~~ → Moved to Feature 2

**Deferred to Feature 2 (AI Enrichment):**
- Perplexity API for connection research
- GPT for spicy tone generation
- Connection type, corruption level inference
- receipts_timeline population

---

## Feature 1: Pardons Tracker MVP

**Description:** Core implementation of the Pardons Tracker - database, APIs, and frontend UI with basic filtering.

### Stories Under This Feature:

#### Story 1.1: Database Schema & Migrations
**Description:** Create the `pardons` table with all required fields, indexes, RLS policies, and RPC functions.

**Acceptance Criteria:**
- [ ] `pardons` table created per PRD Section 9 schema
- [ ] **Group/mass pardon support:**
  - `recipient_type TEXT CHECK (recipient_type IN ('person', 'group'))` - default 'person'
  - `recipient_count INT` - required when type = 'group' (e.g., ~1500 for Jan 6)
  - `recipient_criteria TEXT` - cohort definition for groups (e.g., "Jan 6 defendants convicted of non-violent offenses")
- [ ] `recipient_slug` auto-generated via trigger from `recipient_name`
- [ ] `pardon_story` junction table (replaces `related_story_ids` array)
  - Index on `story_id` for reverse lookups (finding pardons linked to a story)
- [ ] **Indexes (must be query-friendly):**
  - TSVECTOR GIN index on `search_vector` for full-text `q` param
  - btree on `pardon_date` (sort/filter)
  - btree on `primary_connection_type` (filter)
  - btree on `crime_category` (filter)
  - btree on `corruption_level` (filter)
  - btree on `recipient_type` (filter people vs groups)
  - btree on `research_status` (filter)
- [ ] JSONB field for `receipts_timeline` events
- [ ] **RLS enabled and configured:**
  - RLS enabled on `pardons` table
  - RLS enabled on `pardon_story` junction table
  - Read-only SELECT policy for `anon` role
  - NO write policies for `anon` role (admin-only writes)
- [ ] Migration tested on TEST environment
- [ ] Seed 3-5 sample pardons (include 1 group pardon) for development

**Technical Notes:**
- Use TIMESTAMPTZ for all dates
- Use CHECK constraints for enums (clemency_type, status, recipient_type, etc.)
- Follow Migration 001 pattern for structure
- `search_vector` maintained via generated column (match stories pattern)
- `recipient_name` is NOT NULL (required even for groups, e.g., "Jan 6 Defendants") to ensure slug generation works
- Add index on `pardon_story.story_id` for reverse lookups (PK only covers `pardon_id` leading column)

---

#### Story 1.2: Backend Edge Functions (APIs)
**Description:** Create Edge Functions for fetching pardons data.

**Acceptance Criteria:**
- [ ] `pardons-active` Edge Function:
  - List pardons with cursor-based pagination on `(pardon_date, id)`
  - Full-text search via `q` param using TSVECTOR index
  - Filter params: `connection_type`, `crime_category`, `corruption_level`, `recipient_type`, `research_status`, `post_pardon_status`
  - Default sort: `pardon_date DESC`
  - Returns: `{ items, next_cursor, has_more }`
- [ ] `pardons-detail` Edge Function:
  - Get single pardon by ID with full data
  - Join to `pardon_story` → `stories` for related coverage
  - 404 handling for not found
- [ ] `pardons-stats` Edge Function (optional but recommended):
  - Returns aggregates for stats bar: total count, donation sum, reoffended count
  - **Aggregation logic:**
    - `total_pardons` = COUNT(*)
    - `total_donations` = SUM of `amount_usd` from `receipts_timeline` WHERE `event_type = 'donation'`
    - `reoffended_count` = COUNT(*) WHERE `post_pardon_status = 're_offended'`
  - Cache-friendly (stats don't change often)
- [ ] All functions deployed to TEST Supabase
- [ ] CORS headers configured properly

**Technical Notes:**
- Follow `stories-active/index.ts` pattern exactly
- Use cursor-based pagination (NOT offset)
- Keep query logic in stable SQL builder (index-friendly)
- Select only needed fields
- **Field mapping:** API param `connection_type` maps to DB column `primary_connection_type`

---

#### Story 1.3A: Frontend List + Cards + Basic Modal
**Description:** Create the Pardons tab UI with list view, cards, and basic detail modal.

**Acceptance Criteria:**
- [ ] New `pardons.html` page following `executive-orders.html` pattern
- [ ] New `pardons-app.js` with React components
- [ ] **PardonCard component:**
  - Connection type badge (color-coded)
  - Crime category badge
  - Corruption level meter (visual 1-5)
  - Recipient name and nickname
  - Spicy summary snippet
  - **Group card variant:** Renders "Applies to ~N people" + criteria text
- [ ] **Basic Detail Modal (3 sections only):**
  - The Pardon (date, clemency type, status)
  - The Crime (description, original sentence)
  - The Connection (trump_connection_detail)
- [ ] Stats bar at top: "X Pardons Tracked | $Y in Donor Connections | Z Re-offended"
- [ ] Responsive layout (mobile 1-col, tablet 2-col, desktop 3-col)
- [ ] Empty/loading/error states
- [ ] Navigation updated in `app.js`, `eo-app.js`, `pardons-app.js` TABS arrays
- [ ] **Optional filter toggle:** People / Groups / All (if time permits)

**Technical Notes:**
- Copy structure from `eo-app.js`
- Reuse shared.js utilities
- URL pattern: `pardons.html?id=42` for deep links (ID-based lookup)
- Tab position: 4th after Stories | EOs | SCOTUS

---

#### Story 1.3B: Receipts Timeline + What Happened Next
**Description:** Add advanced modal sections for timeline and post-pardon tracking.

**Acceptance Criteria:**
- [ ] **ReceiptsTimeline component:**
  - Visual timeline rendering `receipts_timeline` JSONB
  - Event types: donation, conviction, pardon_request, pardon_granted, mar_a_lago_visit, sentencing, investigation, legal_filing, other
  - Date + event type badge + description
  - Optional source link
  - Donation events show amount
- [ ] **"What Happened Next" section:**
  - Display `post_pardon_status` (quiet, under_investigation, re_offended)
  - Display `post_pardon_notes` text
  - Visual badge for status
- [ ] **"The Real Story" section:**
  - Display `summary_spicy` (AI-generated, may be null pre-enrichment)
  - Placeholder if not yet enriched

**Technical Notes:**
- Timeline component should be reusable (may use for other features)
- Handle null/empty `receipts_timeline` gracefully

---

#### Story 1.4: Filtering & Search
**Description:** Add filtering and search UI to Pardons tab.

**Acceptance Criteria:**
- [ ] Search input for full-text search (uses `q` param → TSVECTOR)
- [ ] Filter by corruption level (1-5 pills, clickable)
- [ ] Filter by connection type (dropdown)
- [ ] Filter by crime category (dropdown)
- [ ] Filter by post-pardon status (dropdown)
- [ ] Filter by recipient type (People / Groups / All toggle)
- [ ] Sort options: Date (newest), Corruption (highest), Name (A-Z)
- [ ] Pagination (20 per page, reuse existing Pagination component)
- [ ] URL params for deep linking (`pardons.html?connection_type=major_donor&corruption_level=5`)
- [ ] "Clear Filters" button
- [ ] Filter state persists in URL (shareable)

**Technical Notes:**
- All filtering happens via `pardons-active` Edge Function (no separate search endpoint)
- Use `pushUrlParam` / `getUrlParam` from shared.js

---

## Feature 2: Pardons AI Enrichment (ADO-240)

**Description:** Two-phase AI enrichment: Perplexity for research/facts, GPT for editorial tone.
**Status:** Active - Starting ADO-253

### Architecture: Two-Phase Pipeline

```
Perplexity (ADO-253)          GPT (ADO-246)
─────────────────────         ──────────────────
Research FACTS         →      Apply TONE          →      Display (ADO-247)
• Trump connection            • summary_spicy            • Show in modal
• Corruption level            • why_it_matters           • Loading states
• Receipts timeline           • pattern_analysis
• Sources/citations           • Sets is_public=true
```

### Stories Under This Feature:

#### Story 2.0: Perplexity Research Integration (ADO-253) 🔨 CODE COMPLETE
**Description:** Set up Perplexity API to research pardon recipients and populate factual data.
**Status:** Code complete - Migration pending application, then test + backfill

**Acceptance Criteria:**
- [x] Perplexity API client with PERPLEXITY_API_KEY from GitHub Secrets
- [x] Uses Sonar model (~$0.005/pardon)
- [x] Research prompt extracts: connection_type, corruption_level, receipts_timeline
- [x] **GitHub Actions Workflow:**
  - New workflow: `research-pardons.yml`
  - Manual-only (cron doesn't work on non-default branch)
  - Inputs: `--limit`, `--force`
  - Concurrency guard (cancel-in-progress)
- [x] **Production Safeguards:**
  - Idempotent via `research_prompt_version` column on pardons
  - Cost tracking in `pardon_research_costs` table
  - Error tracking with dedupe in `pardon_research_errors` table
  - RLS + REVOKE on telemetry tables (hard deny)
  - Sets `research_status='complete'` on success
- [x] npm script: `npm run research:pardons [--force] [--limit=N] [--dry-run]`
- [ ] **PENDING:** Apply migration 057 to TEST database
- [ ] **PENDING:** Test with 3 pardons (dry-run + live)
- [ ] **PENDING:** Backfill 92 pardons

**Files Created:**
- `migrations/057_pardon_research_tables.sql`
- `scripts/enrichment/perplexity-research.js`
- `.github/workflows/research-pardons.yml`

**Technical Notes:**
- Cost: ~$0.005/pardon (92 pardons = ~$0.46)
- Output feeds into ADO-246 (GPT tone)
- See PRD Section 10 for prompt template
- Expert review applied: table-specific constraints, sequence REVOKE, selective index

---

#### Story 2.1: GPT Tone Generation (ADO-246)
**Description:** Generate editorial content using GPT based on Perplexity research data.

**Acceptance Criteria:**
- [ ] Takes research data from Perplexity (ADO-253)
- [ ] Generates: `summary_neutral`, `summary_spicy`, `why_it_matters`, `pattern_analysis`
- [ ] **Production Safeguards:**
  - Idempotent enqueue via payload_hash
  - Cooldown: skip if `enriched_at > NOW() - 12 hours`
  - Budget enforcement ($5/day cap)
  - JSON schema validation
- [ ] Sets `is_public=true` after successful enrichment
- [ ] npm script: `npm run enrich:pardons [--force]`

**Technical Notes:**
- Cost: ~$0.003/pardon (GPT-4o-mini)
- **Depends on ADO-253** - needs research data first
- Follow existing story enrichment pattern

---

#### Story 2.2: Display Enrichment (ADO-247)
**Description:** Display AI-generated content in the pardon detail modal.

**Acceptance Criteria:**
- [ ] Display `why_it_matters` in detail modal
- [ ] Display `pattern_analysis` section
- [ ] Visual formatting distinct from basic info
- [ ] Loading/placeholder state if not yet enriched
- [ ] "Enrich Now" button (future admin use)

---

#### Story 2.3: Related Stories Linking (ADO-248)
**Description:** Link pardons to related news stories from RSS feeds.

**Acceptance Criteria:**
- [ ] Query `pardon_story` junction table in `pardons-detail`
- [ ] Display related stories in modal (title, date, source)
- [ ] Click-through to story detail page
- [ ] Analytics tracking for `related_story_click` event
- [ ] Handle pardons with no related stories gracefully

---

## Feature 3: Social Sharing (ADO-236)

**Status:** Already a Feature ✓

**Description:** Allow users to share pardon cards to social media with rich previews.

### Story Under This Feature:

#### Story 3.1: Social Sharing + OG Meta Endpoint
**Description:** Implement sharing buttons and server-side OpenGraph meta tags.

**Acceptance Criteria:**
- [ ] Share button on pardon cards (list view)
- [ ] Share button in detail modal header
- [ ] **Twitter/X sharing:**
  - Pre-filled tweet with spicy summary snippet
  - URL to pardon
- [ ] **Facebook sharing:**
  - Uses OG meta tags for rich preview
- [ ] **Copy Link:**
  - Copies direct URL to clipboard
  - Toast confirmation
- [ ] **Server-side OG Meta Endpoint (required for rich previews):**
  - Edge Function: `pardons-og` (or Netlify Function)
  - Returns HTML shell with OpenGraph meta tags for specific pardon
  - URL pattern: `/pardon/42-rudy-giuliani` (for bots/crawlers)
  - Tags: `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`
- [ ] Analytics track share clicks by platform (`share` event with `method` param)

**Technical Notes:**
- Facebook/Twitter crawlers don't execute JS - they need server-rendered meta tags
- Frontend uses `pardons.html?id=42` for users
- Share URLs use `/pardon/{id}-{slug}` for crawlers
- **Routing setup required:**
  - Add Netlify `_redirects` rule: `/pardon/*  /.netlify/functions/pardons-og/:splat  200`
  - `pardons-og` returns HTML with OG tags + `<meta http-equiv="refresh">` + JS redirect for humans
  - Bots get OG tags, humans land on `pardons.html?id=42`

---

## Feature 4: Admin Dashboard - Pardons (Future)

**Description:** Custom admin interface for pardon data entry.

**Status:** Not MVP - use Supabase dashboard for initial data entry

**Note:** This will be part of a broader Admin Dashboard epic when prioritized.

---

## Implementation Order

**Recommended sequence:**
1. **Story 1.1** (Database) - Foundation ✅ DONE
2. **Story 1.2** (APIs) - Backend ready ✅ DONE
3. **Story 1.3A** (Basic UI) - Ship visible feature ✅ DONE
4. **Story 1.3B** (Timeline) - Enhanced modal 🧪 TESTING
5. **Story 1.4** (Filtering) - Core UX complete ← NEXT
6. **Feature 2** (Enrichment) - AI layer
7. **Feature 3** (Sharing) - Can parallel with Feature 2

---

## ADO Actions Required

1. ~~**Update ADO-236:** Change work item type from User Story to Feature~~ ✅ DONE
2. ~~**Create Feature:** "Pardons Tracker MVP" under Epic 109~~ ✅ DONE (ADO-239)
3. ~~**Create Story 1.1** under MVP Feature~~ ✅ DONE (ADO-241)
4. **Create 4 more Stories** under MVP Feature (1.2, 1.3A, 1.3B, 1.4)
5. **Create Feature:** "Pardons AI Enrichment" under Epic 109
6. **Create 3 Stories** under Enrichment Feature (2.1, 2.2, 2.3)
7. **Create 1 Story** under Social Sharing Feature (3.1)
8. **(Future) Create Feature:** "Admin Dashboard - Pardons" (not now)

### Total Work Items to Create:
- 1 Feature (Enrichment)
- 8 User Stories (4 MVP + 3 Enrichment + 1 Social Sharing)

---

## Verification

After creating ADO items:
- [ ] Epic 109 has 3 Feature children (MVP, Enrichment, Social Sharing)
- [x] MVP Feature has Story 1.1 (ADO-241)
- [ ] MVP Feature has 5 Story children total (1.1, 1.2, 1.3A, 1.3B, 1.4)
- [ ] Enrichment Feature has 3 Story children
- [ ] Social Sharing Feature has 1 Story child
- [ ] All stories have acceptance criteria
- [ ] Stories are tagged appropriately

---

## Files to Modify/Create

**Database:**
- `migrations/056_pardons_table.sql` ✅ CREATED
- `supabase/migrations/20260112000000_pardons_table.sql` ✅ CREATED
- `scripts/seed-pardons-test.sql` ✅ CREATED (test-only)

**Backend:**
- `supabase/functions/pardons-active/index.ts` ✅ CREATED (list + search + filters)
- `supabase/functions/pardons-detail/index.ts` ✅ CREATED (single item + joins)
- `supabase/functions/pardons-stats/index.ts` ✅ CREATED (aggregates for stats bar)
- `supabase/functions/pardons-og/index.ts` (new - OG meta for sharing)
- `scripts/job-queue-worker.js` (add pardon.enrich handler)

**Frontend:**
- `public/pardons.html` (new)
- `public/pardons-app.js` (new)
- `public/app.js` (update TABS array)
- `public/eo-app.js` (update TABS array)

**Enrichment:**
- `scripts/enrichment/pardons-prompts.js` (new)
- `scripts/enrich-pardons.js` (new - manual trigger script)

---

## Technical Decisions (Resolved)

### 1. Database Schema

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `recipient_slug` | Auto-generated via trigger | Matches `url_hash` and `story_hash` patterns; ensures consistency |
| `related_story_ids` | Junction table `pardon_story` | Matches `article_story` pattern; allows metadata like `link_type` |
| `receipts_timeline` JSONB | Typed event array | Schema: `{date, event_type, description, source_url?, amount_usd?}` |
| Mass pardon support | `recipient_type` + `recipient_count` + `recipient_criteria` | Handles Jan 6 (~1500) as single entry |

**Slug generation trigger:**
```sql
CREATE OR REPLACE FUNCTION generate_recipient_slug(name TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN lower(regexp_replace(
    regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**Junction table schema (FIXED - both FKs use CASCADE):**
```sql
CREATE TABLE pardon_story (
  pardon_id BIGINT REFERENCES pardons(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK (link_type IN ('primary_coverage', 'background', 'related', 'mentioned')),
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pardon_id, story_id)
);
```

**Receipts timeline event types:**
`donation | conviction | pardon_request | pardon_granted | mar_a_lago_visit | sentencing | investigation | legal_filing | other`

---

### 2. Edge Functions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Endpoints | `pardons-active` + `pardons-detail` + `pardons-stats` | Small surface area; ~150 records doesn't need separate search |
| Pagination | Cursor-based on `(pardon_date, id)` | Matches existing pattern in `_shared/pagination.ts` |

**`pardons-active` function (combined list + search + filters):**
```
GET /pardons-active?
  q=giuliani                        # full-text search (TSVECTOR)
  connection_type=major_donor       # enum filter
  crime_category=white_collar       # enum filter
  corruption_level=5                # numeric filter
  recipient_type=person             # person | group | (omit for all)
  post_pardon_status=under_investigation
  cursor=xxx
  limit=20
```

---

### 3. Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate file vs tab | `pardons.html` + `pardons-app.js` | Matches EO pattern; code isolation |
| User-facing URL | `pardons.html?id=42` | Simple, consistent with current app |
| Share/OG URL | `/pardon/42-rudy-giuliani` | For bots/crawlers; redirects to frontend |
| Detail view | Modal (like Stories/EOs) | Consistency across features |

**Navigation update required in:**
- `app.js` TABS array
- `eo-app.js` TABS array
- New `pardons-app.js` TABS array

---

### 4. AI Enrichment

| Phase | Approach |
|-------|----------|
| MVP | Manual via `npm run enrich:pardons` script |
| Phase 2 | "Enrich Now" button in admin UI |
| Phase 3 | Auto-trigger on `research_status` → 'complete' |

**Production safeguards (Story 2.1):**
- Idempotent enqueue via `payload_hash` unique
- 12-hour cooldown
- Budget check + refusal
- JSON schema validation

---

### 5. RLS Policies

**Required for public API exposure:**
```sql
-- Enable RLS
ALTER TABLE pardons ENABLE ROW LEVEL SECURITY;
ALTER TABLE pardon_story ENABLE ROW LEVEL SECURITY;

-- Read-only for anonymous users (only public pardons)
CREATE POLICY "pardons_anon_select" ON pardons
  FOR SELECT TO anon USING (is_public = true);

CREATE POLICY "pardon_story_anon_select" ON pardon_story
  FOR SELECT TO anon USING (EXISTS (
    SELECT 1 FROM pardons p WHERE p.id = pardon_id AND p.is_public = true
  ));

-- No INSERT/UPDATE/DELETE policies for anon = admin only writes
```

---

## Schema Fixes from Expert Reviews (ADO-241)

**Applied to:** `migrations/056_pardons_table.sql`
**Documented:** 2026-01-12

### Review 1 (Initial)
| # | Fix | Implementation |
|---|-----|----------------|
| 1 | Idempotent source key | `source_system` + `source_key` + partial unique index |
| 2 | Publish gate | `is_public BOOLEAN DEFAULT false` + RLS `USING (is_public = true)` |
| 3 | Enrichment fields nullable | Removed NOT NULL from `crime_description`, `crime_category`, `primary_connection_type`, `corruption_level` |
| 4 | Slug not unique | Removed UNIQUE from `recipient_slug` (URL uses `{id}-{slug}`) |
| 5 | Group validation CHECK | Added `pardons_group_fields_chk` constraint |
| 6 | Composite pagination index | `(pardon_date DESC, id DESC)` instead of just `pardon_date` |
| 7 | JSONB array checks | Added `pardons_receipts_timeline_is_array`, `pardons_source_urls_is_array` |
| 8 | Money precision | `NUMERIC(14,2)` + non-negative check |

### Review 2 (Blockers)
| # | Fix | Implementation |
|---|-----|----------------|
| 9 | Seed data in separate script | Moved to `scripts/seed-pardons-test.sql`, NOT in migration |
| 10 | DOJ ingestion fields | Added `conviction_district`, `case_number`, `offense_raw` |
| 11 | Enum-like NOT NULL | Added NOT NULL to `recipient_type`, `status`, `research_status`, `post_pardon_status` |
| 12 | Remove authenticated RLS | No authenticated policy (service role can still read) |
| 13 | Group requires criteria | Added `recipient_criteria IS NOT NULL` when `recipient_type = 'group'` |
| 14 | Schema qualification | All tables/indexes use `public.` prefix |
| 15 | Trigger DDL included | Full SQL for slug and updated_at triggers in migration |

### Review 3 (Final fixes)
| # | Fix | Implementation |
|---|-----|----------------|
| 16 | Seed script bug | Include `recipient_type`, `recipient_count` in INSERT, no UPDATE |
| 17 | JSONB NOT NULL | Both `receipts_timeline` and `source_urls` are now `NOT NULL DEFAULT '[]'` |
| 18 | source_system CHECK | `CHECK (source_system IN ('manual', 'doj_opa'))` |
| 19 | Person no criteria | Group constraint also requires `recipient_criteria IS NULL` for person |
| 20 | Trigger function renamed | `public.pardons_set_recipient_slug()` to avoid confusion |
| 21 | SET search_path | Added `SET search_path = public` on trigger function |

### Review 4 (Last practical musts)
| # | Fix | Implementation |
|---|-----|----------------|
| 22 | Slug trigger empty string | Fires on `NULL OR length(trim()) = 0` |
| 23 | needs_review NOT NULL | `BOOLEAN NOT NULL DEFAULT false` |
| 24 | Partial index optimization | Combined `(pardon_date DESC, id DESC) WHERE is_public = true` |
| 25 | Dependency note | Verify `set_updated_at()` exists before apply |

---

## Key Files to Reference During Implementation

| File | Use For |
|------|---------|
| `supabase/functions/stories-active/index.ts` | List pagination pattern |
| `supabase/functions/stories-detail/index.ts` | Detail view with junction joins |
| `supabase/functions/_shared/pagination.ts` | Cursor encoding/decoding |
| `public/eo-app.js` | Feature page with cards/modals/filters |
| `public/executive-orders.html` | Template for pardons.html |
| `scripts/enrichment/enrich-stories-inline.js` | AI enrichment pattern |
| `migrations/001_rss_system_PRODUCTION_READY.sql` | RLS + index patterns |

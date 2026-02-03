# Admin Dashboard - Product Requirements Document

**Document Version:** 1.1
**Created:** 2026-02-01
**Updated:** 2026-02-02
**Status:** Reviewed - Ready for Implementation
**Epic:** TTRC-18 (Admin Dashboard)
**Owner:** Josh

---

## Key Decisions (2026-02-02 Review)

| Item | Decision |
|------|----------|
| Audit retention | 90 days |
| Re-enrichment feedback | Spinner on row, toast on complete |
| Bulk ops limit | 50 items max |
| Concurrency protection | Low priority (just Josh for now) |
| Re-enrich mechanism | Edge function (30-60 sec delay with visual feedback) |
| political_entries | Keep table, handle migration later |
| Content tabs | Home, Stories, Pardons, SCOTUS, EOs, Feeds |
| Tab implementation order | Home → Stories → Pardons → SCOTUS → EOs → Feeds |
| Safety features | Incremental with each tab, push to prod per tab |
| Alerting | Discord + in-dashboard "Needs Attention" on home |
| Test/Prod distinction | Header text: "PROD Admin Dashboard" / "Test Admin Dashboard" |
| UX pattern | Consistent across all tabs, unique fields per content type |

---

## Executive Summary

TrumpyTracker needs a unified admin dashboard to manage all content types, trigger AI re-enrichment, and monitor system health. This document outlines the product requirements, user stories, and implementation phases.

**For technical implementation details, see:** [tech-spec.md](./tech-spec.md)

---

## 1. Current State Analysis

### 1.1 Existing Admin Functionality

| Component | Location | Status | Reusable? |
|-----------|----------|--------|-----------|
| **admin.html** | `/public/admin.html` | Legacy - JSON-based | Partial (UI patterns) |
| **admin-supabase.html** | `/public/admin-supabase.html` | Active - Limited scope | Yes (foundation) |
| **queue-stats API** | Edge function | Active | Yes (data source) |
| **Auth utilities** | `supabase/functions/_shared/auth.ts` | Active | Yes |

### 1.2 What Exists vs What's Missing

**Currently Supported:**
- Executive orders CRUD (basic fields only)
- Manual article submission
- GitHub auth flow
- Search/filter/pagination
- Archive/restore/delete

**NOT Supported (Gaps):**
- Stories management (primary content type!)
- Articles management
- Pardons management
- SCOTUS cases management
- Feed registry management
- Re-enrichment triggers
- System health monitoring
- Budget monitoring
- Enrichment error triage
- Test/Prod environment distinction

**Deprecated (to be removed):**
- Political entries CRUD (legacy table, keep data but remove from admin)

### 1.3 Content Types Summary

| Content Type | Table | Row Count | AI Fields | Editable Fields |
|--------------|-------|-----------|-----------|-----------------|
| Stories | `stories` | ~2,700 | 4 fields | 9 fields |
| Articles | `articles` | ~3,100 | 1 field | 11 fields |
| Pardons | `pardons` | Growing | 4 fields | 25+ fields |
| SCOTUS Cases | `scotus_cases` | ~12 | 4 fields | 15+ fields |
| Executive Orders | `executive_orders` | ~190 | 2 fields | 6 fields |
| Feeds | `feed_registry` | 18 | N/A | 6 fields |

**Note:** `political_entries` table is deprecated. Data preserved but not shown in admin.

---

## 2. Requirements

### 2.1 Content Management Requirements

#### Stories (RSS Aggregates)

**Editable Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `primary_headline` | Text | Main headline |
| `primary_source` | Text | Source name |
| `primary_source_url` | URL | Source link |
| `primary_actor` | Text | Main person/org |
| `status` | Enum | active / closed / archived |
| `severity` | Enum | critical / severe / moderate / minor |
| `category` | Enum | 11 categories |
| `lifecycle_state` | Enum | emerging / developing / mature |
| `confidence_score` | Numeric | Clustering confidence |

**AI Fields (view + re-enrich trigger):**
- `summary_neutral` - Factual summary
- `summary_spicy` - Engaging summary
- `top_entities` - Key entities array
- `entity_counter` - Entity counts (JSONB)

**Re-enrichment:** ~$0.003 per story via edge function (30-60 sec with spinner feedback)

---

#### Articles (Individual RSS Items)

**Editable Fields:**
- `title`, `source_name`, `source_domain`
- `published_at`, `content`, `excerpt`
- `content_type` (news_report / opinion / analysis / editorial)
- `primary_actor`, `categories`, `url`

**AI Fields:** `primary_actor` extraction (re-triggerable)

**Note:** Articles are usually managed via their parent Story. Direct article editing is for corrections only.

---

#### Pardons

**25+ Editable Fields across sections:**
- **Identity:** recipient_name, nickname, photo_url, recipient_type
- **Details:** pardon_date, clemency_type, status, crime_category
- **Connection:** primary_connection_type, corruption_level, trump_connection_detail
- **Post-Pardon:** post_pardon_status, post_pardon_notes
- **Publishing:** is_public (visibility gate), needs_review

**AI Fields:** summary_spicy, why_it_matters, pattern_analysis

**Re-enrichment:** ~$0.005 per pardon via edge function

---

#### SCOTUS Cases

**Editable Fields:**
- **Case Info:** case_name, case_name_short, docket_number, term
- **Dates:** decided_at, argued_at
- **Decision:** vote_split, majority_author, dissent_authors[], citation
- **Classification:** issue_area, petitioner_type, respondent_type
- **Impact:** ruling_impact_level (0-5), ruling_label, who_wins, who_loses
- **Content:** syllabus, opinion_excerpt
- **Links:** source_url, pdf_url
- **Publishing:** is_public (visibility gate)

**AI Fields (view + re-enrich trigger):**
- `summary_spicy` - Engaging summary
- `why_it_matters` - Impact analysis
- `dissent_highlights` - Key dissent points
- `evidence_anchors` - Quote citations

**Re-enrichment:** ~$0.01 per case via edge function

**Publishing Workflow:** Same as Pardons (is_public = false → draft, is_public = true → published)

---

#### Executive Orders

**Editable Fields:**
- `order_number`, `date`, `title`, `source_url`
- `category` (10 EO categories), `severity_rating`

**AI Fields:**
- `summary` - Factual summary
- `spicy_summary` - Engaging summary

**Re-enrichment:** ~$0.008 per EO via edge function

**Note:** EO management already partially exists in current admin. This phase enhances with consistent UX pattern.

---

#### Feed Registry

**Editable:** feed_url, feed_name, source_name, topics, tier, is_active

**Admin Actions:**
- Reset failure count (re-enable disabled feeds)
- Toggle active/inactive
- Add new feeds

---

### 2.2 Re-Enrichment Requirements

| Content Type | Cost | Mechanism |
|--------------|------|-----------|
| Story | $0.003 | Edge function (30-60 sec) |
| Article entities | $0.0003 | Edge function |
| Pardon | $0.005 | Edge function |
| SCOTUS Case | $0.01 | Edge function |
| Executive Order | $0.008 | Edge function |

**UI Requirements:**
- Re-enrich button on each item row
- Spinner on row during processing (30-60 sec)
- Toast notification on completion
- Budget check before proceeding
- Bulk re-enrich (max 50 items, typed "CONFIRM" for >20)

---

### 2.3 Monitoring Requirements

#### System Health Dashboard
- Active stories (last 72h)
- Articles today
- Feed health (X/Y active)
- Daily budget used
- Last pipeline run timestamp

#### "Needs Attention" Panel (Home Dashboard)
**Triggers attention banner when:**
- Enrichment failures (any content type)
- Feed failures (≥3 consecutive)
- Budget warning (>80% daily cap)
- Items with `needs_review = true`
- Pipeline hasn't run in >4 hours
- Unpublished pardons or SCOTUS cases

#### Feed Health Panel
- Per-feed status indicators (🟢🟡🔴)
- Failure counts, last fetched time
- Reset failures action

#### Budget Panel
- Current spend vs $5 daily cap
- Category breakdown
- 7-day trend

#### Environment Indicator
- Header displays: "PROD Admin Dashboard" or "Test Admin Dashboard"
- Clear visual distinction between environments

---

## 3. Daily Workflow Support

### Josh's Typical Day
1. **Morning:** Check if anything broke overnight
2. **Review:** Look at new content, flag bad AI output
3. **Fix:** Edit content that needs attention
4. **Publish:** Move pardons from draft to public

### Dashboard Home (First Thing You See)

```
┌─────────────────────────────────────────────────────────┐
│  PROD Admin Dashboard                   [Budget: $2.47/$5]
├─────────────────────────────────────────────────────────┤
│  SYSTEM HEALTH          │  NEEDS ATTENTION              │
│  🟢 RSS Pipeline: OK    │  3 stories need review        │
│  🟢 Feeds: 18/18 active │  2 enrichment failures        │
│  🟢 Budget: 49% used    │  5 pardons unpublished        │
│  Last run: 23 min ago   │  1 SCOTUS case unpublished    │
├─────────────────────────────────────────────────────────┤
│  TODAY'S ACTIVITY                                       │
│  • 12 new articles ingested                             │
│  • 3 stories created, 8 enriched                        │
│  • 0 re-enrichments triggered                           │
├─────────────────────────────────────────────────────────┤
│  QUICK ACTIONS                                          │
│  [Process Article] [Trigger Pipeline] [View All Stats]  │
└─────────────────────────────────────────────────────────┘
```

**Test Environment shows:** "Test Admin Dashboard" in header with distinct styling.

### Review Queue
Dedicated view for "things needing attention":
- Stories with `needs_review = true`
- Stories with low confidence (<50%)
- Any content with enrichment failures
- Pardons with `is_public = false` (unpublished)
- SCOTUS cases with `is_public = false` (unpublished)

**Workflow:** Click item → Edit modal → Save → Auto-removed from queue

### Publishing Workflow (Pardons)

```
Draft → [Edit] → [Preview] → [Publish] → Public
                     ↓
              [Request Review] → Review Queue
```

---

## 4. Implementation Phases

**Approach:** Build incrementally, tab-by-tab. Each phase pushes to PROD when complete. Safety features added incrementally with each phase (not as separate Phase 0).

---

### Phase 1: Home Dashboard
**Scope:**
- Dashboard Home with health status
- "Needs Attention" panel
- Budget indicator in header
- Environment indicator (PROD/Test)
- Quick actions
- Discord alerting for pipeline failures

**Deliverables:**
- Home page with system health
- Needs attention counts with links
- Today's activity summary
- Environment-aware header styling

**Effort:** 1-2 sessions

---

### Phase 2: Stories Tab
**Scope:**
- Stories tab with full CRUD
- Story re-enrichment trigger
- Content history table (undo support for stories)
- Optimistic locking

**Deliverables:**
- Stories list with pagination, search, filter
- Story edit modal (all 9 editable fields)
- Re-enrich button with spinner feedback
- Undo support (toast with 10-sec window)

**Effort:** 2-3 sessions

---

### Phase 3: Pardons Tab
**Scope:**
- Pardons tab with all 25+ fields
- Pardon publishing workflow (draft/published tabs)
- Pardon re-enrichment trigger

**Deliverables:**
- Pardons list with draft/published filter
- Pardon edit modal with section grouping
- is_public toggle with confirmation
- Re-enrich button with spinner feedback

**Effort:** 2-3 sessions

---

### Phase 4: SCOTUS Tab
**Scope:**
- SCOTUS cases tab (same UX pattern as Pardons)
- SCOTUS re-enrichment trigger
- Draft/Published workflow

**Deliverables:**
- SCOTUS list with draft/published filter
- SCOTUS edit modal (15+ fields)
- is_public toggle with confirmation
- Re-enrich button with spinner feedback

**Effort:** 1-2 sessions (reuses Pardons patterns)

---

### Phase 5: Executive Orders Tab
**Scope:**
- Enhance existing EO management
- Consistent UX with other tabs
- EO re-enrichment trigger

**Deliverables:**
- EO list matching other tab patterns
- Enhanced EO edit modal
- Re-enrich button with spinner feedback

**Effort:** 1 session

---

### Phase 6: Feeds Tab
**Scope:**
- Feed registry management
- Feed health status
- Reset failures, toggle active, add feeds

**Deliverables:**
- Feeds list with health indicators
- Feed edit modal
- Add new feed form
- Reset failure count action

**Effort:** 1 session

---

## 5. User Stories (ADO Breakdown)

### Phase 1: Home Dashboard

**Dashboard Home Page**
```
As an admin, I want a home dashboard showing system health and items needing attention
so that I can quickly assess status and prioritize my work.

Acceptance Criteria:
- [ ] Header shows "PROD Admin Dashboard" or "Test Admin Dashboard"
- [ ] System health indicators (pipeline, feeds, budget)
- [ ] "Needs Attention" panel with counts and links
- [ ] Today's activity summary
- [ ] Quick action buttons
- [ ] Auto-refresh every 5 minutes
```

**Discord Alerting for Pipeline Failures**
```
As an admin, I want Discord notifications when pipelines fail
so that I can respond quickly to outages.

Acceptance Criteria:
- [ ] Discord webhook created in TTracker server
- [ ] DISCORD_WEBHOOK_URL added to GitHub secrets
- [ ] rss-tracker-prod.yml sends alert on failure
- [ ] Alert includes workflow name, run URL, and branch
```

---

**Stories List View**
```
As an admin, I want to see all stories in a paginated list
so that I can manage story content.

Acceptance Criteria:
- [ ] Stories tab in admin navigation
- [ ] Paginated table (20 per page, cursor-based)
- [ ] Columns: headline, source, severity, category, status, last_enriched
- [ ] Search by headline
- [ ] Filter by severity, category, status
- [ ] Sort by date, severity
```

**Story Edit Modal**
```
As an admin, I want to edit story fields
so that I can correct or update content.

Acceptance Criteria:
- [ ] Edit button on each story row
- [ ] Modal with all 9 editable fields
- [ ] Form validation
- [ ] Save/Cancel buttons
- [ ] Success/error feedback
```

**Story Re-enrichment**
```
As an admin, I want to trigger AI re-enrichment for a story
so that I can regenerate summaries and metadata.

Acceptance Criteria:
- [ ] Re-enrich button on story row
- [ ] Spinner on row during enrichment (30-60 sec)
- [ ] Budget check before proceeding
- [ ] Toast notification on completion
- [ ] Fields refresh after completion
```

**Content History & Undo**
```
As an admin, I want to undo my last edit
so that I can recover from mistakes.

Acceptance Criteria:
- [ ] All edits log previous value to history table
- [ ] Toast appears after save with "Undo" button (10 sec window)
- [ ] Undo restores previous value
- [ ] History retained for 90 days
```

---

### Phase 3: Pardons Tab

**Pardons Management**
```
As an admin, I want to manage pardon records
so that I can edit all pardon fields.

Acceptance Criteria:
- [ ] Pardons tab in admin navigation
- [ ] Paginated list with draft/published filter
- [ ] All 25+ editable fields in modal
- [ ] Section grouping (Identity, Details, Connection, etc.)
- [ ] is_public toggle with confirmation
- [ ] Re-enrich button with spinner feedback
```

**Pardon Publishing Workflow**
```
As an admin, I want a clear draft/publish workflow for pardons
so that I can control what's visible to the public.

Acceptance Criteria:
- [ ] "Drafts" tab showing is_public=false pardons
- [ ] "Published" tab showing is_public=true pardons
- [ ] Publish button with confirmation
- [ ] Bulk publish selected items (max 50)
```

---

### Phase 4: SCOTUS Tab

**SCOTUS Cases Management**
```
As an admin, I want to manage SCOTUS case records
so that I can edit and publish court decisions.

Acceptance Criteria:
- [ ] SCOTUS tab in admin navigation
- [ ] Paginated list with draft/published filter
- [ ] All 15+ editable fields in modal
- [ ] Section grouping (Case Info, Decision, Impact, etc.)
- [ ] is_public toggle with confirmation
- [ ] Re-enrich button with spinner feedback
```

**SCOTUS Publishing Workflow**
```
As an admin, I want a draft/publish workflow for SCOTUS cases
so that I can control what's visible to the public.

Acceptance Criteria:
- [ ] Same UX pattern as Pardons
- [ ] "Drafts" / "Published" tabs
- [ ] Publish button with confirmation
```

---

### Phase 5: Executive Orders Tab

**Executive Order Management**
```
As an admin, I want to manage executive orders
with consistent UX matching other tabs.

Acceptance Criteria:
- [ ] EO tab matching other tab patterns
- [ ] Paginated list with filters
- [ ] Edit modal for all fields
- [ ] Re-enrich button with spinner feedback
```

---

### Phase 6: Feeds Tab

**Feed Registry Management**
```
As an admin, I want to manage RSS feeds
so that I can control content sources.

Acceptance Criteria:
- [ ] Feeds tab in admin navigation
- [ ] Feed list with health indicators (🟢🟡🔴)
- [ ] Edit modal for feed settings
- [ ] Add new feed form
- [ ] Reset failure count action
- [ ] Toggle active/inactive
```

---

### Future Enhancements

**Global Search**
```
As an admin, I want to search across all content types
so that I can find related content quickly.

Acceptance Criteria:
- [ ] Search box in header (always visible)
- [ ] Searches stories, articles, pardons, SCOTUS, EOs
- [ ] Results grouped by type
- [ ] Click result to open edit modal
```

**Articles Sub-Tab (under Stories)**
```
As an admin, I want to view and edit individual articles
linked to a story.

Acceptance Criteria:
- [ ] Articles viewable from Story detail
- [ ] Edit modal for article fields
- [ ] View linked story
```

---

## 6. Risk Mitigations

| Gap | Risk | Mitigation | Phase |
|-----|------|------------|-------|
| No Undo/Rollback | HIGH | Content history table + undo toast | Phase 2 |
| No Proactive Alerting | HIGH | Discord webhook on workflow failure | Phase 1 |
| Race Condition (Admin vs Pipeline) | MEDIUM | Optimistic locking (check last_updated_at) | Phase 2 |
| No Admin Audit Log | MEDIUM | Action log table | Phase 2 |
| Bulk Ops Budget Risk | MEDIUM | Cap at 50, typed "CONFIRM" for >20 | Phase 2 |
| Test/Prod Confusion | MEDIUM | Clear header text + styling | Phase 1 |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Admin can edit any content type | 100% | All 5 content tabs complete |
| Re-enrichment success rate | >95% | Enrichment failure count |
| System health visible at glance | Yes | Home dashboard complete |
| Issue awareness | <1 min | "Needs Attention" panel works |
| Environment clarity | 100% | Never confuse Test/Prod |
| Budget visibility | Real-time | Header indicator always current |

---

## 8. Dependencies & Blockers

| Dependency | Status | Impact |
|------------|--------|--------|
| ~~TTRC-216 (EO schema)~~ | ✅ Done | No longer blocking |
| EO enrichment | ✅ Done | 190/190 EOs enriched |
| Discord webhook | Not started | Create in Phase 1 |
| Re-enrichment edge function | Not started | Create in Phase 2 |

---

## 9. Resolved Questions

| Question | Decision |
|----------|----------|
| Audit log retention? | 90 days |
| Re-enrichment rate limits? | 10/minute (sufficient for single admin) |
| Bulk operations scope? | 50 items max, typed "CONFIRM" for >20 |
| Multi-admin support? | Just Josh for now, design for extensibility |
| Re-enrichment mechanism? | Edge function, 30-60 sec delay, spinner feedback |
| political_entries table? | Keep for now, migrate later |
| SCOTUS UX pattern? | Same as Pardons (consistent across all tabs) |
| Test/Prod distinction? | Header text: "PROD Admin Dashboard" / "Test Admin Dashboard" |

---

## Appendix

### A. Category Enums

**Story Categories (11):**
corruption_scandals, democracy_elections, policy_legislation, justice_legal, executive_actions, foreign_policy, corporate_financial, civil_liberties, media_disinformation, epstein_associates, other

**EO Categories (10):**
immigration_border, environment_energy, health_care, education, justice_civil_rights_voting, natsec_foreign, economy_jobs_taxes, technology_data_privacy, infra_housing_transport, gov_ops_workforce

**Pardon Connection Types (10):**
mar_a_lago_vip, major_donor, family, political_ally, campaign_staff, business_associate, jan6_defendant, fake_electors, celebrity, no_connection

**SCOTUS Issue Areas:**
justice_legal, voting_rights, immigration, environment, business, civil_liberties, criminal_procedure, first_amendment, federalism, other

### B. Severity Levels

- `critical` - Immediate threat
- `severe` - Serious concern
- `moderate` - Notable but manageable
- `minor` - Routine/low impact

### C. Cost Reference

| Operation | Model | Est. Cost |
|-----------|-------|-----------|
| Story enrichment | gpt-4o-mini | $0.003 |
| Article entity extraction | gpt-4o-mini | $0.0003 |
| Pardon enrichment | gpt-4o-mini | $0.005 |
| SCOTUS enrichment | gpt-4o-mini | $0.01 |
| EO enrichment | gpt-4o-mini | $0.008 |

### D. Content Type Field Counts

| Type | Total Fields | Editable | AI-Generated | System |
|------|-------------|----------|--------------|--------|
| Stories | ~20 | 9 | 4 | 7 |
| Articles | ~15 | 11 | 1 | 3 |
| Pardons | ~30 | 25+ | 4 | 5 |
| SCOTUS | ~25 | 15+ | 4 | 6 |
| EOs | ~10 | 6 | 2 | 2 |
| Feeds | ~10 | 6 | 0 | 4 |

---

**Last Updated:** 2026-02-02

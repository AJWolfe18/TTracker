# Admin Dashboard - Product Requirements Document

**Document Version:** 1.0
**Created:** 2026-02-01
**Status:** Draft for Review
**Epic:** TTRC-18 (Admin Dashboard)
**Owner:** Josh

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
- Political entries CRUD
- Executive orders CRUD (basic fields only)
- Manual article submission
- GitHub auth flow
- Search/filter/pagination
- Archive/restore/delete

**NOT Supported (Gaps):**
- Stories management (primary content type!)
- Articles management
- Pardons management
- Feed registry management
- Re-enrichment triggers
- System health monitoring
- Job queue visibility
- Budget monitoring
- Enrichment error triage

### 1.3 Content Types Summary

| Content Type | Table | Row Count | AI Fields | Editable Fields |
|--------------|-------|-----------|-----------|-----------------|
| Stories | `stories` | ~2,700 | 6 fields | 10 fields |
| Articles | `articles` | ~3,100 | 2 fields | 12 fields |
| Pardons | `pardons` | Growing | 5 fields | 25+ fields |
| Executive Orders | `executive_orders` | ~190 | 8 fields | 6 fields |
| Feeds | `feed_registry` | 18 | N/A | 6 fields |

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
| `topic_tags` | Array | Tags for filtering |
| `has_opinion` | Boolean | Opinion content flag |

**AI Fields (view + re-enrich trigger):**
- `summary_neutral` - Factual summary
- `summary_spicy` - Engaging summary
- `top_entities` - Key entities
- `entity_counter` - Entity counts

**Re-enrichment:** ~$0.003 per story, 12-hour cooldown (admin can override)

---

#### Articles (Individual RSS Items)

**Editable Fields:**
- `headline`, `source_name`, `source_domain`
- `published_at`, `content`, `excerpt`
- `content_type` (news_report / opinion / analysis / editorial)
- `opinion_flag`, `primary_actor`, `categories`, `url`

**AI Fields:** Entity extraction (re-triggerable)

---

#### Pardons

**25+ Editable Fields across sections:**
- **Identity:** recipient_name, nickname, photo_url, recipient_type
- **Details:** pardon_date, clemency_type, status, crime_category
- **Connection:** primary_connection_type, corruption_level, trump_connection_detail
- **Post-Pardon:** post_pardon_status, post_pardon_notes
- **Publishing:** is_public (visibility gate), needs_review

**AI Fields:** summary_spicy, why_it_matters, pattern_analysis

**Re-enrichment:** ~$0.005 per pardon

---

#### Executive Orders

**Editable Fields:**
- order_number, date, title, summary, source_url
- category (10 EO categories), severity_rating

**AI Fields (4-Part Analysis):**
- section_what_they_say, section_what_it_means
- section_reality_check, section_why_it_matters
- Action framework (tier, confidence, reasoning)

**Re-enrichment:** ~$0.015 per EO (TTRC-216 complete, 190 EOs enriched)

---

#### Feed Registry

**Editable:** feed_url, feed_name, source_name, topics, tier, is_active

**Admin Actions:**
- Reset failure count (re-enable disabled feeds)
- Toggle active/inactive
- Add new feeds

---

### 2.2 Re-Enrichment Requirements

| Content Type | Cost | Cooldown |
|--------------|------|----------|
| Story | $0.003 | 12h default (admin can override) |
| Article entities | $0.0003 | None |
| Pardon | $0.005 | None |
| Executive Order | $0.015 | None |

**UI Requirements:**
- Re-enrich button on each item
- Confirmation modal with cost estimate
- Budget check before proceeding
- Bulk re-enrich (max 50 items, typed confirmation for >20)

---

### 2.3 Monitoring Requirements

#### System Health Dashboard
- Active stories (last 72h)
- Articles today
- Feed health (X/Y active)
- Daily budget used
- Jobs in queue

#### Feed Health Panel
- Per-feed status indicators (🟢🟡🔴)
- Failure counts, last fetched time
- Reset failures action

#### Job Queue Panel
- Pending/Processing/Completed/Failed counts
- Stuck job detection (>30 min)
- Reset stuck jobs action

#### Budget Panel
- Current spend vs $5 daily cap
- Category breakdown
- 7-day trend

#### Error Log Panel
- Recent errors with timestamps
- Error source identification
- Retry/dismiss actions

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
│  TrumpyTracker Admin                    [Budget: $2.47/$5]
├─────────────────────────────────────────────────────────┤
│  SYSTEM HEALTH          │  NEEDS ATTENTION              │
│  🟢 RSS Pipeline: OK    │  3 stories need review        │
│  🟢 Feeds: 18/18 active │  2 enrichment failures        │
│  🟢 Jobs: 0 stuck       │  5 pardons unpublished        │
│  🟢 Budget: 49% used    │                               │
├─────────────────────────────────────────────────────────┤
│  TODAY'S ACTIVITY                                       │
│  • 12 new articles ingested                             │
│  • 3 stories created, 8 enriched                        │
│  • Last pipeline run: 23 min ago                        │
├─────────────────────────────────────────────────────────┤
│  QUICK ACTIONS                                          │
│  [Process Article] [Run Pipeline] [View Stats]          │
└─────────────────────────────────────────────────────────┘
```

### Review Queue
Dedicated view for "things needing attention":
- Stories with `needs_review = true`
- Stories with low confidence (<50%)
- Stories with enrichment failures
- Pardons with `is_public = false`

**Workflow:** Click item → Edit modal → Save → Auto-removed from queue

### Publishing Workflow (Pardons)

```
Draft → [Edit] → [Preview] → [Publish] → Public
                     ↓
              [Request Review] → Review Queue
```

---

## 4. Implementation Phases

### Phase 0: Safety Foundation (Pre-work)
- Discord alerting for pipeline failures
- Content history table (undo support)
- Admin action audit log
- Optimistic locking for edits
- Bulk operation safety limits

**Effort:** Can be done incrementally with Phase 1

---

### Phase 1: Foundation & Stories
**Scope:**
- Dashboard Home with health status
- Stories tab with full CRUD
- Story re-enrichment trigger
- Budget indicator in header
- Safety foundations

**Deliverables:**
- Dashboard Home page
- Stories list with pagination, search, filter
- Story edit modal
- Re-enrich button with confirmation
- Undo support

**Effort:** 2-3 sessions

---

### Phase 2: Articles & Pardons
**Scope:**
- Articles tab with CRUD
- Pardons tab with all 25+ fields
- Pardon publishing workflow (draft/published tabs)
- Review Queue

**Deliverables:**
- Articles management
- Pardons management with section grouping
- Draft/Published tabs for pardons
- Review Queue panel
- Quality flags on stories

**Effort:** 3-4 sessions

---

### Phase 3: Feed Management
**Scope:**
- Feed registry tab
- Feed health status
- Reset failures, toggle active, add feeds

**Effort:** 1 session

---

### Phase 4: System Health Dashboard
**Scope:**
- Health overview panel
- Job queue visibility
- Budget monitoring with charts
- Error log view

**Effort:** 2 sessions

---

### Phase 5: Executive Order Enhancements
**Scope:**
- Full 4-part analysis fields
- Action framework editing
- EO re-enrichment trigger

**Prerequisites:** ✅ TTRC-216 complete (2026-01-07)

**Effort:** 1 session

---

## 5. User Stories (Jira Breakdown)

### Phase 0: Safety Foundation

**Discord Alerting for Pipeline Failures**
```
As a system admin, I want to receive Discord notifications when pipelines fail
so that I can respond quickly to outages.

Acceptance Criteria:
- [ ] Discord webhook created in TTracker server
- [ ] DISCORD_WEBHOOK_URL added to GitHub secrets
- [ ] rss-tracker-prod.yml sends alert on failure
- [ ] Alert includes workflow name, run URL, and branch
```

**Content History Table for Undo**
```
As an admin, I want to undo my last edit to any content
so that I can recover from mistakes.

Acceptance Criteria:
- [ ] All admin edits log previous value
- [ ] "Undo" button appears after edit
- [ ] Undo restores previous value
- [ ] History viewable per item (last 10 changes)
```

**Admin Action Audit Log**
```
As a system admin, I want all admin actions logged
so that I can audit who changed what.

Acceptance Criteria:
- [ ] All CRUD operations logged with user ID
- [ ] Re-enrichment triggers logged
- [ ] Bulk operations logged with item count
```

**Optimistic Locking for Concurrent Edits**
```
As an admin, I want to be warned if a record was modified while I was editing
so that I don't accidentally overwrite changes.

Acceptance Criteria:
- [ ] Save checks if record was modified
- [ ] Conflict shows error with "Refresh" option
```

**Bulk Operation Safety Limits**
```
As an admin, I want bulk operations capped and confirmed
so that I can't accidentally blow the budget.

Acceptance Criteria:
- [ ] Max 50 items per bulk operation
- [ ] Operations >20 items require typed "CONFIRM"
- [ ] Cost estimate shown before confirmation
```

---

### Phase 1: Foundation & Stories

**Dashboard Home Page**
```
As an admin, I want a home dashboard showing system health and items needing attention
so that I can quickly assess status and prioritize my work.

Acceptance Criteria:
- [ ] System health indicators (pipeline, feeds, jobs, budget)
- [ ] "Needs Attention" counts with links
- [ ] Today's activity summary
- [ ] Quick action buttons
- [ ] Auto-refresh every 5 minutes
```

**Stories List View**
```
As an admin, I want to see all stories in a paginated list
so that I can manage story content.

Acceptance Criteria:
- [ ] Stories tab in admin navigation
- [ ] Paginated table (20 per page)
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
- [ ] Modal with all editable fields
- [ ] Form validation
- [ ] Save/Cancel buttons
- [ ] Success/error feedback
```

**Story Re-enrichment**
```
As an admin, I want to trigger AI re-enrichment for a story
so that I can regenerate summaries and metadata.

Acceptance Criteria:
- [ ] Re-enrich button on story card/modal
- [ ] Confirmation dialog with cost estimate
- [ ] Budget check before proceeding
- [ ] Progress indicator during enrichment
- [ ] Field refresh after completion
```

**Budget Indicator**
```
As an admin, I want to see current budget usage
so that I know if re-enrichment is available.

Acceptance Criteria:
- [ ] Budget display in header (spent/cap)
- [ ] Visual progress bar
- [ ] Warning state when >80%
- [ ] Blocked state when >=100%
```

---

### Phase 2: Articles & Pardons

**Articles Management**
```
As an admin, I want to manage individual articles
so that I can edit article metadata.

Acceptance Criteria:
- [ ] Articles tab
- [ ] Article list with pagination
- [ ] Edit modal for all fields
- [ ] View linked stories
- [ ] Entity extraction re-trigger
```

**Pardons Management**
```
As an admin, I want to manage pardon records
so that I can edit all pardon fields.

Acceptance Criteria:
- [ ] Pardons tab
- [ ] All 25+ editable fields in modal
- [ ] Section grouping (Identity, Details, Connection, etc.)
- [ ] is_public toggle with confirmation
- [ ] needs_review flag management
- [ ] Re-enrichment trigger
```

**Review Queue**
```
As an admin, I want a unified review queue
so that I can work through all flagged items efficiently.

Acceptance Criteria:
- [ ] Shows all items needing review across content types
- [ ] Sortable by priority, age, type
- [ ] One-click to open edit modal
- [ ] Item removed from queue after save
- [ ] Count badge in navigation
```

**Pardon Publishing Workflow**
```
As an admin, I want a clear draft/publish workflow for pardons
so that I can control what's visible to the public.

Acceptance Criteria:
- [ ] "Drafts" tab showing is_public=false pardons
- [ ] "Published" tab showing is_public=true pardons
- [ ] Publish button with confirmation
- [ ] Bulk publish selected items
```

---

### Phase 3: Feed Management

**Feed Registry Management**
```
As an admin, I want to manage RSS feeds
so that I can control content sources.

Acceptance Criteria:
- [ ] Feeds tab
- [ ] Feed list with health indicators
- [ ] Edit modal for feed settings
- [ ] Add new feed form
- [ ] Reset failure count action
- [ ] Toggle active/inactive
```

---

### Phase 4: System Health

**System Health Overview**
```
As an admin, I want a health dashboard
so that I can monitor system status.

Acceptance Criteria:
- [ ] Health tab with overview metrics
- [ ] Status indicators (green/yellow/red)
- [ ] Key metrics: active stories, articles today, feed health
- [ ] Auto-refresh every 5 minutes
```

**Job Queue Visibility**
```
As an admin, I want to see job queue status
so that I can identify stuck or failed jobs.

Acceptance Criteria:
- [ ] Job queue panel
- [ ] Counts by status (pending/processing/complete/failed)
- [ ] Stuck job detection
- [ ] Reset stuck jobs action
```

**Budget Monitoring**
```
As an admin, I want detailed budget tracking
so that I can manage AI costs.

Acceptance Criteria:
- [ ] Budget panel with current day spend
- [ ] Category breakdown (stories/pardons/entities)
- [ ] 7-day trend chart
```

**Error Log View**
```
As an admin, I want to see recent errors
so that I can triage and fix issues.

Acceptance Criteria:
- [ ] Error log panel
- [ ] Recent errors with timestamp
- [ ] Error source identification
- [ ] Link to affected item
- [ ] Retry/dismiss actions
```

---

### Phase 5: EO Enhancements

**Executive Order Full Edit**
```
As an admin, I want to edit all EO fields
so that I can manage 4-part analysis content.

Acceptance Criteria:
- [ ] Enhanced EO edit modal
- [ ] All 4 analysis sections editable
- [ ] Action framework editor
- [ ] Regions/agencies arrays
- [ ] Re-enrichment trigger
```

---

### Additional Features (Future)

**Global Search**
```
As an admin, I want to search across all content types
so that I can find related content quickly.

Acceptance Criteria:
- [ ] Search box in header (always visible)
- [ ] Searches stories, articles, pardons, EOs
- [ ] Results grouped by type
- [ ] Click result to open edit modal
```

---

## 6. Risk Mitigations

| Gap | Risk | Mitigation | Phase |
|-----|------|------------|-------|
| No Undo/Rollback | HIGH | Content history table + undo button | Phase 0/1 |
| No Proactive Alerting | HIGH | Discord webhook on workflow failure | Phase 0 |
| Race Condition (Admin vs Pipeline) | MEDIUM | Optimistic locking check | Phase 1 |
| No Admin Audit Log | MEDIUM | Action log table | Phase 1 |
| Bulk Ops Budget Risk | MEDIUM | Cap at 50, typed confirmation | Phase 1 |
| No Content Quality Flags | MEDIUM | Add needs_review to stories | Phase 2 |

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Admin can edit any content type | 100% | Manual verification |
| Re-enrichment success rate | >95% | Enrichment failure count |
| System health visible | Yes | Dashboard complete |
| Error triage time | <5 min | From error to action |
| Budget visibility | Real-time | 1-minute refresh |

---

## 8. Dependencies & Blockers

| Dependency | Status | Impact |
|------------|--------|--------|
| ~~TTRC-216 (EO schema)~~ | ✅ Done | No longer blocking |
| EO enrichment | ✅ Done | 190/190 EOs enriched |
| Discord webhook | Not started | Need to create webhook |
| Re-enrichment agents | In progress | Can workaround with direct updates |

---

## 9. Open Questions

1. **Audit log retention?** How long to keep admin action logs?
2. **Re-enrichment rate limits?** Proposal: 10/minute - sufficient?
3. **Bulk operations scope?** Proposal: 50 items max
4. **Multi-admin support?** Just Josh for now, or plan for future?

---

## Appendix

### A. Category Enums

**Story Categories (11):**
corruption_scandals, democracy_elections, policy_legislation, justice_legal, executive_actions, foreign_policy, corporate_financial, civil_liberties, media_disinformation, epstein_associates, other

**EO Categories (10):**
immigration_border, environment_energy, health_care, education, justice_civil_rights_voting, natsec_foreign, economy_jobs_taxes, technology_data_privacy, infra_housing_transport, gov_ops_workforce

**Pardon Connection Types (10):**
mar_a_lago_vip, major_donor, family, political_ally, campaign_staff, business_associate, jan6_defendant, fake_electors, celebrity, no_connection

### B. Severity Levels

- `critical` - Immediate threat
- `severe` - Serious concern
- `moderate` - Notable but manageable
- `minor` - Routine/low impact

### C. Cost Reference

| Operation | Model | Est. Cost |
|-----------|-------|-----------|
| Story enrichment | gpt-4o-mini | $0.003 |
| Entity extraction | gpt-4o-mini | $0.0003 |
| Pardon enrichment | gpt-4o-mini | $0.005 |
| EO enrichment | gpt-4o-mini | $0.015 |

---

**Last Updated:** 2026-02-01

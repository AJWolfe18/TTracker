# TrumpyTracker Database Schema

**Last Updated:** 2026-08-23 (tracker_pin + v_tracker_stories, migration 112)
**Status:** RSS v2 system active on both TEST and PROD

---

## Overview

TrumpyTracker uses Supabase (PostgreSQL) with the RSS v2 story clustering architecture.

**Both Environments:** Stories + Articles model with AI enrichment

---

## Core Tables

### `stories`
**Purpose:** Aggregate related articles into coherent stories
**Row Count:** ~2,700 stories

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key |
| story_hash | TEXT | UNIQUE - Hash for deduplication |
| primary_headline | TEXT | Main headline |
| primary_source | TEXT | Source name of primary article |
| primary_source_url | TEXT | URL of primary article |
| primary_actor | TEXT | Main person/org in story |
| first_seen_at | TIMESTAMPTZ | When story created |
| last_updated_at | TIMESTAMPTZ | Last article added |
| status | TEXT | 'active', 'closed', 'archived' |
| severity | TEXT | 'critical', 'severe', 'moderate', 'minor' |
| category | TEXT | Story category enum |
| source_count | INTEGER | Number of sources |
| summary_neutral | TEXT | Factual AI summary |
| summary_spicy | TEXT | Engaging AI summary |
| last_enriched_at | TIMESTAMPTZ | When AI enrichment ran |
| search_vector | TSVECTOR | Full-text search index |
| confidence_score | NUMERIC | Clustering confidence |
| entity_counter | JSONB | Entity mention counts |
| lifecycle_state | TEXT | 'emerging', 'developing', 'mature' |
| thresholds_profile | TEXT | Clustering threshold profile |
| top_entities | TEXT[] | Top entities in story |
| enrichment_status | TEXT | Enrichment pipeline status |
| enrichment_failure_count | INTEGER | Failed enrichment attempts |

**Key Indexes:**
- `stories_pkey` - Primary key on `id`
- `ix_stories_story_hash` - UNIQUE on `story_hash`
- `ix_stories_status_first_seen` - Composite on `(status, first_seen_at DESC)`

---

### `articles`
**Purpose:** Individual RSS articles from feeds
**Row Count:** ~3,100 articles

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key (format: 'art-{uuid}') |
| url | TEXT | Article URL |
| url_hash | TEXT | Hash for deduplication |
| title | TEXT | Article headline |
| source_name | TEXT | Publication name |
| source_domain | TEXT | Domain of source |
| published_at | TIMESTAMPTZ | When article published |
| published_date | DATE | GENERATED from published_at |
| fetched_at | TIMESTAMPTZ | When RSS fetched |
| content | TEXT | Article text (scraped) |
| excerpt | TEXT | Article excerpt/description |
| content_type | TEXT | 'news_report', 'opinion', 'analysis' |
| guid | TEXT | RSS GUID for deduplication |
| primary_actor | TEXT | Main actor extracted |
| categories | TEXT[] | Array of categories |
| metadata | JSONB | Additional metadata |

**Deduplication:**
- Composite unique on `(url_hash, published_date)`
- Same URL on different days = allowed
- Same URL same day = upserted

---

### `article_story`
**Purpose:** Many-to-many junction
**Row Count:** ~3,000 mappings

| Column | Type | Description |
|--------|------|-------------|
| article_id | TEXT | FK to articles.id |
| story_id | BIGINT | FK to stories.id |
| is_primary_source | BOOLEAN | Is this the primary article |
| similarity_score | NUMERIC | Match confidence (0-100) |
| matched_at | TIMESTAMPTZ | When matched |

---

### `feed_registry`
**Purpose:** RSS feed configuration
**Row Count:** 18 active feeds

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key |
| feed_url | TEXT | RSS feed URL |
| feed_name | TEXT | Human-readable name |
| source_name | TEXT | Publication name |
| topics | TEXT[] | Topics feed covers |
| tier | INTEGER | Priority (1=highest, 3=lowest) |
| is_active | BOOLEAN | Currently processed |
| failure_count | INTEGER | Consecutive failures |
| etag | TEXT | HTTP ETag for caching |
| last_modified | TEXT | HTTP Last-Modified |
| last_fetched_at | TIMESTAMPTZ | Last fetch time |

**Feed Tiers:**
- **Tier 1:** Major news (Reuters, AP, WaPo)
- **Tier 2:** Quality sources (Atlantic, Guardian)
- **Tier 3:** Aggregators/secondary

**Failure Handling:** Disabled when `failure_count >= 5`

---

### `feed_compliance_rules`
**Purpose:** Content limits for RSS feeds

| Column | Type | Description |
|--------|------|-------------|
| feed_id | BIGINT | FK to feed_registry.id |
| source_name | TEXT | Source name |
| allow_full_text | BOOLEAN | Allow full text (false = excerpt only) |
| max_chars | INTEGER | Content char limit (default: 5000) |
| notes | TEXT | Notes about rule |

---

### `budgets`
**Purpose:** Daily API cost tracking

| Column | Type | Description |
|--------|------|-------------|
| day | DATE | Primary key |
| cap_usd | NUMERIC | Daily spending cap (default: $50) |
| spent_usd | NUMERIC | Amount spent |
| openai_calls | INTEGER | API call count |

**Budget Enforcement:** Checked before OpenAI calls in `rss-tracker-supabase.js`

---

## Pardons Tracker Tables

### `pardons`
**Purpose:** Track presidential pardons with corruption analysis
**Row Count:** ~5 test records (MVP in development)
**Migration:** `056_pardons_table.sql`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (GENERATED ALWAYS AS IDENTITY) |
| recipient_name | TEXT | NOT NULL - Name of pardon recipient |
| recipient_slug | TEXT | Auto-generated URL slug |
| nickname | TEXT | Optional nickname |
| photo_url | TEXT | Optional photo URL |
| recipient_type | TEXT | 'person' or 'group' (default: 'person') |
| recipient_count | INT | For groups only - how many people |
| recipient_criteria | TEXT | For groups only - who qualifies |
| pardon_date | DATE | NOT NULL - When pardon was granted |
| clemency_type | TEXT | 'pardon', 'commutation', 'pre_emptive' |
| status | TEXT | 'confirmed' or 'reported' |
| conviction_district | TEXT | DOJ ingestion field |
| case_number | TEXT | DOJ ingestion field |
| offense_raw | TEXT | Raw offense text from DOJ |
| crime_description | TEXT | Human-readable crime description |
| crime_category | TEXT | Enum: white_collar, obstruction, etc. |
| original_sentence | TEXT | Original sentence |
| conviction_date | DATE | When convicted |
| primary_connection_type | TEXT | Enum: mar_a_lago_vip, major_donor, etc. |
| secondary_connection_types | TEXT[] | Additional connections |
| corruption_level | SMALLINT | 1-5 "spicy" scale |
| research_status | TEXT | 'complete', 'in_progress', 'pending' |
| post_pardon_status | TEXT | 'quiet', 'under_investigation', 're_offended' |
| post_pardon_notes | TEXT | What happened after pardon |
| trump_connection_detail | TEXT | Connection explanation |
| donation_amount_usd | NUMERIC(14,2) | Donation amount if applicable |
| receipts_timeline | JSONB | Array of timeline events |
| summary_neutral | TEXT | AI: Factual summary |
| summary_spicy | TEXT | AI: Engaging summary |
| why_it_matters | TEXT | AI: Analysis |
| pattern_analysis | TEXT | AI: Pattern context |
| enriched_at | TIMESTAMPTZ | When AI enrichment ran |
| needs_review | BOOLEAN | Flag for manual review |
| primary_source_url | TEXT | Main source URL |
| source_urls | JSONB | Array of source URLs |
| source_system | TEXT | 'manual' or 'doj_opa' |
| source_key | TEXT | DOJ registry ID (for dedupe) |
| is_public | BOOLEAN | Publish gate (RLS filter) |
| search_vector | TSVECTOR | GENERATED full-text index |
| created_at | TIMESTAMPTZ | Row created |
| updated_at | TIMESTAMPTZ | Row updated (trigger) |

**Key Constraints:**
- `pardons_group_fields_chk` - Groups require count + criteria
- `pardons_donation_nonnegative` - Donation >= 0
- `pardons_receipts_timeline_is_array` - JSONB array check
- Partial unique: `(source_system, source_key) WHERE source_key IS NOT NULL`

**Key Indexes:**
- `idx_pardons_search` - GIN on search_vector
- `idx_pardons_pardon_date_id_desc` - Composite pagination
- `idx_pardons_public_pardon_date_id_desc` - Partial index for public queries
- btree on: primary_connection_type, crime_category, corruption_level, recipient_type

**RLS Policies:**
- `pardons_anon_select` - Anon sees only `is_public = true`

---

### `pardon_story`
**Purpose:** Many-to-many junction linking pardons to news stories

| Column | Type | Description |
|--------|------|-------------|
| pardon_id | BIGINT | FK to pardons.id (CASCADE) |
| story_id | BIGINT | FK to stories.id (CASCADE) |
| link_type | TEXT | 'primary_coverage', 'background', 'related', 'mentioned' |
| linked_at | TIMESTAMPTZ | When link created |

**Primary Key:** `(pardon_id, story_id)`

**RLS Policies:**
- `pardon_story_anon_select` - Only show links to public pardons

---

## Fronts (Events) Tables

Added by migration 111 (ADO-546, applied on TEST 2026-08-19). Schema keeps the neutral
`events` naming; public copy says "fronts". Fronts are an aggregation layer above stories —
articles are never linked to fronts. **No stored counters:** `v_event_stats` derives everything.
Full column contract: PRD §6 (`docs/features/events-tracker/prd.md`).

### `events`
**Purpose:** One row per front (editorial storyline container)

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (identity) |
| slug | TEXT | UNIQUE, presentation only — never a join key |
| name | TEXT | "The Epstein Files" |
| dek | TEXT | One-paragraph standing summary |
| alarm_level | SMALLINT | 0-5 editorial (displays everywhere); CHECK 0-5, default 3 |
| tier | TEXT | CHECK: 'flagship', 'major', 'standard' |
| lifecycle | TEXT | CHECK: 'open', 'dormant', 'resolved'; resolved requires resolved_at |
| publish_state | TEXT | CHECK: 'draft', 'review', 'published'; published requires published_at |
| published_at / started_at / resolved_at | TIMESTAMPTZ | Editorial timestamps |
| created_by | TEXT | CHECK: 'agent', 'human' |
| enrichment_meta | JSONB | AI provenance |
| created_at / updated_at | TIMESTAMPTZ | updated_at via set_updated_at() trigger |

**RLS:** `events_anon_select` — anon sees `publish_state='published'` only. Writes are service_role only.

### `event_updates`
**Purpose:** One row per editorial update on a front (AI-drafted or human-written, approval-gated)

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (identity) |
| event_id | BIGINT | FK → events (CASCADE); UNIQUE (id, event_id) backs the same-front FK |
| headline / body | TEXT | Editorial content |
| happened_at | TIMESTAMPTZ | When the development occurred |
| sort_key | BIGINT | Breaks happened_at ties |
| significance | TEXT | CHECK: 'major', 'minor' |
| approval_state | TEXT | CHECK: 'pending', 'approved', 'rejected'; decided states require decided_at + decided_by, pending forbids them |
| decided_at / decided_by | TIMESTAMPTZ / TEXT | The human gate; decided_by CHECK 'agent'/'human' |
| was_edited | BOOLEAN | Human edited the draft before approving (draft-quality metric) |
| created_by | TEXT | CHECK: 'agent', 'human' |
| enrichment_meta | JSONB | Provenance only, never queried |

**RLS:** `event_updates_anon_select` — anon sees approved updates on published fronts only.

### `story_event`
**Purpose:** Story→front membership. **PK is `story_id` ALONE — one front per story** (mirrors article_story)

| Column | Type | Description |
|--------|------|-------------|
| story_id | BIGINT | **PK**, FK → stories (CASCADE) |
| event_id | BIGINT | FK → events (CASCADE) |
| event_update_id | BIGINT | FK → event_updates (SET NULL) + composite FK (event_update_id, event_id) → event_updates (id, event_id) — an update link must belong to the same front |
| assigned_by | TEXT | CHECK: 'agent', 'human' |
| confidence | NUMERIC | CHECK 0-1 or NULL |
| assigned_at / reassigned_at | TIMESTAMPTZ | |
| reassigned_from_event_id | BIGINT | FK → events (SET NULL); makes assignment precision measurable |

**RLS:** `story_event_anon_select` — anon sees memberships of published fronts only.
**Gotcha:** `merge_stories` does NOT repoint story_event (unlike article_story) — a member story merged away leaves the front counting a tombstone. Open Wave 2 decision.

### `v_event_stats` (view)
**Purpose:** All derived front stats — nothing derived is ever stored (PRD §6.5)

`event_id, story_count, source_count (article_story rows across members), update_count (approved only), last_activity_at (max member story last_updated_at), peak_alarm (COALESCE(alarm_level, severity map, 2) — rubric/admin QA only, never displays), days_since_update (whole days since last approved update's happened_at)`

`security_invoker = true` — anon reads inherit table RLS. GRANT SELECT to anon on all three tables + view (migration 046 auto-revoke countered).

### `tracker_pin`
**Purpose:** Per-entry Tracker main-line override — optional hand-curation on top of the rule (ADO-554)
**Migration:** `112_tracker_main_line.sql` (applied on TEST 2026-08-23)

| Column | Type | Description |
|--------|------|-------------|
| source | TEXT | PK part — `stories` / `eos` / `scotus` / `pardons` (CHECK) |
| entity_id | TEXT | PK part — TEXT on purpose: EO ids are VARCHAR on PROD, INTEGER on TEST (migration 108 drift) |
| pin | TEXT | `force_show` \| `force_hide` (CHECK) |
| note | TEXT | Optional admin breadcrumb (why pinned) |
| created_at / updated_at | TIMESTAMPTZ | updated_at via `set_updated_at()` trigger |

**RLS:** anon SELECT policy with a **column-level grant on `source`, `entity_id`, `pin` only** — pin existence is public curation data (a force_shown row renders publicly), but `note` is an admin breadcrumb and is NOT anon-readable. Writes service_role only. ADO-547 ships the admin editor.

### `v_tracker_stories` (view)
**Purpose:** The Tracker spine's stories read path with the server-computed `main_line` rule (ADO-554, PRD §12 anchor principle)

`id, primary_headline, first_seen_at, alarm_level, severity, front_id, front_name, front_slug, front_opening, tracker_pin, alarm_eff, main_line`

**The rule (v1.1):** `force_show` pin → true; `force_hide` → false; no published front (loose end) → `alarm_eff = 5` (raised from 4+ on August 23, 2026: fronts are the organizing layer and enrichment severity saturation rates ~67% of stories 4+, which drowned the main line); front member → front opening (earliest member by `first_seen_at, id`) OR `alarm_eff = 5` OR (`alarm_eff >= 4` AND strictly greater than every earlier member's `alarm_eff` in that front — a tie is not a new peak). `alarm_eff` = COALESCE(alarm_level, severity map, 2) — same fallback as the adapters and `v_event_stats`. Bakes in `status = 'active' AND summary_neutral IS NOT NULL`; term scoping stays client-side.

`security_invoker = true` — for anon, unpublished fronts' members count as loose ends (RLS hides the membership), by design. EO/SCOTUS/pardon rows have no front membership; the frontend applies their loose-end rule + pins client-side from `tracker_pin`.

---

## SCOTUS Tracker Tables

### `scotus_cases`
**Purpose:** Track Supreme Court decisions with AI enrichment
**Row Count:** ~12 cases (MVP in development)
**Migration:** `066_scotus_cases.sql`
**Data Source:** CourtListener API

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (GENERATED ALWAYS AS IDENTITY) |
| courtlistener_cluster_id | BIGINT | UNIQUE NOT NULL - CourtListener cluster ID |
| courtlistener_docket_id | BIGINT | CourtListener docket ID |
| case_name | TEXT | NOT NULL - Full case name |
| case_name_short | TEXT | Short name (e.g., "Connelly") |
| case_name_full | TEXT | Full case name with parties |
| docket_number | TEXT | e.g., "No. 23-146" |
| term | TEXT | SCOTUS term year (e.g., "2024") |
| decided_at | TIMESTAMPTZ | Decision date |
| argued_at | TIMESTAMPTZ | Oral argument date |
| citation | TEXT | Best citation (e.g., "599 U.S. 123") |
| vote_split | TEXT | "6-3" format (nullable, SCDB data sparse) |
| majority_author | TEXT | Justice who wrote majority/plurality |
| dissent_authors | TEXT[] | Array of dissenting justices |
| syllabus | TEXT | Case syllabus extracted from opinion |
| opinion_excerpt | TEXT | First ~500 chars if no syllabus |
| issue_area | TEXT | Classification (justice_legal, voting_rights, etc.) |
| petitioner_type | TEXT | individual, corporation, government |
| respondent_type | TEXT | individual, corporation, government |
| ruling_impact_level | SMALLINT | 0-5 impact scale (from enrichment) |
| ruling_label | TEXT | Short ruling description |
| who_wins | TEXT | Winning party description |
| who_loses | TEXT | Losing party description |
| summary_spicy | TEXT | AI: Engaging summary |
| why_it_matters | TEXT | AI: Impact analysis |
| dissent_highlights | TEXT | AI: Key dissent points |
| evidence_anchors | TEXT[] | AI: Quote citations |
| is_public | BOOLEAN | NOT NULL DEFAULT false - Publish gate |
| enriched_at | TIMESTAMPTZ | When AI enrichment ran |
| prompt_version | TEXT | Enrichment prompt version |
| source_url | TEXT | CourtListener page URL |
| pdf_url | TEXT | Opinion PDF URL |
| created_at | TIMESTAMPTZ | Row created |
| updated_at | TIMESTAMPTZ | Row updated (trigger) |

**Key Constraints:**
- UNIQUE on `courtlistener_cluster_id` (idempotent upserts)
- CHECK on `ruling_impact_level` (0-5 range)

**Key Indexes:**
- `idx_scotus_cases_term` - btree on term
- `idx_scotus_cases_decided` - btree on decided_at DESC
- `idx_scotus_cases_impact` - btree on ruling_impact_level
- `idx_scotus_cases_issue` - btree on issue_area
- `idx_scotus_cases_unenriched` - Partial: unenriched public cases
- `idx_scotus_cases_public` - Partial: public cases only

**RLS Policies:**
- `scotus_cases_anon_select` - Anon sees only `is_public = true`
- `scotus_cases_service_all` - Service role has full access

---

### `scotus_sync_state`
**Purpose:** Pagination checkpoint for CourtListener API fetching (singleton table)

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key (always 1 - singleton) |
| next_url | TEXT | CourtListener pagination URL |
| last_date_filed | DATE | Most recent case date seen |
| last_fetch_at | TIMESTAMPTZ | Last fetch timestamp |
| total_fetched | INT | Running count of cases fetched |
| updated_at | TIMESTAMPTZ | Row updated (trigger) |

**Constraint:** `CHECK (id = 1)` ensures singleton

---

## Supporting Tables

### `executive_orders`
**Purpose:** Presidential executive order tracking. Enriched by the EO Claude Agent (ADO-476/477/478/479).

**Agent-writes (v1 prompt — canonical):**

| Column | Type | Description |
|--------|------|-------------|
| section_what_they_say | TEXT NOT NULL | 150-200 words, neutral framing |
| section_what_it_means | TEXT NOT NULL | 150-200 words, editorial |
| section_reality_check | TEXT NOT NULL | 100-150 words |
| section_why_it_matters | TEXT NOT NULL | 100-150 words |
| alarm_level | SMALLINT | 0-5, canonical severity. Drives frontend labels via `tone-system.json` |
| severity_rating | VARCHAR | **Server-derived** from `alarm_level` via `supabase/functions/_shared/eo-severity.ts`. Never directly editable. (`critical`/`high`/`medium`/`low`/null) |
| category | EO_CATEGORY enum | One of: `immigration_border`, `environment_energy`, `health_care`, `education`, `justice_civil_rights_voting`, `natsec_foreign`, `economy_jobs_taxes`, `technology_data_privacy`, `infra_housing_transport`, `gov_ops_workforce` |
| regions | TEXT[] NOT NULL | ≤ 3 entries |
| policy_areas | TEXT[] NOT NULL | ≤ 3 entries, Title Case |
| affected_agencies | TEXT[] NOT NULL | ≤ 3 entries, standard acronyms |
| action_tier | TEXT | `direct` / `systemic` / `tracking` |
| action_confidence | INTEGER | 1-10 |
| action_reasoning | TEXT NOT NULL | One-sentence explanation |
| action_section | JSONB | `{title, actions[]}` when direct/systemic; **null** when tracking |
| enriched_at | TIMESTAMPTZ | Set on successful agent run |
| prompt_version | TEXT | `v1` for agent-written rows; NULL signals "needs (re-)enrichment" |
| enrichment_meta | JSONB | `{model, source, enriched_at, prompt_version, signing_statement_used}` |

**System fields:**

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| order_number | VARCHAR | EO number (e.g., "14343") |
| date | DATE | Signing date |
| title | TEXT | Order title |
| source_url | TEXT | Federal Register URL |
| created_at | TIMESTAMPTZ | Row inserted |
| updated_at | TIMESTAMPTZ | Auto-incremented `BEFORE UPDATE` (migration 092) — supports admin optimistic locking |
| added_at | TIMESTAMPTZ | Discovery timestamp |
| archived | BOOLEAN | Exists, not surfaced by admin tab |
| archive_reason | TEXT | Exists, not surfaced by admin tab |
| verified | BOOLEAN | Exists, not surfaced by admin tab |

**Admin publish gate (added by migration 092 — ADO-480):**

| Column | Type | Description |
|--------|------|-------------|
| is_public | BOOLEAN NOT NULL DEFAULT false | Canonical "is this EO visible on the public site?" Backfilled to `true` for all pre-migration rows. New rows require explicit admin publish. Filtered by `public/eo-app.js` via `is_public=eq.true`. |
| needs_manual_review | BOOLEAN NOT NULL DEFAULT false | Row-level flag synced from `executive_orders_enrichment_log.needs_manual_review` via DB trigger on `status='completed'` writes. Cleared by admin publish (durable acknowledgment). When trigger raises this flag, `is_public` is auto-set to `false` (re-flag auto-unpublishes). |

**Triggers:**
- `eo_set_updated_at` (BEFORE UPDATE) — auto-advances `updated_at` so admin CAS works
- `eo_log_sync_needs_review_insert` (AFTER INSERT on `executive_orders_enrichment_log`, WHEN `status='completed'`)
- `eo_log_sync_needs_review_update` (AFTER UPDATE OF status on `executive_orders_enrichment_log`, WHEN `status='completed' AND OLD.status IS DISTINCT FROM 'completed'`)
- Existing `lock_enriched_at` (migration 023) — passes through re-enrich `prompt_version=NULL, enriched_at=NULL` writes via NULL-comparison short-circuit

**Indexes:**
- `idx_eo_publish_state` — `(prompt_version, is_public, needs_manual_review)` supports admin tab predicates

**Legacy fields (old GPT pipeline, dead weight — scheduled for drop in ADO-481 after PROD re-enrichment):**

`summary`, `spicy_summary`, `shareable_hook`, `severity_label_inapp`, `severity_label_share`, `eo_impact_type`, `agencies_affected`, `impact_areas`, `severity`, `policy_direction`, `implementation_timeline`, `implementation_status`, `impact_score`, `legal_challenges`, `related_orders`, `description`, `federal_register_url`, `pdf_url`, `citation`, `publication_date`, `document_number`, `source`, `type`

Admin tab ignores all of them (never selects, never writes). Public frontend renders labels from `tone-system.json` via `alarm_level`, NOT from `severity_label_*` fields.

---

### `executive_orders_enrichment_log`
**Purpose:** Per-EO enrichment observability for the EO Claude Agent (ADO-476)
**Migration:** `20260415000000_executive_orders_enrichment_log.sql`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (BIGSERIAL) |
| eo_id | INTEGER | FK to executive_orders.id (ON DELETE CASCADE) |
| prompt_version | TEXT | Enrichment prompt version (e.g., 'v1') |
| run_id | TEXT | Links rows from same agent run |
| status | TEXT | 'running', 'completed', or 'failed' |
| duration_ms | INTEGER | Enrichment time in milliseconds |
| needs_manual_review | BOOLEAN | Default false — flagged for admin review |
| notes | TEXT | Free-form notes (nullable) |
| created_at | TIMESTAMPTZ | When enrichment started |

**Key Indexes:**
- `idx_eo_enrichment_log_created_at` — `created_at DESC`
- `idx_eo_enrichment_log_eo_id_created_at` — `(eo_id, created_at DESC)`

**RLS Policies:** RLS enabled, no SELECT policies — blocks anon/authenticated, service_role bypasses

---

### `stories_enrichment_log`
**Purpose:** Per-story enrichment observability for the Stories Claude Agent (ADO-528)
**Migration:** `098_stories_enrichment_log.sql`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (BIGSERIAL) |
| story_id | BIGINT | FK to stories.id (ON DELETE CASCADE) — **nullable**: NULL = run-level heartbeat row on a healthy 0-candidate cycle (unlike EO's `eo_id`, which is NOT NULL — Stories runs 12x/day vs EO's 1x/day, so empty runs are common, not rare) |
| prompt_version | TEXT | Enrichment prompt version (e.g., 'claude-v1') |
| run_id | TEXT | Links rows from same agent run |
| status | TEXT | 'running', 'completed', or 'failed' |
| duration_ms | INTEGER | Enrichment time in milliseconds |
| needs_manual_review | BOOLEAN | Default false — flagged for admin review |
| notes | TEXT | Free-form notes (nullable) |
| created_at | TIMESTAMPTZ | When enrichment started |

**Key Indexes:**
- `idx_stories_enrichment_log_created_at` — `created_at DESC`
- `idx_stories_enrichment_log_story_id_created_at` — `(story_id, created_at DESC)`

**RLS Policies:** RLS enabled, no SELECT policies — blocks anon/authenticated, service_role bypasses

---

### `clustering_judge_log`
**Purpose:** One row per Clustering Judge verdict + run heartbeats; audit trail behind the admin Judge tab (ADO-533/537)
**Migrations:** `100_clustering_judge.sql`, widened by `104`/`105`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (identity) |
| created_at | TIMESTAMPTZ | Verdict time |
| source | TEXT | CHECK: 'inline', 'judge-agent', 'manual' ('manual' added by 104 = admin Judge tab action) |
| story_id_a / story_id_b | BIGINT | The pair; NULL on run-level heartbeat rows |
| headline_a / headline_b | TEXT | Snapshots (survive later merges/edits) |
| verdict | TEXT | CHECK: 'merge', 'keep', 'uncertain', 'unmerge' ('unmerge' added by 105) |
| confidence | NUMERIC | 0–1, nullable |
| rationale | TEXT | Judge reasoning |
| centroid_sim | NUMERIC | Decision-time similarity |
| merged | BOOLEAN | TRUE only when merge_stories actually ran (false on unmerge rows) |
| dry_run | BOOLEAN | TRUE when run was dry-run |
| run_id | TEXT | Per-run drill-down |

**RLS:** enabled, no anon/authenticated grant — admin tab reads via `admin-judge-log` edge function (service_role).

---

### `story_merge_audit`
**Purpose:** Pre-merge snapshot of the loser story's `article_story` membership so a wrong merge can be reversed (ADO-533; consumed by `unmerge_story`, ADO-537)
**Migrations:** `101_clustering_judge_hardening.sql`, `105` adds `unmerged_at`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key (identity) |
| merged_at | TIMESTAMPTZ | When the merge executed |
| run_id | TEXT | Judge run (NULL for manual merges pre-104) |
| loser_id / survivor_id | BIGINT | The pair |
| loser_article_ids | TEXT[] | Snapshot of the loser's article ids (articles.id is TEXT `art-<uuid>`) |
| unmerged_at | TIMESTAMPTZ | Non-NULL = snapshot consumed by `unmerge_story` (each snapshot reversible once) |

---

### `judge_run_merge_count`
**Purpose:** DB-side hard cap for the Clustering Judge — one row per run_id counting executed merges; `merge_stories` refuses past the cap (ADO-533)
**Migration:** `101_clustering_judge_hardening.sql`

| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT | Primary key |
| merge_count | INT | Executed merges this run |
| updated_at | TIMESTAMPTZ | Last increment |

---

### `pending_submissions`
**Purpose:** Manual article submission queue

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| url | TEXT | Submitted URL |
| submitted_at | TIMESTAMPTZ | Submission time |
| processed | BOOLEAN | Processing status |
| result_id | VARCHAR | Created entry ID |

---

### `openai_usage`
**Purpose:** Track OpenAI API usage per entity

| Column | Type | Description |
|--------|------|-------------|
| id | BIGINT | Primary key |
| story_id | BIGINT | FK to stories.id |
| article_id | TEXT | FK to articles.id |
| model | TEXT | Model used |
| tokens_in | INTEGER | Input tokens |
| tokens_out | INTEGER | Output tokens |
| cost_usd | NUMERIC | Estimated cost |
| created_at | TIMESTAMPTZ | When call made |

---

## Deprecated Tables

### `job_queue` (DEPRECATED)
**Status:** Table exists but system no longer uses it. Job queue worker replaced by inline `rss-tracker-supabase.js`.

### `political_entries` (DEPRECATED)
**Status:** Legacy table from pre-RSS system. Read-only historical data.

---

## Key RPCs (Stored Procedures)

| RPC | Purpose |
|-----|---------|
| `attach_or_create_article()` | Idempotent article insertion with story matching |
| `get_stories_needing_enrichment()` | Find unenriched stories for AI processing |
| `increment_budget_with_limit()` | Atomic budget check + increment |
| `merge_stories(p_loser_id, p_survivor_id, p_run_id)` | Server-side story merge: snapshot to `story_merge_audit`, repoint `article_story`, recompute survivor, tombstone loser (`status='merged_into'`). FOR UPDATE locks + per-run cap. service_role only |
| `unmerge_story(p_loser_id, p_run_id)` | Reverse a merge from its unconsumed snapshot: restore articles still on the survivor, clear tombstone, recompute both, stamp `unmerged_at` (ADO-537). Loser always restores as `active` (pre-merge status not snapshotted — harmless while lifecycle disabled). service_role only |
| `recompute_story_from_members(p_story_id)` | Rebuild a story's centroid/entities/`source_count` from actual `article_story` members (ADO-537). service_role only |

---

## Common Queries

### Active Stories
```sql
SELECT id, primary_headline, source_count, last_updated_at
FROM stories
WHERE status = 'active'
ORDER BY last_updated_at DESC
LIMIT 20;
```

### Feed Health
```sql
SELECT feed_name, is_active, failure_count, last_fetched_at
FROM feed_registry
ORDER BY last_fetched_at DESC;
```

### Daily Costs
```sql
SELECT day, spent_usd, openai_calls
FROM budgets
ORDER BY day DESC
LIMIT 7;
```

### Stories Needing Enrichment
```sql
SELECT id, primary_headline
FROM stories
WHERE last_enriched_at IS NULL
  AND status = 'active'
LIMIT 10;
```

---

## Category Enum Values

| UI Label | Database Value |
|----------|----------------|
| Corruption & Scandals | `corruption_scandals` |
| Democracy & Elections | `democracy_elections` |
| Policy & Legislation | `policy_legislation` |
| Justice & Legal | `justice_legal` |
| Executive Actions | `executive_actions` |
| Foreign Policy | `foreign_policy` |
| Corporate & Financial | `corporate_financial` |
| Civil Liberties | `civil_liberties` |
| Media & Disinformation | `media_disinformation` |
| Epstein & Associates | `epstein_associates` |
| Other | `other` |

---

## Naming Conventions

| Element | Format | Example |
|---------|--------|---------|
| Tables | `snake_case`, plural | `stories`, `feed_registry` |
| Columns | `snake_case` | `created_at`, `story_id` |
| Foreign Keys | `{table_singular}_id` | `story_id`, `article_id` |
| Indexes | `idx_{table}_{columns}` | `idx_stories_created_at` |

**Required columns:** `id`, `created_at` (timestamptz)
**Always use:** `timestamptz` (not timestamp), `jsonb` (not json), `text` (not varchar unless constrained)

---

## Schema Maintenance

### When Adding Feeds
1. Insert into `feed_registry`
2. Add compliance rule to `feed_compliance_rules`
3. Set `max_chars = 5000`, `allow_full_text = false`

### When Modifying Schema
1. Create migration in `/migrations/`
2. Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
3. Test on TEST before PROD
4. Update this doc

---

**Update When:** Schema changes, new tables, column additions

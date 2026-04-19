# TrumpyTracker Database Schema

**Last Updated:** 2026-04-15
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

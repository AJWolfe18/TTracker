# TrumpyTracker Database Schema

**Last Updated:** 2026-01-12
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

## Supporting Tables

### `executive_orders`
**Purpose:** Presidential executive order tracking

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| order_number | VARCHAR | EO number (e.g., "14343") |
| date | DATE | Signing date |
| title | TEXT | Order title |
| summary | TEXT | AI summary |
| category | VARCHAR | Policy category |
| severity_rating | VARCHAR | Impact level |
| source_url | TEXT | Federal Register URL |
| spicy_summary | TEXT | Engaging summary |

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

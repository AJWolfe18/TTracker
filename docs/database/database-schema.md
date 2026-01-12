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

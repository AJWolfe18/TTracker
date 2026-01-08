# TrumpyTracker Database Schema Documentation

**Last Updated:** October 2, 2025  
**Status:** Migration in progress - TEST (RSS system) vs PROD (legacy system)

---

## Overview

TrumpyTracker uses Supabase (PostgreSQL) with different schemas in TEST and PROD environments during the RSS migration period.

**TEST Environment:** RSS + Story Clustering architecture (10 tables)  
**PROD Environment:** Legacy article tracking architecture (4 tables)  

**Migration Status:** Backend complete on TEST, frontend QA in progress (TTRC-145)

---

## Environment Comparison

### TEST Database Tables (RSS System)
1. ✨ `stories` - Story aggregation (86 stories)
2. ✨ `articles` - Individual RSS articles (180 articles)
3. ✨ `article_story` - Many-to-many junction (72 mappings)
4. ✨ `feed_registry` - RSS feed management (6 feeds)
5. ✨ `job_queue` - Async job processing (433 jobs)
6. ✨ `budgets` - Cost tracking (3 entries)
7. ✨ `ingest_rejections` - Failed ingestion log
8. 📦 `political_entries` - Legacy table (5 test entries)
9. 🔄 `executive_orders` - EO tracking (190 orders)
10. 🔄 `pending_submissions` - Manual submission queue

### PROD Database Tables (Legacy System)
1. ✅ `political_entries` - Main entries table (717 entries)
2. ✅ `executive_orders` - EO tracking (204 orders)
3. ✅ `pending_submissions` - Manual submission queue
4. ✅ `audit_log` - Audit trail

**Legend:**
- ✨ New RSS tables (TEST only)
- 📦 Legacy tables (minimal in TEST, active in PROD)
- 🔄 Shared tables (exist in both environments)

---

## TEST Environment Schema (RSS System)

### `stories` Table
**Purpose:** Aggregate related articles into coherent stories  
**Row Count:** 86 stories  
**RLS Enabled:** Yes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique story ID |
| story_hash | TEXT | UNIQUE, NOT NULL | Hash of primary headline for deduplication |
| primary_headline | TEXT | NOT NULL | Main headline for the story |
| primary_source | TEXT | NULLABLE | Source name of primary article |
| primary_source_url | TEXT | NULLABLE | URL of primary article |
| primary_source_domain | TEXT | NULLABLE | Domain of primary source |
| primary_actor | TEXT | NULLABLE | Main person/org in story |
| first_seen_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When story first created |
| last_updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last article added |
| status | TEXT | CHECK IN ('active', 'closed', 'archived'), DEFAULT 'active' | Story lifecycle status |
| closed_at | TIMESTAMPTZ | NULLABLE | When story closed (no new articles) |
| reopen_count | INTEGER | DEFAULT 0 | Times story reopened |
| severity | TEXT | CHECK IN ('critical', 'severe', 'moderate', 'minor'), NULLABLE | Impact severity |
| topic_tags | TEXT[] | NULLABLE | Array of topic tags |
| source_count | INTEGER | DEFAULT 1 | Number of sources covering story |
| summary_neutral | TEXT | NULLABLE | Factual AI summary |
| summary_spicy | TEXT | NULLABLE | Engaging AI summary |
| has_opinion | BOOLEAN | DEFAULT FALSE | Contains opinion pieces |
| last_enriched_at | TIMESTAMPTZ | NULLABLE | When AI enrichment last ran |
| search_vector | TSVECTOR | GENERATED | Full-text search index |
| confidence_score | NUMERIC | DEFAULT 0.5 | Clustering confidence |
| category | TEXT | NULLABLE | Story category |
| severity_level | INTEGER | DEFAULT 5 | Numeric severity (1-10) |
| headline | TEXT | NULLABLE | Alternative headline field |

**Indexes:**
- PRIMARY KEY on `id`
- UNIQUE on `story_hash`
- Generated index on `search_vector` (for full-text search)

---

### `articles` Table
**Purpose:** Store individual RSS articles from feeds  
**Row Count:** 180 articles  
**RLS Enabled:** Yes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY, DEFAULT 'art-' || gen_random_uuid() | Unique article ID |
| url | TEXT | NOT NULL | Article URL |
| url_hash | TEXT | NOT NULL | Hash of URL for deduplication |
| title | TEXT | NOT NULL | Article headline |
| source_name | TEXT | NULLABLE | Publication name |
| source_domain | TEXT | NULLABLE | Domain of source |
| published_at | TIMESTAMPTZ | DEFAULT NOW() | When article published |
| fetched_at | TIMESTAMPTZ | DEFAULT NOW() | When RSS feed fetched |
| content | TEXT | NULLABLE | Article full text |
| content_type | TEXT | CHECK IN ('news_report', 'opinion', 'analysis', 'editorial'), DEFAULT 'news_report' | Content classification |
| opinion_flag | BOOLEAN | DEFAULT FALSE | Is this an opinion piece |
| metadata | JSONB | DEFAULT '{}' | Additional metadata |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Database creation time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |
| published_date | DATE | GENERATED | Date portion of published_at |
| url_canonical | TEXT | NULLABLE | Canonical URL (if different) |
| primary_actor | TEXT | NULLABLE | Main actor extracted from article |
| categories | TEXT[] | NULLABLE | Array of categories |
| excerpt | TEXT | NULLABLE | Article excerpt/description |

**Indexes:**
- PRIMARY KEY on `id`
- Generated column `published_date` for date-based queries

**Deduplication Strategy:**
- Composite unique constraint on `(url_hash, published_date)` 
- Allows same article URL on different days
- Prevents duplicate processing within same day

---

### `article_story` Table
**Purpose:** Many-to-many junction between articles and stories  
**Row Count:** 72 mappings  
**RLS Enabled:** Yes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| article_id | TEXT | PRIMARY KEY, FOREIGN KEY → articles.id | Reference to article |
| story_id | BIGINT | FOREIGN KEY → stories.id, NULLABLE | Reference to story |
| is_primary_source | BOOLEAN | DEFAULT FALSE | Is this the primary article for story |
| similarity_score | NUMERIC | CHECK 0-100 | Match confidence score |
| matched_at | TIMESTAMPTZ | DEFAULT NOW() | When article matched to story |

**Relationships:**
- One article can belong to one story
- One story can have many articles
- Primary source flag identifies which article created the story

---

### `feed_registry` Table
**Purpose:** Manage RSS feeds and their metadata  
**Row Count:** 6 feeds  
**RLS Enabled:** No

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique feed ID |
| feed_url | TEXT | NOT NULL | RSS feed URL |
| feed_name | TEXT | NOT NULL | Human-readable feed name |
| source_name | TEXT | NULLABLE | Publication name |
| topics | TEXT[] | NOT NULL | Array of topics feed covers |
| tier | INTEGER | CHECK 1-3, DEFAULT 2 | Priority tier (1=highest) |
| source_tier | INTEGER | DEFAULT 1 | Source quality tier |
| is_opinion_source | BOOLEAN | DEFAULT FALSE | Does feed contain opinion content |
| etag | TEXT | NULLABLE | HTTP ETag for caching |
| last_modified | TEXT | NULLABLE | HTTP Last-Modified for caching |
| last_fetched | TIMESTAMPTZ | NULLABLE | Deprecated (use last_fetched_at) |
| last_fetched_at | TIMESTAMPTZ | NULLABLE | When feed last fetched |
| last_304_at | TIMESTAMPTZ | NULLABLE | Last 304 Not Modified response |
| failure_count | INTEGER | DEFAULT 0 | Consecutive fetch failures |
| is_active | BOOLEAN | DEFAULT TRUE | Is feed currently processed |

**Feed Tiers:**
- **Tier 1:** Major news (NYT, WaPo, Reuters) - highest priority
- **Tier 2:** Regional/specialized sources - medium priority  
- **Tier 3:** Aggregators/secondary sources - low priority

**HTTP Caching:**
- Uses `etag` and `last_modified` for conditional requests
- Tracks `last_304_at` to skip unchanged feeds
- Reduces bandwidth and processing time

**Failure Handling:**
- Increments `failure_count` on errors
- Feed disabled when `failure_count >= 5`
- Manual reactivation required after fix

---

### `job_queue` Table
**Purpose:** Async job processing queue  
**Row Count:** 433 jobs  
**RLS Enabled:** No

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique job ID |
| type | TEXT | NULLABLE | Legacy job type field |
| job_type | TEXT | NULLABLE | Preferred job type field |
| payload | JSONB | DEFAULT '{}' | Job parameters |
| payload_hash | TEXT | NULLABLE | Hash for idempotency |
| status | TEXT | CHECK IN ('pending', 'processing', 'failed', 'completed', 'done'), DEFAULT 'pending' | Job status |
| attempts | INTEGER | DEFAULT 0 | Retry attempts made |
| max_attempts | INTEGER | DEFAULT 5 | Max retry attempts |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Job creation time |
| run_at | TIMESTAMPTZ | DEFAULT NOW() | When job should run |
| started_at | TIMESTAMPTZ | NULLABLE | When processing started |
| completed_at | TIMESTAMPTZ | NULLABLE | When job completed |
| processed_at | TIMESTAMPTZ | NULLABLE | Legacy completion time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |
| error | TEXT | NULLABLE | Error message (current attempt) |
| last_error | TEXT | NULLABLE | Last error message |
| result | JSONB | NULLABLE | Job result data |

**Job Types:**
- `rss_fetch_feed` - Fetch and parse RSS feed
- `story_enrich` - Enrich story with AI analysis
- `story_cluster` - Update story lifecycle
- `story_archive` - Archive old stories (future)

**Job Flow:**
```
pending → processing → completed
                    → failed → pending (retry)
```

**Idempotency:**
- Uses `payload_hash` to prevent duplicate jobs
- Composite unique constraint on `(job_type, payload_hash)`

---

### `budgets` Table
**Purpose:** Track daily API costs  
**Row Count:** 3 entries  
**RLS Enabled:** No

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| day | DATE | PRIMARY KEY | Budget tracking date |
| cap_usd | NUMERIC | DEFAULT 50.00 | Daily spending cap |
| spent_usd | NUMERIC | DEFAULT 0.00 | Amount spent today |
| openai_calls | INTEGER | DEFAULT 0 | Number of OpenAI API calls |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Last update time |

**Budget Enforcement:**
- Checks `spent_usd < cap_usd` before API calls
- Increments `openai_calls` and `spent_usd` after each call
- Prevents runaway costs from bugs or loops

---

### `ingest_rejections` Table
**Purpose:** Log articles rejected during RSS ingestion  
**Row Count:** 0 (newly created)  
**RLS Enabled:** No

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | BIGINT | PRIMARY KEY, AUTO INCREMENT | Unique rejection ID |
| url | TEXT | NOT NULL | Article URL that was rejected |
| feed_id | BIGINT | NULLABLE | Which feed article came from |
| reason | TEXT | NULLABLE | Why article was rejected |
| error_details | JSONB | NULLABLE | Additional error context |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | When rejection occurred |

**Common Rejection Reasons:**
- Duplicate URL within same day
- Article too old (> 7 days)
- URL malformed or unreachable
- Content type excluded (ads, sponsored)
- Failed parsing

---

### `political_entries` Table (TEST)
**Purpose:** Legacy table for testing backward compatibility  
**Row Count:** 5 test entries  
**RLS Enabled:** No  
**Status:** DEPRECATED - "READ-ONLY" per table comment

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| title | TEXT | Entry title |
| url | TEXT | Source URL |
| url_hash | TEXT | URL hash for deduplication |
| url_canonical | TEXT | Canonical URL |
| source | TEXT | Source name |
| source_domain | TEXT | Source domain |
| source_name | TEXT | Formatted source name |
| category | TEXT | Entry category |
| severity_level | INTEGER | Numeric severity |
| content_type | TEXT | Type of content |
| excerpt | TEXT | Article excerpt |
| published_at | TIMESTAMPTZ | Publication timestamp |
| published_date | DATE | GENERATED from published_at |
| created_at | TIMESTAMPTZ | Creation timestamp |
| updated_at | TIMESTAMPTZ | Update timestamp |
| processed | BOOLEAN | Processing status |

**Note:** Minimal test data only. New articles go to `articles` table.

---

## PROD Environment Schema (Legacy System)

### `political_entries` Table (PROD)
**Purpose:** Main table for political accountability tracking  
**Row Count:** 717 active entries  
**RLS Enabled:** Yes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | VARCHAR | PRIMARY KEY | Unique entry ID |
| date | DATE | NOT NULL | Date of political event |
| actor | VARCHAR | NULLABLE | Person or organization |
| category | VARCHAR | NULLABLE | Entry category |
| title | TEXT | NOT NULL | Entry headline |
| description | TEXT | NULLABLE | Event description |
| source | TEXT | NULLABLE | Source name |
| source_url | TEXT | NULLABLE | URL to original source |
| severity | VARCHAR | CHECK IN ('critical', 'high', 'medium', 'low'), NULLABLE | Impact severity |
| status | VARCHAR | DEFAULT 'published' | Entry status |
| verified | BOOLEAN | DEFAULT FALSE | Source verification status |
| archived | BOOLEAN | DEFAULT FALSE | Archive status |
| archived_at | TIMESTAMPTZ | NULLABLE | When archived |
| archive_reason | TEXT | NULLABLE | Why archived |
| manual_submission | BOOLEAN | DEFAULT FALSE | Manually submitted |
| submitted_by | VARCHAR | NULLABLE | Who submitted |
| processed_at | TIMESTAMPTZ | NULLABLE | Processing timestamp |
| added_at | TIMESTAMPTZ | DEFAULT NOW() | Addition timestamp |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Update timestamp |
| editorial_summary | TEXT | NULLABLE | AI summary |
| spicy_summary | TEXT | NULLABLE | Engaging summary |
| shareable_hook | VARCHAR | NULLABLE | Social media hook |
| severity_label_inapp | VARCHAR | NULLABLE | Display label |
| severity_label_share | VARCHAR | NULLABLE | Share label |

**Severity System:**
- `critical` - Democracy/constitutional threats
- `high` - Criminal activity, major corruption
- `medium` - Standard corruption, policy violations
- `low` - Incompetence, minor issues

---

### `executive_orders` Table (Shared)
**Purpose:** Track presidential executive orders  
**Row Count:** 190 (TEST), 204 (PROD)  
**RLS Enabled:** Yes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | VARCHAR/INTEGER | PRIMARY KEY | Unique order ID |
| order_number | VARCHAR | UNIQUE/NULLABLE | EO number (e.g., "14343") |
| date | DATE | NOT NULL | Order signing date |
| title | TEXT | NOT NULL | Order title |
| summary | TEXT | NULLABLE | AI-generated summary |
| category | VARCHAR | NULLABLE | Policy category |
| severity_rating | VARCHAR | CHECK IN ('critical', 'high', 'medium', 'low'), NULLABLE | Impact severity |
| policy_direction | VARCHAR | NULLABLE | expand/restrict/modify/create |
| implementation_timeline | VARCHAR | NULLABLE | immediate/30_days/90_days |
| implementation_status | VARCHAR | NULLABLE | issued/active/revoked |
| agencies_affected | TEXT[] | NULLABLE | Affected agencies |
| impact_areas | TEXT[] | NULLABLE | Policy areas affected |
| impact_score | INTEGER | NULLABLE | Impact rating 0-100 |
| source_url | TEXT | NULLABLE | Federal Register URL |
| pdf_url | TEXT | NULLABLE | PDF document URL |
| citation | VARCHAR | NULLABLE | Official citation |
| publication_date | DATE | NULLABLE | Federal Register pub date |
| document_number | VARCHAR | NULLABLE | Federal Register doc number |
| source | VARCHAR | NULLABLE | Data source |
| type | VARCHAR | DEFAULT 'executive_order' | Document type |
| verified | BOOLEAN | DEFAULT TRUE | Verification status |
| full_text_available | BOOLEAN | DEFAULT TRUE | Full text available |
| legal_challenges | JSONB/TEXT[] | DEFAULT '[]' | Legal challenges |
| related_orders | TEXT[] | NULLABLE | Related order numbers |
| archived | BOOLEAN | DEFAULT FALSE | Archive status |
| added_at | TIMESTAMPTZ | DEFAULT NOW() | Addition timestamp |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Update timestamp |
| spicy_summary | TEXT | NULLABLE | Engaging summary |
| shareable_hook | VARCHAR | NULLABLE | Social media hook |
| severity_label_inapp | VARCHAR | NULLABLE | Display label |
| severity_label_share | VARCHAR | NULLABLE | Share label |
| eo_impact_type | VARCHAR | NULLABLE | EO-specific category |

**Note:** Schema differs slightly between TEST (integer ID) and PROD (varchar ID)

---

### `pending_submissions` Table (Shared)
**Purpose:** Queue for manually submitted articles  
**Row Count:** 0 in both environments  
**RLS Enabled:** Yes (PROD), No (TEST)

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique submission ID |
| url | TEXT | NOT NULL | Article URL |
| submitted_at | TIMESTAMPTZ | DEFAULT NOW() | Submission time |
| submitted_by | VARCHAR | NULLABLE | Submitter identifier |
| processed | BOOLEAN | DEFAULT FALSE | Processing status |
| processed_at | TIMESTAMPTZ | NULLABLE | Processing completion time |
| error_message | TEXT | NULLABLE | Error if processing failed |
| result_id | VARCHAR | NULLABLE | Created entry ID |

---

### `audit_log` Table (Shared)
**Purpose:** Audit trail for all data modifications  
**Row Count:** 0 in both environments  
**RLS Enabled:** No

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique log entry ID |
| table_name | VARCHAR | NOT NULL | Which table was modified |
| record_id | VARCHAR | NOT NULL | ID of modified record |
| action | VARCHAR | NOT NULL | INSERT/UPDATE/DELETE |
| old_data | JSONB | NULLABLE | Data before change |
| new_data | JSONB | NULLABLE | Data after change |
| user_id | VARCHAR | NULLABLE | Who made change |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | When change occurred |

---

## Migration Strategy

### Phase 1: Backend Migration (✅ COMPLETE)
- Created `stories`, `articles`, `job_queue`, `feed_registry` tables
- RSS ingestion working on TEST
- Story clustering functional
- Job queue processing stable

### Phase 2: Frontend Migration (🔄 IN PROGRESS - TTRC-145)
- Story view component created
- QA testing in progress
- Pending approval for production deployment

### Phase 3: Production Cutover (⏳ PENDING)
- Deploy RSS system to PROD
- Cherry-pick tested commits from TEST
- Keep `political_entries` read-only for historical data
- Deprecate GitHub Actions daily-tracker

### Phase 4: Cleanup (⏳ FUTURE)
- Archive old `political_entries` data
- Remove legacy GitHub Actions workflows
- Consolidate schema between TEST and PROD

---

## Key Differences: TEST vs PROD

| Feature | TEST | PROD |
|---------|------|------|
| **Data Model** | Story-based (stories + articles) | Entry-based (political_entries) |
| **RSS System** | ✅ Active (6 feeds, 180 articles) | ❌ Not deployed |
| **Job Queue** | ✅ Active (433 jobs processed) | ❌ Not present |
| **Feed Management** | ✅ feed_registry table | ❌ Not present |
| **Main Content** | 86 stories from RSS | 717 individual entries |
| **Processing** | Async via job_queue | Sync via GitHub Actions |
| **Deduplication** | URL hash + story clustering | Manual/minimal |

---

## Database Maintenance

### Daily Tasks
- Monitor `job_queue` for failed jobs
- Check `budgets` table for cost overruns
- Review `ingest_rejections` for patterns

### Weekly Tasks
- Archive closed stories older than 7 days
- Clean up completed jobs from `job_queue`
- Review `feed_registry` failure counts

### Monthly Tasks
- Archive `political_entries` older than 60 days (PROD)
- Analyze story clustering effectiveness
- Review and adjust feed tiers

---

## Common Queries

### Get Active Stories (TEST)
```sql
SELECT * FROM stories 
WHERE status = 'active' 
ORDER BY last_updated_at DESC 
LIMIT 20;
```

### Get Political Entries (PROD)
```sql
SELECT * FROM political_entries 
WHERE archived = false 
ORDER BY date DESC 
LIMIT 20;
```

### Check Job Queue Health
```sql
SELECT 
  status,
  COUNT(*) as count,
  MAX(created_at) as most_recent
FROM job_queue
GROUP BY status;
```

### Monitor Daily Costs
```sql
SELECT 
  day,
  spent_usd,
  openai_calls,
  (spent_usd / cap_usd * 100) as percent_of_budget
FROM budgets
ORDER BY day DESC;
```

---

*Document Generated: October 2, 2025*  
*Schema Version: TEST=3.0 (RSS), PROD=2.0 (Legacy)*  
*Next Review: After TTRC-145 completion*

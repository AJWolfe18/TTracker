# TrumpyTracker Technical Architecture

## Overview

TrumpyTracker is a serverless, event-driven political accountability tracking system built on RSS ingestion with automated story clustering, AI-powered content enrichment, and a job queue architecture for scalable processing.

**Current Status:** Migration from individual article tracking to story-based aggregation  
**TEST Environment:** RSS + Story Clustering (active)  
**PROD Environment:** Legacy article system (temporary - pending frontend deployment)

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Job Scheduler │  │Daily Tracker │  │  EO Tracker  │      │
│  │(Every 2h/1h) │  │   (9am EST)  │  │  (10am EST)  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          │ Triggers         │ (Legacy)         │ (Legacy)
          ▼                  ▼                  ▼
    ┌─────────────────────────────────────────────────┐
    │          Supabase Edge Functions                 │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │ rss-enqueue  │  │   stories-active     │    │
    │  │queue-stats   │  │   stories-detail     │    │
    │  └──────┬───────┘  └──────────────────────┘    │
    └─────────┼─────────────────────────────────────────┘
              │
              │ Creates jobs
              ▼
    ┌─────────────────────────────────────────────────┐
    │            Job Queue System                      │
    │  Postgres-based queue with idempotency          │
    │  ┌────────────────────────────────────┐         │
    │  │ job_type | payload | run_at | ...  │         │
    │  │ rss_fetch_feed | {feed_id} | ...   │         │
    │  │ story_enrich | {story_id} | ...    │         │
    │  │ story_cluster | {story_id} | ...   │         │
    │  └────────────────────────────────────┘         │
    └─────────┬─────────────────────────────────────────┘
              │
              │ Polls for jobs
              ▼
    ┌─────────────────────────────────────────────────┐
    │           Job Queue Worker (Node.js)             │
    │  ┌─────────────────────────────────────┐        │
    │  │ RSS Feed Fetching (Tiered: T1/T2/T3)│        │
    │  │ Story Enrichment (OpenAI GPT-4)     │        │
    │  │ Story Clustering & Lifecycle        │        │
    │  └─────────────────────────────────────┘        │
    └─────────┬─────────────────────────────────────────┘
              │
              │ Writes results
              ▼
    ┌─────────────────────────────────────────────────┐
    │            Supabase Database                     │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │   Stories    │  │  Political Entries   │    │
    │  │   Articles   │  │  Executive Orders    │    │
    │  │  Job Queue   │  │  Feed Registry       │    │
    │  └──────────────┘  └──────────────────────┘    │
    └─────────┬─────────────────────────────────────────┘
              │
              │ API calls
              ▼
    ┌─────────────────────────────────────────────────┐
    │             Netlify Static Hosting               │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │  Production  │  │  Test Environment    │    │
    │  │   (main)     │  │     (test)           │    │
    │  │  Old System  │  │  RSS System          │    │
    │  └──────────────┘  └──────────────────────┘    │
    └─────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Trigger Layer (GitHub Actions)

**Job Scheduler Action**
- **Schedule:** Every 1-2 hours
- **Purpose:** Triggers RSS feed processing via Edge Function
- **Process:** Calls `rss-enqueue` Edge Function to create feed fetch jobs
- **Cost:** Free tier (minimal minutes used per trigger)

**Daily Tracker (Legacy - PROD only)**
- Searches for political news via OpenAI
- Writes directly to `political_entries` table
- Will be deprecated after frontend migration

**Executive Orders Tracker (Legacy - PROD only)**
- Monitors Federal Register
- Writes to `executive_orders` table  
- Will be deprecated after frontend migration

### 2. Edge Functions Layer (Supabase Deno)

**rss-enqueue** (Trigger Handler)
- **Purpose:** Creates RSS fetch jobs for all active feeds
- **Trigger:** GitHub Actions cron (every 1-2 hours) OR manual invoke
- **Input:** `{"kind": "fetch_all_feeds"}` or `{"kind": "lifecycle"}`
- **Output:** Jobs added to `job_queue` table via `enqueue_fetch_job()` RPC
- **Features:**
  - Tiered feed processing (T1 → T2 → T3)
  - Deduplication via payload hash
  - Lifecycle state management jobs
- **Auth:** Protected by EDGE_CRON_TOKEN

**stories-active** (Frontend API)
- **Purpose:** Returns active stories with pagination for dashboard
- **Method:** GET
- **Query Params:** `limit` (default 20), `cursor` (pagination token)
- **Response:** Array of story summaries with metadata
- **Features:**
  - Cursor-based pagination (timestamp + id)
  - Status filter (active only)
  - Ordered by last_updated_at DESC

**stories-detail** (Frontend API)
- **Purpose:** Returns full story details with all linked articles
- **Method:** GET
- **Path Param:** `/story_id`
- **Response:** Story object with articles array, timeline, enrichment
- **Features:** Article sources with similarity scores, primary source flagging

**stories-search** (Frontend API)
- **Purpose:** Full-text search across stories using PostgreSQL tsvector
- **Method:** GET
- **Query Params:** `q` (search query), `limit`, `cursor`
- **Features:**
  - Searches headline + summary + actors
  - Ranked by relevance
  - Same pagination as stories-active

**articles-manual** (Admin Tool)
- **Purpose:** Manual article submission endpoint
- **Method:** POST
- **Body:** `{"url": "https://..."}`
- **Process:** Scrapes article → Creates story → Enriches
- **Auth:** Requires service role key

**queue-stats** (Monitoring)
- **Purpose:** Job queue health metrics for admin dashboard
- **Method:** GET
- **Response:** Job counts by type/status, stuck job detection
- **Features:**
  - Aggregates by job_type and status
  - Detects jobs stuck >10 minutes
  - Optional RPC fallback if `get_queue_stats()` exists
- **Auth:** Optional EDGE_CRON_TOKEN protection

### 3. Job Queue System (Postgres)

**Architecture:**
- Postgres-based queue using `job_queue` table
- Idempotency via composite unique constraints
- Priority-based processing (T1/T2/T3 feeds)
- Automatic cleanup of old completed jobs

**Job Types:**
- `rss_fetch_feed` - Fetch and parse RSS feed
- `story_enrich` - Enrich story with OpenAI analysis
- `story_cluster` - Update story lifecycle and clustering
- `story_archive` - Archive old stories (future)

**Status Flow:**
```
pending → processing → completed
                    → failed → pending (retry)
```

### 4. Worker Layer (Node.js v22)

**Location:** `scripts/job-queue-worker.js`
**Runtime:** Node.js ESM module (package.json: "type": "module")
**Clients:** Supabase (service role), OpenAI (GPT-4o-mini)

**Job Processing Loop:**
1. Poll `job_queue` table every 5s (configurable via WORKER_POLL_INTERVAL_MS)
2. Claim jobs atomically via `claim_runnable_job()` RPC
3. Execute job handler based on `job_type`
4. Update job status (completed/failed)
5. Retry failed jobs with exponential backoff (max 3 retries)

**RSS Feed Fetching** (`handleFetchFeed`)
- **Job Type:** `fetch_feed`
- **Process:**
  1. Fetch RSS feed via HTTP (with etag/last-modified caching)
  2. Parse XML using `rss-parser` library
  3. Extract articles with deduplication (url_hash + published_date)
  4. Call `attach_or_create_article()` RPC for each article
  5. Create `story.cluster` jobs for new articles
  6. Handle HTTP 304 (Not Modified) efficiently
  7. Track feed failures (disable after 5 consecutive failures)
- **Timeout:** 15s per feed
- **Error Handling:** Increments `failure_count` in feed_registry

**Story Enrichment** (`enrichStory` - lines 377-536)
- **Job Type:** `story.enrich`
- **Process:**
  1. **Cooldown Check:** Skip if enriched <12 hours ago (prevents cost spam)
  2. **Article Fetch:** Get up to 6 linked articles via `fetchStoryArticles()`
  3. **Context Building:** Extract titles, sources, excerpts (~300 chars each)
  4. **OpenAI Call:** Send to GPT-4o-mini with JSON mode
  5. **Parse Response:** Extract summary_neutral, summary_spicy, category, severity, entities
  6. **Update Story:** Write enrichment results to stories table
  7. **Cost Tracking:** Log token usage and cost (~$0.0002/story)
- **Model:** gpt-4o-mini
- **Input:** ~300 tokens (6 articles × 50 tokens)
- **Output:** ~100 tokens (summaries + metadata)
- **Category Mapping:** UI labels → DB enum (11 categories)
- **Entity Extraction (TTRC-235):** Canonical IDs with confidence scores

**Story Clustering** (`story.cluster.*`)
- **Job Types:** `story.cluster`, `story.cluster.batch`
- **Algorithm:**
  1. Extract primary_actor from article headline
  2. Calculate similarity scores vs existing active stories
  3. Match thresholds: >80% auto-match, 60-80% review, <60% new story
  4. Create story_hash from primary_headline (prevents duplicates)
- **Deduplication:** UNIQUE constraint on story_hash

**Story Lifecycle** (`story.lifecycle`)
- **Job Type:** `story.lifecycle`
- **Trigger:** GitHub Actions cron (daily)
- **Process:**
  - Active → Closed (72+ hours since last_updated_at)
  - Closed → Archived (90+ days, future)
- **RPC:** `updateLifecycleStates()`

**Configuration (Environment Variables):**
- `WORKER_POLL_INTERVAL_MS` - Poll frequency (default: 5000ms)
- `WORKER_MAX_CONCURRENT` - Parallel jobs (default: 2)
- `WORKER_RATE_LIMIT_MS` - Delay between jobs (default: 500ms)
- `WORKER_MAX_RETRIES` - Retry attempts (default: 3)
- `WORKER_BACKOFF_BASE_MS` - Backoff multiplier (default: 2000ms)

### 5. Database Layer (Supabase PostgreSQL)

**Core Tables:**

```sql
stories
├── id (UUID PRIMARY KEY)
├── title (TEXT)
├── summary (TEXT)
├── spicy_summary (TEXT)
├── category (TEXT)
├── severity (TEXT)
├── status (TEXT - active/archived)
├── article_count (INTEGER)
├── published_at (TIMESTAMP)
├── enriched_at (TIMESTAMP)
└── created_at (TIMESTAMP)

articles  
├── id (UUID PRIMARY KEY)
├── story_id (UUID REFERENCES stories)
├── feed_id (UUID REFERENCES feed_registry)
├── url (TEXT)
├── title (TEXT)
├── description (TEXT)
├── published_at (TIMESTAMP)
└── created_at (TIMESTAMP)

job_queue
├── id (UUID PRIMARY KEY)
├── job_type (TEXT)
├── payload (JSONB)
├── status (TEXT - pending/processing/completed/failed)
├── run_at (TIMESTAMP)
├── processed_at (TIMESTAMP)
├── error_message (TEXT)
└── created_at (TIMESTAMP)

feed_registry
├── id (UUID PRIMARY KEY)
├── url (TEXT UNIQUE)
├── name (TEXT)
├── tier (INTEGER - 1/2/3)
├── category (TEXT)
├── status (TEXT - active/failed)
├── last_fetched_at (TIMESTAMP)
└── created_at (TIMESTAMP)

political_entries (Legacy - PROD only)
├── id (SERIAL PRIMARY KEY)
├── date, actor, category, title...
└── (retained for backward compatibility)
```

**Indexes:**
- `story_published_at_idx` (published_at DESC)
- `article_story_id_idx` (story_id)
- `job_queue_status_run_at_idx` (status, run_at)
- `feed_registry_tier_status_idx` (tier, status)

### 6. Frontend Layer (Netlify)

**Story Dashboard** (TEST environment)
- Displays stories in card format
- Filters by category, severity, date
- "Load More" pagination
- Modal view for story details with sources

**Legacy Dashboard** (PROD environment)
- Displays individual political entries
- Will be replaced after TTRC-145 QA approval

**Admin Panel**
- Manual article submission
- Queue monitoring
- Feed management (future)

---

## Data Flow

### RSS Ingestion Flow

1. **Trigger:** GitHub Action runs on schedule (every 1-2 hours)
2. **Enqueue:** Action calls `rss-enqueue` Edge Function
3. **Job Creation:** Edge Function creates `rss_fetch_feed` jobs for all active feeds (T1, then T2, then T3)
4. **Worker Polling:** Worker polls `job_queue` for pending jobs
5. **Feed Processing:** Worker fetches RSS feed, parses articles
6. **Story Creation/Update:** Worker creates new stories or adds articles to existing stories
7. **Enrichment Job:** Worker creates `story_enrich` job for new stories
8. **OpenAI Analysis:** Worker enriches story with AI-generated summaries
9. **Frontend Display:** Stories appear on dashboard via `stories-active` API

### Story Clustering Logic

**Creating New Stories:**
- Article published in last 48 hours → Check for matching story by title similarity
- No match → Create new story
- Match found → Add article to existing story

**Story Lifecycle:**
- **Active:** Story has recent articles (< 7 days old)
- **Archived:** No new articles in 7+ days
- **Deleted:** Manual removal or duplicate cleanup

### Tiered Feed Processing

**Tier 1 (High Priority):** Major news outlets (NYT, WaPo, Reuters)  
**Tier 2 (Medium Priority):** Regional and specialized sources  
**Tier 3 (Low Priority):** Aggregators and secondary sources  

Processing order: T1 → T2 → T3 to prioritize authoritative sources

---

## Migration Status

### TEST Environment (Active)
- **Branch:** `test`
- **URL:** https://test--taupe-capybara-0ff2ed.netlify.app/
- **System:** RSS + Story Clustering
- **Database:** TEST Supabase instance
- **Status:** Ready for production deployment (pending TTRC-145 QA)

### PROD Environment (Legacy)
- **Branch:** `main`  
- **URL:** https://trumpytracker.com
- **System:** GitHub Actions → OpenAI → political_entries
- **Database:** PROD Supabase instance
- **Status:** Active, will be replaced after frontend QA approval

### Migration Plan
1. ✅ Backend RSS system complete (TEST)
2. ✅ Story clustering working (TEST)
3. 🔄 Frontend QA in progress (TTRC-145)
4. ⏳ Cherry-pick tested commits to main
5. ⏳ Deploy to production
6. ⏳ Deprecate legacy GitHub Actions trackers

---

## Security Architecture

### Authentication & Authorization
- **Public Access:** Read-only via Supabase anon key
- **Edge Functions:** Protected by Supabase auth
- **Worker:** Uses service role key for database writes
- **Admin Panel:** Service role key (no user auth currently)

### Data Protection
- RLS policies enforce read/write permissions
- No PII collection or storage
- All data from public RSS feeds
- HTTPS everywhere (Netlify, Supabase)

### Rate Limiting
- OpenAI API: Built-in rate limiting
- Supabase: Free tier limits enforced
- GitHub Actions: 2000 minutes/month
- Worker: Configurable job polling interval

---

## Performance Optimizations

### Database
- Composite indexes on frequently queried columns
- Story lifecycle management (auto-archive old stories)
- Job queue cleanup (delete jobs > 7 days old)
- Cursor-based pagination (no OFFSET)

### Worker
- Batch processing of feed fetch jobs
- Concurrent job execution (configurable workers)
- Error retry with exponential backoff
- Idempotency to prevent duplicate work

### Frontend
- Client-side caching (localStorage)
- Lazy loading with "Load More" pagination
- Debounced search/filter inputs
- Minimal API calls

---

## Monitoring & Observability

### Health Checks
- `queue-stats` Edge Function - job queue metrics
- Worker logs - processing status
- Database connection monitoring
- Feed fetch success rate

### Logging
- GitHub Actions - trigger logs
- Worker - processing logs (job completion, errors)
- Supabase - database logs
- Netlify - deployment logs

### Metrics Tracked
- Stories created per day
- Articles ingested per feed
- Job processing time
- OpenAI API costs
- Feed failure rates

---

## Cost Structure

**Current:** ~$20/month  
**Breakdown:**
- **Supabase:** $0 (free tier - 500MB database, 2GB bandwidth)
- **Netlify:** $0 (free tier - 100GB bandwidth)
- **GitHub Actions:** $0 (free tier - 2000 minutes/month)
- **OpenAI API:** ~$20/month (story enrichment calls)

**Scaling Costs:**
- Each 1000 stories/month ≈ $5-10 OpenAI
- Supabase Pro ($25/month) needed at ~8GB database size
- Netlify Pro ($19/month) needed at ~400GB bandwidth

---

## Technology Decisions

### Why RSS + Story Clustering?
- **Cost Reduction:** 50% less than individual article processing
- **Deduplication:** Eliminates 40% of duplicate content
- **Source Diversity:** Multiple sources per story
- **Scalability:** Worker can handle 100+ feeds

### Why Job Queue Architecture?
- **Async Processing:** Decouples triggering from execution
- **Retry Logic:** Automatic retry of failed jobs
- **Priority Scheduling:** Process important feeds first
- **Idempotency:** Safe to retry without duplicates

### Why Supabase Edge Functions?
- **Serverless:** No server management
- **Fast Response:** Low latency for API calls
- **Direct Database Access:** No additional authentication layer
- **Cost Effective:** Free tier generous for current usage

### Why GitHub Actions for Triggers?
- **Free Scheduling:** Built-in cron functionality
- **Simple Integration:** Native GitHub integration
- **Low Resource Use:** Only triggers, doesn't process
- **Reliable:** High availability

---

## Future Architecture Considerations

### Potential Enhancements
- **Real-time Updates:** WebSocket connections for live story updates
- **Advanced Clustering:** ML-based story grouping
- **User Personalization:** Custom feed preferences
- **Mobile Apps:** React Native iOS/Android apps
- **Search:** Full-text search with Postgres tsvector or Elasticsearch
- **Analytics:** User engagement tracking

### Scaling Path
1. **Phase 1** (Current): RSS + Job Queue + Worker
2. **Phase 2**: Multiple workers for parallel processing
3. **Phase 3**: Redis cache layer for hot data
4. **Phase 4**: Dedicated API server (replace Edge Functions if needed)
5. **Phase 5**: Microservices (separate services for fetch/enrich/cluster)

---

## Disaster Recovery

### Backup Strategy
- **Daily Database Backups:** Supabase automated backups
- **GitHub Code History:** All code versioned in git
- **Worker Idempotency:** Safe to replay jobs from backup
- **RSS Replay:** Can re-fetch feeds if data lost

### Recovery Procedures
1. **Database Corruption:** Restore from Supabase backup (last 7 days)
2. **Worker Failure:** Restart worker, jobs auto-retry
3. **Data Loss:** Re-run RSS fetch jobs for last 7 days
4. **API Failure:** Fallback to direct database queries

---

*Last Updated: October 2, 2025*  
*Version: 3.0 (RSS + Story Clustering)*  
*Status: TEST environment active, PROD migration pending*

# RSS Pipeline - Technical Documentation

## Overview
The RSS pipeline is the core system for fetching, processing, and clustering news articles into stories. This document explains the architecture, components, and operational procedures.

## System Architecture

### Data Flow
```
RSS Feeds → Fetch & Parse → Articles → Clustering → Stories → Enrichment → UI
```

### Key Tables
- `feed_registry` - RSS feed configuration
- `job_queue` - Async job processing
- `articles` - Individual news articles (was political_entries)
- `stories` - Clustered story groups
- `story_articles` - Article-to-story mapping

## Core Components

### 1. Feed Fetcher (`scripts/rss/fetch_feed.js`)
- Fetches RSS feeds with conditional GET (304 support)
- Respects ETags and Last-Modified headers
- URL canonicalization and deduplication
- Creates articles via atomic RPC function

### 2. Job Queue Worker (`scripts/job-queue-worker-atomic.js`)
- Claims jobs atomically to prevent race conditions
- Processes fetch_feed and process_article jobs
- Implements exponential backoff for failures
- Automatic timeout handling

### 3. Story Clustering (`scripts/clustering/story-matcher.js`)
- Groups related articles into stories
- Similarity scoring based on:
  - URL match: 30%
  - Title similarity: 40%
  - Date proximity: 15%
  - Actor match: 15%
- Auto-clusters at ≥80% confidence

### 4. Enrichment Pipeline
- Generates neutral and spicy summaries
- Categorizes into 11 political categories
- Assigns severity levels
- Extracts primary actors

## Critical Design Decisions

### The Golden Rule
**`processed_at IS NULL = job is active`**

This single source of truth prevents stuck jobs. Every job completion (success/failure/timeout) MUST set processed_at.

### Why Server-Side RPC Functions
PostgREST limitation: Cannot use multiple `.or()` clauses in a single query. Solution: All complex logic in database functions.

### Partial Unique Index
```sql
CREATE UNIQUE INDEX job_queue_unique_active 
ON job_queue(job_type, payload_hash) 
WHERE processed_at IS NULL;
```
Prevents duplicate active jobs while preserving history.

## Operational Procedures

### Daily Operations

#### Start RSS Pipeline
```bash
# 1. Verify system health
node scripts/preflight-check.js

# 2. Seed fetch jobs (if needed)
node scripts/seed-fetch-jobs.js

# 3. Start worker
node scripts/job-queue-worker-atomic.js
```

#### Monitor Performance
```sql
-- Jobs by status
SELECT status, COUNT(*) 
FROM job_queue 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Articles per feed
SELECT source_domain, COUNT(*) 
FROM articles 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_domain;

-- Story clustering rate
SELECT 
  COUNT(DISTINCT story_id) as stories,
  COUNT(*) as articles,
  ROUND(COUNT(*)::numeric / COUNT(DISTINCT story_id), 1) as articles_per_story
FROM story_articles
WHERE created_at > NOW() - INTERVAL '24 hours';
```

### Troubleshooting

#### Debug Stuck Jobs
```bash
# Diagnose queue state
node scripts/diagnose-job-queue.js

# Reset stuck jobs
psql -c "SELECT reset_stuck_jobs();"
```

#### Feed Issues
```javascript
// Add User-Agent for stubborn feeds
headers: {
  'User-Agent': 'TrumpyTracker/1.0 RSS Reader'
}
```

#### Performance Tuning
- Adjust `WORKER_POLL_INTERVAL_MS` (default: 5000ms)
- Modify `FAILURE_SKIP_THRESHOLD` (default: 5 failures)
- Set `RSS_MAX_BYTES` limit (default: 1.5MB)

## RSS Feeds Configuration

### Currently Active Feeds
| Feed | Source | Status | Success Rate |
|------|--------|--------|--------------|
| NYT Politics | nytimes.com | ✅ Active | 95% |
| WaPo Politics | washingtonpost.com | ✅ Active | 92% |
| Politico | politico.com | ✅ Active | 88% |
| Reuters | reuters.com | ❌ Needs User-Agent | 0% |
| AP News | apnews.com | ❌ DNS Issues | 0% |

### Adding New Feeds
```sql
INSERT INTO feed_registry (
  feed_url, 
  source_name, 
  source_tier,
  check_frequency_minutes,
  is_active
) VALUES (
  'https://example.com/rss',
  'Example News',
  2,
  15,
  true
);
```

## Cost Management

### Current Costs
- OpenAI API: ~$30-35/month
- Supabase: Free tier
- Total: Under $50/month target

### Cost Controls
- Enrich stories, not individual articles (10x savings)
- Skip enrichment for closed stories
- Daily budget caps in place
- Use GPT-3.5-turbo for summaries

## Migrations History

Key migrations for RSS system:
- `001` - RSS tables and schema
- `003` - Atomic article upsert function  
- `014` - Fix claim_next_fetch_job NULL handling
- `015` - Partial unique index for active jobs
- `016` - Ensure processed_at set on completion
- `017` - Server-side counting functions

## Testing Procedures

### Preflight Check
```bash
node scripts/preflight-check.js
```
Validates:
- Database functions exist
- Partial unique index working
- Feed registry populated
- Environment variables set

### End-to-End Test
```bash
# GitHub Actions workflow
.github/workflows/rss-e2e-test.yml
```

### Manual Testing
```bash
# Test single feed
NODE_ENV=test node scripts/rss/fetch_feed.js --url "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"

# Test clustering
NODE_ENV=test node scripts/test-clustering.js
```

## Production Deployment

### From TEST to PROD
1. Run preflight on TEST
2. Export migrations: `PRODUCTION_DEPLOYMENT.sql`
3. Backup PROD database
4. Apply migrations to PROD
5. Deploy code (cherry-pick from test branch)
6. Run preflight on PROD
7. Monitor for 1 hour

### Rollback Procedure
```sql
-- Disable RSS pipeline
UPDATE feed_registry SET is_active = false;

-- Clear job queue
DELETE FROM job_queue WHERE job_type IN ('fetch_feed', 'process_article');

-- Restore from backup if needed
```

## Performance Metrics

### Target SLAs
- Feed fetch: < 15 seconds per feed
- Article processing: < 2 seconds per article
- Clustering decision: < 500ms
- Enrichment: < 5 seconds per story

### Current Performance
- Articles per day: 100-200
- Stories per day: 20-40
- Deduplication rate: 40%
- Clustering accuracy: 85%

## Future Improvements

### Planned Enhancements
1. Smart feed scheduling based on publication patterns
2. Machine learning for clustering thresholds
3. Automatic feed discovery
4. Real-time WebSocket updates

### Technical Debt
1. Add comprehensive logging
2. Implement circuit breakers
3. Create admin UI for feed management
4. Add automated testing suite

## Support Information

For issues:
1. Check `/docs/BREAK_GLASS_RSS_FIX.md`
2. Review recent handoffs in `/docs/handoffs/`
3. Run diagnostic scripts in `/scripts/`

Last Updated: October 2025
System Status: Production Ready (pending TTRC-169 fix)

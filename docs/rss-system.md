# RSS System Documentation

## Overview

TrumpyTracker's RSS system automatically ingests political news from curated feeds, clusters related articles into stories, and enriches them with AI analysis.

## RSS Feed Tiers

### Tier 1 - Critical (Process All)
- Major news networks (CNN, Fox, MSNBC)
- White House official feeds
- Congressional sources
- Max: 100 feeds per run

### Tier 2 - Important (Cap: 50)
- Regional newspapers
- Political blogs
- Think tanks
- Max: 50 feeds per run

### Tier 3 - Nice-to-Have (Cap: 20)
- Opinion sources
- International coverage
- Specialized publications
- Max: 20 feeds per run

## Feed Processing Flow

```
RSS Feed → Fetch & Parse → Deduplicate → Enrich → Cluster → Story
    ↓           ↓              ↓           ↓         ↓        ↓
  Registry   Validation    URL Hash    OpenAI   Similarity  Display
```

## Deduplication Strategy

### URL Hash Composite Key
- NOT globally unique
- Unique per day: `(url_hash, published_at::date)`
- Allows same article on different days
- Prevents duplicate processing

```sql
CREATE UNIQUE INDEX idx_articles_url_date 
ON articles(url_hash, date_trunc('day', published_at));
```

## Story Clustering

### Clustering Algorithm
1. Extract primary_actor from headline
2. Calculate similarity scores
3. Match thresholds:
   - >80%: Auto-match to story
   - 60-80%: Review queue
   - <60%: No match

### Story Lifecycle
- **Active**: 0-72 hours (displayed prominently)
- **Closed**: 72+ hours (archived from main view)
- **Archived**: 90+ days (cold storage)

## Feed Registry

```sql
CREATE TABLE feed_registry (
  feed_url TEXT PRIMARY KEY,
  feed_name TEXT NOT NULL,
  topics TEXT[] NOT NULL,
  tier INTEGER DEFAULT 2,
  etag TEXT,                    -- HTTP caching
  last_modified TEXT,           -- HTTP caching
  last_fetched TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  last_304_at TIMESTAMPTZ       -- Track unchanged feeds
);
```

## HTTP Optimization

### Caching Headers
- Use `If-None-Match` with etag
- Use `If-Modified-Since` with last_modified
- Skip processing on 304 Not Modified

### Failure Handling
- Increment failure_count on errors
- Disable feed after 5 failures
- Exponential backoff on retries

## Content Extraction

### Parser Configuration
```javascript
const parser = new Parser({
  timeout: 15000,              // 15 second timeout
  headers: {
    'User-Agent': 'TrumpyTracker/2.0',
    'Accept': 'application/rss+xml, application/xml'
  },
  maxRedirects: 3
});
```

### Field Mapping
- Title → headline
- Description → excerpt
- Link → article_url
- PubDate → published_at
- Author → metadata.author
- Categories → topic_tags

## Enrichment Pipeline

### 1. Entity Extraction
```javascript
// OpenAI extracts:
- people: ["Donald Trump", "Joe Biden"]
- organizations: ["Congress", "White House"]
- locations: ["Washington DC", "Mar-a-Lago"]
- topics: ["immigration", "economy"]
```

### 2. Summary Generation
- Neutral summary: Facts only, no opinion
- Spicy summary: Engaging, with perspective
- Both limited to 2-3 paragraphs

### 3. Classification
- Category: policy/scandal/election/etc
- Severity: 1-10 scale
- Confidence: 0-100%

## Testing RSS Feeds

### Manual Test
```bash
# Test individual feed
curl -X POST $SUPABASE_URL/functions/v1/rss-enqueue \
  -H "Authorization: Bearer $EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

### Validate Feed
```javascript
// scripts/test/validate-feed.js
import Parser from 'rss-parser';
const parser = new Parser();
const feed = await parser.parseURL('https://example.com/feed');
console.log(feed.title, feed.items.length);
```

## Performance Metrics

### Target SLAs
- Feed fetch: <15 seconds
- Article enrichment: <5 seconds
- Story clustering: <2 seconds
- Total pipeline: <30 seconds per article

### Monitoring
```sql
-- Check processing times
SELECT 
  job_type,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_seconds,
  COUNT(*) as total_jobs
FROM job_queue
WHERE status = 'completed'
GROUP BY job_type;
```

## Common Issues

### Feed Not Processing
1. Check feed_registry.is_active = true
2. Verify failure_count < 5
3. Check RSS feed validity
4. Review job_queue for errors

### Duplicate Articles
1. Verify url_hash generation
2. Check composite unique constraint
3. Review deduplication logic

### Missing Enrichment
1. Check OpenAI API key
2. Verify budget not exceeded
3. Review job_queue errors

## Adding New Feeds

```sql
INSERT INTO feed_registry (
  feed_url, 
  feed_name, 
  topics, 
  tier
) VALUES (
  'https://example.com/politics/feed',
  'Example Politics Feed',
  ARRAY['politics', 'congress'],
  2  -- Tier 2: Important
);
```

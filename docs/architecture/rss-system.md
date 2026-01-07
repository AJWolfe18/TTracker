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

**See: [Clustering & Scoring System](./clustering-scoring.md)** for detailed documentation.

### Overview
Articles are clustered into stories using a **hybrid scoring system** that combines:
- Embedding similarity (45%) - semantic meaning
- Title TF-IDF (25%) - headline similarity
- Entity overlap (12%) - named entities (with stopwords filtered)
- Time decay (10%) - 72h window
- Geography (8%) - location matching

### Key Features
- **Entity Stopwords**: Generic entities (US-TRUMP, ORG-CONGRESS, etc.) contribute 0 to scoring
- **Hard Guardrail**: Requires specific entity OR title match to cluster (prevents "Trump blobs")
- **Precision-first**: Prefer separate stories over false clustering

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

## Story Enrichment (Current Implementation)

### Where Enrichment Happens

**Location:** Node.js Worker (`scripts/job-queue-worker.js`), NOT in Supabase Edge Functions

**Why Worker vs Edge Function:**
- Edge Functions are lightweight HTTP handlers (timeouts, limited dependencies)
- Worker has full Node.js ecosystem, unlimited runtime, local OpenAI client
- Worker handles long-running enrichment jobs with retry logic
- More cost-effective (no per-request charges)

### Enrichment Flow

```
RSS Enqueue (Edge Function)
    ↓ Creates job
job_queue table
    ↓ Worker polls
Node.js Worker
    ├─ enrichStory() method
    │   ├─ 1. Cooldown check (12h)
    │   ├─ 2. Fetch story articles (max 6)
    │   ├─ 3. Build context (~300 chars/article)
    │   ├─ 4. Call OpenAI GPT-4o-mini
    │   ├─ 5. Parse JSON response
    │   ├─ 6. Update stories table
    │   └─ 7. Track cost/tokens
    └─ Result
Stories table updated
```

### Current Input Context

**Per Article (from RSS):**
- Title: Full headline
- Source: Publication name
- Excerpt: RSS `<description>` tag (~200 chars)
  - ⚠️ **Limitation:** RSS feeds only provide 1-2 sentence teasers
  - No full article content available

**Total Context Sent to OpenAI:**
- 6 articles × ~50 tokens each = **~300 input tokens**
- Cost: ~$0.000045 per story

### Current Output

**Fields Generated:**
- `summary_neutral` - Factual 2-3 sentence summary
- `summary_spicy` - Engaging version with perspective
- `category` - One of 11 categories (corruption_scandals, democracy_elections, etc.)
- `severity` - critical | severe | moderate | minor
- `primary_actor` - Main person/organization in story
- `top_entities` - Array of canonical entity IDs (TTRC-235)
- `entity_counter` - JSONB map of entity frequencies

**Category Mapping (UI → Database):**
```javascript
const UI_TO_DB = {
  'Corruption & Scandals': 'corruption_scandals',
  'Democracy & Elections': 'democracy_elections',
  'Policy & Legislation': 'policy_legislation',
  'Justice & Legal': 'justice_legal',
  'Executive Actions': 'executive_actions',
  'Foreign Policy': 'foreign_policy',
  'Corporate & Financial': 'corporate_financial',
  'Civil Liberties': 'civil_liberties',
  'Media & Disinformation': 'media_disinformation',
  'Epstein & Associates': 'epstein_associates',
  'Other': 'other'
};
```

### Enrichment Safeguards

**Cooldown (12 hours):**
- Prevents duplicate enrichment costs
- Stories can only be re-enriched after 12h from `last_enriched_at`
- Returns 429 status if cooldown active

**Budget Protection (Phase 2):**
- Daily budget tracking in `budgets` table
- RPC: `increment_budget(day, cost, calls)`
- Hard stop at $50/day (configurable)

**Error Handling:**
- JSON parse failures logged with raw response
- Missing required fields throw errors (fail fast)
- Failed jobs retry with exponential backoff (max 3 attempts)

### Cost Tracking

**Per Story:**
```javascript
const usage = completion.usage;
const costInput = (usage.prompt_tokens / 1000) * 0.00015;   // GPT-4o-mini
const costOutput = (usage.completion_tokens / 1000) * 0.0006;
const totalCost = costInput + costOutput;  // ~$0.0002/story
```

**Monthly Estimate:**
- 100 stories/day × $0.0002 = $0.02/day
- ~$0.60/month for enrichment
- Well under $50/month budget

### Improvement Opportunities (TTRC-258)

**Problem:** RSS excerpts are too short (~200 chars) for deep analysis

**Solution:** Scrape full articles from allowed domains
- Add `scripts/enrichment/scraper.js` module
- Scrape 2 articles/story from allow-list (CSM, PBS, ProPublica)
- Increase context to ~1200 tokens (4× current)
- Cost increase: $0.0002 → $0.00034 per story (still negligible)

**Benefits:**
- Richer summaries with more context
- Better entity extraction
- More accurate category classification
- Minimal cost increase (<$10/month)

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

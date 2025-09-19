# TrumpyTracker Database Documentation
*Last Updated: September 5, 2025*

## Overview

TrumpyTracker uses Supabase (PostgreSQL) to store all political tracking data. This document provides a complete reference for the database schema, common issues, and best practices.

## Database Tables

### 1. `political_entries`
Stores political news articles and events from daily tracking.
- **Schema**: [political-entries-schema.md](./database/political-entries-schema.md)
- **Primary Key**: `id` (SERIAL - auto-incrementing integer)
- **Collection**: Daily automated via RSS feeds and manual submission
- **Severity**: 4-tier system (critical/high/medium/low) as of Sept 5, 2025

### 2. `executive_orders`  
Stores all Executive Orders from the Federal Register API.
- **Schema**: [executive-orders-schema.md](./database/executive-orders-schema.md)
- **Primary Key**: `id` (TEXT - generated as `eo_timestamp_random`)
- **Collection**: Daily automated at 11am EST via GitHub Actions
- **Severity**: 4-tier system via `severity_rating` field
- **Trump Attribution**: Fixed Sept 5, 2025 - AI now correctly attributes to Trump

### 3. `dashboard_stats` (View)
Aggregated statistics view for the dashboard.
- Combines counts from both tables
- Used by stats display component

### 4. `job_queue`
Background job processing with idempotency.
- **Primary Key**: `id` (BIGSERIAL)
- **Unique**: `(job_type, payload_hash)` for idempotency
- **Status**: pending/processing/completed/failed
- **Job Types**: fetch_feed, fetch_all_feeds, story.summarize, story.classify, story.close_old, story.archive
- **Critical Columns**: job_type (NOT type), run_at (NOT run_after)
- **Idempotency**: GENERATED payload_hash column (SHA256) ensures no duplicates
- **Rate Limiting**: Tiered caps - T1: 100, T2: 50, T3: 20, Global: 50

### 5. `stories`
Clustered political stories from multiple articles.
- **Primary Key**: `id` (BIGINT)
- **Unique**: `story_hash`
- **Status**: active/closed/archived
- **AI Fields**: neutral_summary, spicy_summary (GPT-4 generated)
- **Lifecycle**: Active → Closed (72h) → Archived (90d)
- **Clustering**: Based on primary_actor and similarity scores
- **Confidence**: 0-1 score for story quality

### 6. `articles` (political_entries in RSS system)
Individual news articles from RSS feeds and manual submission.
- **Primary Key**: `id` (TEXT - UUID)
- **Unique**: `(url_hash, published_at)` composite - NOT globally unique
- **Source**: RSS feeds (automated) and manual submission
- **Enrichment**: AI entity extraction via job queue
- **Search**: Full-text search via search_vector (tsvector)

### 7. `article_story`
Links articles to stories (many-to-many junction table).
- **Primary Key**: `article_id` (references political_entries)
- **Foreign Key**: `story_id` (references stories)
- **Similarity**: 0-1 confidence score
- **Matching**: >80% auto-match, 60-80% review queue, <60% no match
- **Primary Source**: Boolean flag for main article in story

### 8. `feed_registry`
RSS feed configuration and monitoring.
- **Primary Key**: `feed_url`
- **Tiers**: 1 (critical), 2 (important), 3 (nice-to-have)
- **Monitoring**: failure_count, last_fetched, etag, last_modified
- **Status**: is_active flag for enable/disable
- **Optimization**: HTTP 304 tracking via last_304_at

### 9. `budgets`
Daily spending tracking for AI costs.
- **Primary Key**: `day` (DATE)
- **Limit**: cap_usd (default $50/day)
- **Tracking**: spent_usd, openai_calls count
- **Alerts**: 70% warn, 90% degrade, 100% stop

### 4. `job_queue`
Background job processing with idempotency.
- **Primary Key**: `id` (BIGSERIAL)
- **Unique**: `(job_type, payload_hash)` for idempotency
- **Status**: pending/processing/completed/failed
- **Job Types**: fetch_feed, story.summarize, story.classify, story.close_old, story.archive
- **Critical Columns**: job_type (not type), run_at (not run_after)

### 5. `stories`
Clustered political stories from multiple articles.
- **Primary Key**: `id` (BIGINT)
- **Unique**: `story_hash`
- **Status**: active/closed/archived
- **AI Fields**: neutral_summary, spicy_summary (GPT-4 generated)
- **Lifecycle**: Active → Closed (72h) → Archived (90d)

### 6. `article_story`
Links articles to stories (many-to-many).
- **Primary Key**: `article_id` (references political_entries)
- **Foreign Key**: `story_id` (references stories)
- **Similarity**: 0-1 confidence score
- **Primary Source**: Boolean flag for main article

### 7. `feed_registry`
RSS feed configuration and monitoring.
- **Primary Key**: `feed_url`
- **Tiers**: 1 (critical), 2 (important), 3 (nice-to-have)
- **Active**: Can disable feeds without deleting
- **Failure Tracking**: Auto-disable after 5 failures
- **Caching**: Uses ETags and Last-Modified headers

## Field Naming Conventions

### Use These Field Names:
- `source_url` - Full URL to source (NOT `source`)
- `summary` - AI-generated summary (NOT `editorial_summary`)
- `description` - Article description/summary
- `spicy_summary` - GPT-5 angry translation

### Deprecated/Removed Fields:
- ❌ `source` - Use `source_url` instead
- ❌ `editorial_summary` - Use `summary` or `description`
- ❌ Manual ID generation - Let database handle it

## Common Integration Issues

### 1. Missing Column Errors (PGRST204)

**Error**: `"Could not find the 'X' column of 'table_name' in the schema cache"`

**Common Causes**:
- Field doesn't exist in database
- Using old field name
- Typo in field name

**Solution**: Check schema documentation, use correct field names

### 2. ID Generation Issues

**Political Entries**: 
- Uses SERIAL (auto-incrementing integer)
- Never manually set the ID
- Let database generate it

**Executive Orders**:
- Uses TEXT with format `eo_timestamp_random`
- Generated in JavaScript before insert
- Must be unique

### 3. Data Type Mismatches

**Arrays**: Use PostgreSQL array notation
```javascript
impact_areas: ['area1', 'area2'] // Correct
impact_areas: 'area1, area2'     // Wrong
```

**Booleans**: Use actual booleans
```javascript
verified: true   // Correct
verified: 'true' // Wrong
```

## Environment Configuration

### Production
```javascript
SUPABASE_URL=https://osjbulmltfpcoldydexg.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
```

### Test Environment
```javascript
SUPABASE_TEST_URL=https://[test-instance].supabase.co
SUPABASE_TEST_ANON_KEY=eyJhbGci...
```

## API Integration Points

### Daily Tracker
- **Script**: `/scripts/daily-tracker-supabase.js`
- **Table**: `political_entries`
- **Frequency**: Daily at 9am & 10am EST

### Executive Orders Tracker
- **Script**: `/scripts/executive-orders-tracker-supabase.js`
- **Table**: `executive_orders`
- **Frequency**: Daily at 11am EST

### Manual Article Processor
- **Script**: `/scripts/manual-article-processor.js`
- **Table**: `political_entries`
- **Trigger**: Manual via admin panel

## Dashboard Data Flow

```
Supabase Tables
    ↓
Dashboard API Calls (24hr cache)
    ↓
React Components
    ├── PoliticalEntryCard
    └── ExecutiveOrderCard
```

### Key Display Fields

**Political Entries**:
- Primary: `spicy_summary || description`
- Metadata: `title`, `date`, `actor`, `severity`

**Executive Orders**:
- Primary: `spicy_summary || summary`
- Metadata: `order_number`, `date`, `category`

## Spicy Summary System

### GPT-5 Integration
- **Models**: gpt-5-mini (default), gpt-5 (critical)
- **Cost**: $1.25/1M input, $10/1M output (GPT-5); $0.25/1M input, $2/1M output (GPT-5-mini)
- **Monthly Cost**: ~$2-3 at current volume
- **Fields Generated**:
  - `spicy_summary` - Main angry translation
  - `shareable_hook` - Social media text (280 char limit)
  - `severity_label_inapp` - In-app display with emoji
  - `severity_label_share` - Clean social label

### 4-Tier Severity System (Updated Sept 5, 2025)

**Political Entries Mapping:**
- `critical` → "Fucking Treason 🔴" (Democracy threats, election stealing)
- `high` → "Criminal Bullshit 🟠" (Criminal activity, policies that harm)
- `medium` → "Swamp Shit 🟡" (Standard corruption, grift)
- `low` → "Clown Show 🟢" (Incompetence, stupidity)

**Executive Orders Impact Categories:**
- `fascist_power_grab` → "Fascist Power Grab 🔴"
- `authoritarian_overreach` → "Authoritarian Overreach 🟠"
- `corrupt_grift` → "Corrupt Grift 🟡"
- `performative_bullshit` → "Performative Bullshit 🟢"

### Database Constraints (Updated Sept 5, 2025)
```sql
-- Political Entries
CHECK (severity IN ('critical', 'high', 'medium', 'low'))

-- Executive Orders
CHECK (severity_rating IN ('critical', 'high', 'medium', 'low'))
```

## Best Practices

### 1. Always Check Schema First
Before adding new fields, verify they exist in the database schema.

### 2. Use Fallbacks
```javascript
const displayText = entry.spicy_summary || entry.summary || entry.description;
```

### 3. Handle Null Values
```javascript
if (order.agencies_affected && order.agencies_affected.length > 0) {
  // Process agencies
}
```

### 4. Test on Test Branch First
All database changes should be tested on the test environment before production.

## Troubleshooting Checklist

- [ ] Check field exists in schema documentation
- [ ] Verify correct field name (no typos)
- [ ] Confirm data type matches schema
- [ ] Test with minimal data first
- [ ] Check Supabase logs for detailed errors
- [ ] Verify environment variables are set

## Related Documentation

### Schema Files (in /database/ folder)
- [Complete Database Schema](./database/database-schema.md) - All fields reference
- [Severity System Guide](./database/severity-system.md) - 4-tier implementation details
- [Field Error Fixes](./database/FIELD-ERROR-FIXES.md) - Quick troubleshooting

### Implementation Guides
- [Executive Orders Collection](./executive-orders-collection.md)
- [Daily Tracker Implementation](./daily-tracker-implementation.md)  
- [Spicy Summaries Implementation](./spicy-summaries-implementation.md)
- [Admin Panel Guide](./admin-panel-guide.md)

## Support

For database issues:
1. Check this documentation first
2. Review schema files in `/docs/database/`
3. Check Supabase dashboard for table structure
4. Create JIRA ticket if issue persists

# SCOTUS Scripts

Scripts for fetching and managing SCOTUS case data from CourtListener.

## Prerequisites

1. **Migration 066 applied** - Run `migrations/066_scotus_cases.sql` via Supabase Dashboard SQL Editor
2. **CourtListener API Token** - Set `COURTLISTENER_API_TOKEN` in environment

## Scripts

### fetch-cases.js

Fetches SCOTUS cases from CourtListener API and stores them in `scotus_cases` table.

**Usage:**
```bash
# Test with dry run (no database writes)
COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --dry-run --limit=5

# Fetch 5 cases
COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --limit=5

# Fetch all cases since 2024
COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --since=2024-01-01

# Resume from last sync state
COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --resume
```

**Options:**
- `--since=YYYY-MM-DD` - Only fetch cases decided after this date (default: 2020-01-01)
- `--limit=N` - Stop after N cases (for testing)
- `--resume` - Resume from last sync state (uses `scotus_sync_state.next_url`)
- `--dry-run` - Don't write to database, just log what would happen

**Environment Variables:**
- `COURTLISTENER_API_TOKEN` - Required: CourtListener API auth token
- `SUPABASE_TEST_URL` - Required: TEST Supabase URL (from .env)
- `SUPABASE_TEST_SERVICE_KEY` - Required: TEST service role key (from .env)

## API Fetch Pattern

The script follows a 3-endpoint pattern for each case:

1. **Cluster endpoint** (`/clusters/`) - Main case data
2. **Docket endpoint** (`/dockets/{id}/`) - Argued date, docket number
3. **Opinions endpoint** (`/opinions/?cluster={id}`) - Syllabus, author, dissents

## Data Flow

```
CourtListener API
    ↓ fetch-cases.js
scotus_cases table (is_public=false)
    ↓ enrichment (future)
scotus_cases table (is_public=true)
    ↓ Edge Function (future)
Frontend
```

## Making Cases Public

By default, fetched cases have `is_public = false`. To make them visible on the frontend:

```sql
-- Make a specific case public
UPDATE scotus_cases SET is_public = true WHERE id = 123;

-- Make all enriched cases public
UPDATE scotus_cases SET is_public = true WHERE enriched_at IS NOT NULL;
```

## Sync State

The `scotus_sync_state` table tracks pagination:
- `next_url` - CourtListener pagination URL (null when complete)
- `last_date_filed` - Most recent case date fetched
- `total_fetched` - Running count of cases processed

Use `--resume` to continue from where the last run stopped.

## Rate Limits

CourtListener allows 5,000 queries/hour for authenticated requests. The script:
- Includes small delays between requests (200ms)
- Implements exponential backoff on 429 responses
- Logs request count every 100 requests

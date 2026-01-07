# Daily Tracker API Documentation

## Overview

The daily tracker uses the OpenAI Responses API with web search capability to find real political news articles. This runs daily at 9 AM and 10 AM EST via GitHub Actions.

## API Configuration

### Endpoint
```
POST https://api.openai.com/v1/responses
```

**Note:** This is NOT the standard chat/completions endpoint. The Responses API is a special endpoint that supports web search functionality through the `web_search_preview` tool.

### Request Structure
```javascript
{
  model: 'gpt-4o-mini',
  tools: [
    {
      type: 'web_search_preview',
      search_context_size: 'medium'
    }
  ],
  input: '[search prompt with instructions]',
  max_output_tokens: 2000
}
```

### Response Structure
```javascript
{
  output: [
    {
      type: 'message',
      content: [
        {
          text: '[JSON array of news articles]'
        }
      ]
    }
  ],
  usage: {
    total_tokens: [number]
  }
}
```

## Environment Variables

### Required (Secrets)
- `OPENAI_API_KEY` - Your OpenAI API key with access to Responses API
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for database operations

### Optional (Duplicate Detection)
- `DUPLICATE_LOOKBACK_DAYS` - Days to check for duplicates (default: 7)
- `DUPLICATE_MIN_LENGTH` - Minimum description length to check (default: 200)
- `DUPLICATE_THRESHOLD` - Similarity threshold 0-100 (default: 85)
- `DUPLICATE_CHECK_BATCH_SIZE` - Batch size for API calls (default: 20)
- `DUPLICATE_SKIP_CHECK` - Set to 'true' to disable duplicate checking
- `DUPLICATE_DEBUG_LOG` - Set to 'true' for detailed logging

## Search Categories

The tracker searches for news in these political categories:

1. **Trump Administration** - Policy announcements, cabinet appointments, presidential actions
2. **Elon Musk & DOGE** - Department of Government Efficiency, tech-government intersection
3. **DOJ & Law Enforcement** - Justice Department actions, federal investigations
4. **Federal Agencies** - Agency policy changes, regulatory updates
5. **Courts & Legal** - Federal court rulings, Supreme Court decisions
6. **Corporate & Financial** - Lobbying, campaign finance, corporate influence

## News Quality Requirements

Each article must include:
- **title** - Clear, factual headline
- **description** - 2-3 sentence summary
- **source** - Publisher name (e.g., "Reuters", "AP News")
- **source_url** - Direct link to the article
- **date** - Article publication date (YYYY-MM-DD format)
- **severity** - Impact rating: "low", "medium", "high", or "critical"

## Cost Management

### Per Run Costs
- **API Calls:** ~681 tokens per category × 6 categories = ~4,086 tokens
- **Cost:** ~$0.003 per run
- **Monthly:** ~$0.10-0.15 (with 2 daily runs)

### Optimization Features
- **Duplicate Detection:** Saves 50% on redundant API calls
- **Batch Processing:** Processes 20 articles at once for efficiency
- **Smart Caching:** Checks last 7 days to avoid republishing

## Common Issues & Solutions

### Socket Hang Ups
**Issue:** Occasional "socket hang up" errors during web searches
**Solution:** These are normal for web search APIs and self-recover. The script continues processing other categories.

### No Articles Found
**Issue:** API returns 0 articles
**Possible Causes:**
1. Using wrong endpoint (must be `/v1/responses` not `/v1/chat/completions`)
2. Missing `web_search_preview` tool in request
3. Prompt asking to "generate" instead of "search"

### Duplicate Articles
**Issue:** Same story appears multiple times
**Solution:** Configure duplicate detection thresholds:
```bash
# In .env or GitHub Secrets
DUPLICATE_THRESHOLD=75  # Lower = more aggressive filtering
DUPLICATE_LOOKBACK_DAYS=14  # Check more days of history
```

## Testing Locally

```bash
# Create .env file with required keys
echo OPENAI_API_KEY=your-key >> .env
echo SUPABASE_URL=your-url >> .env
echo SUPABASE_SERVICE_ROLE_KEY=your-key >> .env

# Run with debug logging
set DUPLICATE_DEBUG_LOG=true
node scripts/daily-tracker-supabase.js

# Test with limited categories
node scripts/daily-tracker-supabase.js --test
```

## GitHub Actions Configuration

The workflow runs automatically at 9 AM and 10 AM EST:

```yaml
name: Daily Political Tracker
on:
  schedule:
    - cron: '0 14 * * *'  # 9 AM EST
    - cron: '0 15 * * *'  # 10 AM EST
  workflow_dispatch:

jobs:
  track-news:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: node scripts/daily-tracker-supabase.js
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Backfilling Missing Days

To catch up on missed articles:

```bash
# Backfill last 14 days
node scripts/daily-tracker-supabase.js --days 14

# Or use the batch script
backfill-2-weeks.bat
```

## Version History

- **v3.0** (Sept 2025) - Fixed Responses API, enhanced duplicate detection
- **v2.5** (Aug 2025) - Added spicy summaries integration
- **v2.0** (July 2025) - Migrated to Supabase, added ID generation
- **v1.0** (June 2025) - Initial JSON-based implementation

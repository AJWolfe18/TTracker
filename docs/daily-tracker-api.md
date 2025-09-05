# Daily Tracker API Documentation

## Overview

The daily tracker uses the OpenAI Responses API with web search capability to find real political news articles. This runs daily at 9 AM EST via GitHub Actions.

## API Configuration

### Endpoint
```
POST https://api.openai.com/v1/responses
```

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
- `OPENAI_API_KEY` - OpenAI API key for Responses API access
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key for database access

### Optional (Variables)
These control duplicate detection sensitivity. All have defaults if not set:

- `DUPLICATE_COMPARISON_LENGTH` - Characters to compare (default: 200)
- `DUPLICATE_SIMILARITY_THRESHOLD` - Similarity percentage required (default: 0.85)
- `DUPLICATE_SCORE_THRESHOLD` - Total score to mark as duplicate (default: 80)
- `DUPLICATE_DEBUG_LOG` - Enable detailed logging (default: false)

### Setting Environment Variables

#### GitHub Actions
1. Go to Settings → Secrets and variables → Actions
2. Add required values as **Repository secrets**
3. Add optional values as **Repository variables** (not secrets)

#### Local Development
Create `.env` file in project root:
```bash
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...

# Optional
DUPLICATE_DEBUG_LOG=true
DUPLICATE_COMPARISON_LENGTH=200
```

## Categories Searched

The tracker searches for news in 6 categories:
1. **Trump & Family** - Legal proceedings, business dealings, campaign activities
2. **Elon Musk & DOGE** - Department of Government Efficiency, conflicts of interest
3. **DOJ & Law Enforcement** - Prosecutions, policy shifts, civil rights
4. **Federal Agencies** - ICE, DHS, EPA policy changes and leadership
5. **Courts & Legal** - Supreme Court, federal court rulings, legal challenges
6. **Corporate & Financial** - Lobbying, campaign finance, ethics violations

## Duplicate Detection

The system uses a multi-factor scoring system:

### Scoring Components
- **URL match**: 30 points (exact) or 10 points (same domain)
- **Title similarity**: 0-40 points based on text comparison
- **Date proximity**: 0-15 points (same day = 15)
- **Actor match**: 0-15 points

Total score ≥80 (configurable) = duplicate

### Batched Processing
- Fetches recent entries once for comparison
- Reduces API calls by ~50%
- Saves ~900 Supabase calls per month

## Error Handling

### Socket Hang Ups
- Common with web search APIs
- System continues processing other categories
- Future improvement: Add retry logic (TTRC-118)

### API Failures
- Non-blocking: Failed categories return empty arrays
- Other categories continue processing
- Errors logged but don't stop execution

## Cost Analysis

### Per Run
- ~680 tokens per category
- 6 categories = ~4,080 tokens
- Cost: ~$0.003 per run

### Monthly
- 30 days × 2 runs = 60 runs
- Total: ~$0.10-0.15/month
- Well within $50/month budget

## Performance Metrics

### Typical Run
- Articles found: 10-15
- Duplicates caught: 5-10
- Processing time: 30-60 seconds
- Success rate: ~95%

## Known Limitations

1. **Responses API** - Undocumented/beta endpoint, may change
2. **Socket timeouts** - Occasional connection drops (self-recovers)
3. **Web search quality** - Depends on OpenAI's web search capability
4. **Date extraction** - Sometimes uses current date instead of article date

## Future Improvements (TTRC-118)

- Add retry logic for failed API calls
- Email notifications for failures
- Performance monitoring dashboard
- Consider fallback to NewsAPI or Perplexity

## Testing

### Local Test
```bash
node scripts/daily-tracker-supabase.js
```

### GitHub Actions Test
1. Go to Actions tab
2. Select "Daily Political Tracker"
3. Click "Run workflow"

### Verify Results
- Check Supabase `political_entries` table
- Look for entries with today's date
- Verify `source_url` points to real news sites

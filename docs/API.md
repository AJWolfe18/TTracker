# TrumpyTracker API Documentation

## Overview

TrumpyTracker provides several APIs and endpoints for data access and system management. All public endpoints are read-only, while administrative functions require proper authentication.

## Table of Contents
- [Public APIs](#public-apis)
- [GitHub Actions APIs](#github-actions-apis)
- [Supabase Database API](#supabase-database-api)
- [Admin Endpoints](#admin-endpoints)
- [Rate Limits](#rate-limits)
- [Error Handling](#error-handling)

## Public APIs

### Dashboard Data Endpoint

**Base URL**: `https://osjbulmltfpcoldydexg.supabase.co/rest/v1`

#### Get Political Entries

```http
GET /political_entries
```

**Query Parameters:**
- `archived=eq.false` - Get only non-archived entries
- `order=date.desc,created_at.desc` - Sort by date and creation time
- `limit=100` - Limit number of results
- `offset=0` - Pagination offset
- `category=eq.Civil%20Liberties` - Filter by category
- `severity=eq.high` - Filter by severity
- `verified=eq.true` - Get only verified entries

**Example Request:**
```javascript
const response = await fetch(
  'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/political_entries?archived=eq.false&order=date.desc&limit=50',
  {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  }
);
```

**Response Format:**
```json
[
  {
    "id": 123,
    "date": "2025-08-17",
    "actor": "Donald Trump",
    "category": "Legal Proceedings",
    "title": "Court ruling on executive privilege",
    "description": "Federal court rules on scope of executive privilege claims...",
    "source": "Reuters",
    "source_url": "https://reuters.com/article/...",
    "verified": true,
    "severity": "high",
    "archived": false,
    "created_at": "2025-08-17T14:00:00Z",
    "updated_at": "2025-08-17T14:00:00Z"
  }
]
```

#### Get Executive Orders

```http
GET /executive_orders
```

**Query Parameters:**
- `archived=eq.false` - Get only non-archived orders
- `order=date.desc` - Sort by date
- `limit=50` - Limit number of results

**Example Request:**
```javascript
const response = await fetch(
  'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/executive_orders?archived=eq.false&order=date.desc',
  {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  }
);
```

## GitHub Actions APIs

### Manual Article Processing

**Trigger URL**: `https://api.github.com/repos/AJWolfe18/TTracker/dispatches`

**Method**: `POST`

**Headers:**
```json
{
  "Accept": "application/vnd.github.v3+json",
  "Authorization": "token YOUR_GITHUB_TOKEN",
  "Content-Type": "application/json"
}
```

**Request Body:**
```json
{
  "event_type": "process-manual-article",
  "client_payload": {
    "article_url": "https://example.com/article",
    "submitted_by": "admin",
    "entry_id": "optional-uuid"
  }
}
```

**Example cURL:**
```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -d '{"event_type":"process-manual-article","client_payload":{"article_url":"https://example.com/article","submitted_by":"admin"}}' \
  https://api.github.com/repos/AJWolfe18/TTracker/dispatches
```

### Workflow Status Check

**Get Workflow Runs:**
```http
GET https://api.github.com/repos/AJWolfe18/TTracker/actions/runs
```

**Get Specific Workflow Status:**
```http
GET https://api.github.com/repos/AJWolfe18/TTracker/actions/runs/{run_id}
```

## Supabase Database API

### Connection Configuration

**Production Database:**
```javascript
const SUPABASE_URL = 'https://osjbulmltfpcoldydexg.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

**Test Database:**
```javascript
const SUPABASE_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
const SUPABASE_ANON_KEY = 'your-test-anon-key';
```

### Available Tables

#### political_entries
- **Read**: Public (anon key)
- **Write**: Service role only
- **RLS**: Enabled

#### executive_orders
- **Read**: Public (anon key)  
- **Write**: Service role only
- **RLS**: Enabled

#### pending_submissions
- **Read**: Service role only
- **Write**: Service role only
- **RLS**: Enabled

### Query Examples

**Filter by Date Range:**
```javascript
const { data } = await supabase
  .from('political_entries')
  .select('*')
  .gte('date', '2025-08-01')
  .lte('date', '2025-08-17')
  .eq('archived', false);
```

**Search by Actor:**
```javascript
const { data } = await supabase
  .from('political_entries')
  .select('*')
  .ilike('actor', '%Trump%')
  .eq('archived', false);
```

**Get Statistics:**
```javascript
const { data, count } = await supabase
  .from('political_entries')
  .select('category', { count: 'exact', head: true })
  .eq('archived', false);
```

## Admin Endpoints

### Queue Management

**Get Pending Submissions:**
```javascript
const { data } = await supabase
  .from('pending_submissions')
  .select('*')
  .eq('status', 'pending')
  .order('created_at', { ascending: false });
```

**Update Submission Status:**
```javascript
const { error } = await supabase
  .from('pending_submissions')
  .update({ 
    status: 'processed',
    processed_at: new Date().toISOString()
  })
  .eq('id', submissionId);
```

### Archive Management

**Archive Old Entries:**
```javascript
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - 60);

const { error } = await supabase
  .from('political_entries')
  .update({ archived: true })
  .lt('date', cutoffDate.toISOString());
```

**Restore Archived Entry:**
```javascript
const { error } = await supabase
  .from('political_entries')
  .update({ archived: false })
  .eq('id', entryId);
```

## Rate Limits

### API Rate Limits

| Service | Limit | Period | Notes |
|---------|-------|--------|-------|
| Supabase (Free) | 500 requests | Per second | Across all endpoints |
| GitHub API | 5000 requests | Per hour | With authentication |
| OpenAI API | 10000 tokens | Per minute | GPT-4 model |
| Netlify | 100GB bandwidth | Per month | Static file serving |

### Client-Side Caching

To reduce API calls, the frontend implements caching:

```javascript
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'tt_cache_political_entries';

function getCachedData() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) {
      return data;
    }
  }
  return null;
}
```

## Error Handling

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad Request | Check request parameters |
| 401 | Unauthorized | Check API keys |
| 403 | Forbidden | Check permissions |
| 404 | Not Found | Check endpoint URL |
| 429 | Rate Limited | Implement backoff |
| 500 | Server Error | Retry with backoff |

### Error Response Format

```json
{
  "code": "PGRST301",
  "details": "Invalid query parameter",
  "hint": "Check the 'category' parameter value",
  "message": "Bad Request"
}
```

### Retry Logic

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}
```

## Authentication

### API Key Types

1. **Supabase Anon Key**
   - Used for public read access
   - Safe to expose in frontend code
   - Limited by RLS policies

2. **Supabase Service Role Key**
   - Full database access
   - Never expose in frontend
   - Store in GitHub Secrets only

3. **GitHub Personal Access Token**
   - Required for API calls
   - Scope: `repo`, `workflow`
   - Store securely

### Setting Up Authentication

**Frontend (Public Access):**
```javascript
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
```

**Backend (Admin Access):**
```javascript
const supabase = createClient(
  SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
```

## Webhooks

### GitHub Webhook Events

The system can respond to these GitHub webhook events:

- `workflow_dispatch` - Manual workflow trigger
- `repository_dispatch` - Custom events
- `push` - Code changes
- `schedule` - Cron jobs

### Setting Up Webhooks

1. Go to GitHub repository settings
2. Navigate to Webhooks
3. Add webhook URL
4. Select events to trigger
5. Set content type to `application/json`

## Data Formats

### Date Format
All dates use ISO 8601 format: `YYYY-MM-DD`

### Timestamp Format
All timestamps use ISO 8601 with timezone: `2025-08-17T14:00:00Z`

### Categories
Valid categories (case-sensitive):
- `Financial`
- `Civil Liberties`
- `Platform Manipulation`
- `Government Oversight`
- `Election Integrity`
- `Corporate Ethics`
- `Legal Proceedings`

### Severity Levels
Valid severity values (lowercase):
- `low`
- `medium`
- `high`

## Testing

### Test Environment Endpoints

Replace production URLs with test environment:
- Supabase URL: `https://wnrjrywpcadwutfykflu.supabase.co`
- Dashboard: `https://test--taupe-capybara-0ff2ed.netlify.app/`

### API Testing Tools

**Using cURL:**
```bash
curl -X GET \
  'https://osjbulmltfpcoldydexg.supabase.co/rest/v1/political_entries?limit=5' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

**Using Postman:**
1. Import the Supabase collection
2. Set environment variables
3. Test each endpoint
4. Validate responses

## Best Practices

1. **Always use HTTPS** for API calls
2. **Implement caching** to reduce API usage
3. **Handle errors gracefully** with user feedback
4. **Use pagination** for large datasets
5. **Validate input** before API calls
6. **Log errors** for debugging
7. **Monitor rate limits** to avoid throttling
8. **Use appropriate keys** for each environment

---

*Last Updated: August 17, 2025*
*API Version: 1.0*
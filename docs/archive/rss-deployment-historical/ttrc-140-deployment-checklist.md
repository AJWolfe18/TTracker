# TTRC-140 RSS Fetcher Implementation - P1 Production Deployment

## ✅ P1 Fixes Implemented

**Critical Production Fixes:**
- ✅ Atomic database operations (upsert + enqueue)
- ✅ Network timeouts with abort controllers  
- ✅ Feed size limits with streaming
- ✅ Retry logic with exponential backoff
- ✅ Secrets validation and safe logging

## 🚀 Deployment Steps

### 1. Install Dependencies
```bash
npm install
# This installs rss-parser and openai packages
```

### 2. Set Environment Variables

**Required Variables:**
```bash
# Core Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ... # Must be valid JWT format

# OpenAI (Optional - for enrichment features)
OPENAI_API_KEY=sk-... # Optional, starts with sk-

# RSS Configuration (Optional - defaults provided)
RSS_MAX_BYTES=1500000              # Max feed size (1.5MB default)
FETCH_TIMEOUT_MS=15000             # Request timeout (15s default)
FAILURE_SKIP_THRESHOLD=5           # Skip feeds after N failures
FEEDS_PER_RUN=20                   # Max feeds per enqueue cycle

# Worker Configuration (Optional)
WORKER_POLL_INTERVAL_MS=5000       # Job polling interval
WORKER_MAX_CONCURRENT=2            # Concurrent job limit
WORKER_RATE_LIMIT_MS=500           # Min time between jobs
WORKER_MAX_RETRIES=3               # Job retry attempts
WORKER_BACKOFF_BASE_MS=2000        # Retry delay base
```

### 3. Deploy Database Migration
```bash
# Deploy atomic upsert function
psql $DATABASE_URL < migrations/003_atomic_article_upsert.sql
```

### 4. Seed Feed Registry
```bash
# Populate initial RSS feeds
psql $DATABASE_URL < scripts/seed/seed_feed_registry.sql
```

### 5. Deploy RSS Enqueue Edge Function
```bash
# Deploy the new function
supabase functions deploy rss-enqueue

# Test manual invocation
supabase functions invoke rss-enqueue --no-verify-jwt
```

### 6. Set Up Supabase Scheduler
- Go to Supabase Dashboard → Edge Functions → Schedules
- Create new schedule:
  - Function: `rss-enqueue`
  - Cron: `*/10 * * * *` (every 10 minutes)
  - Enabled: ✅

### 7. Test P1 Fixes
```bash
# Test network utilities
node -e "const { fetchWithTimeout } = require('./scripts/utils/network'); fetchWithTimeout('https://httpbin.org/delay/20').catch(console.log)"

# Test security validation
node -e "const { initializeEnvironment } = require('./scripts/utils/security'); console.log(initializeEnvironment())"

# Test RSS pipeline with size limits
node scripts/test/test-rss-fetch.js https://www.reuters.com/rss/world
```

### 8. Start Production Job Worker
```bash
# Start the worker with P1 fixes
node scripts/job-queue-worker.js
```

## 🔍 P1 Verification Checklist

### ✅ Atomic Operations
```sql
-- Verify function exists and works
SELECT upsert_article_and_enqueue(
  'https://test.com/article',
  'test-hash-123',
  'Test Headline',
  'Test Source',
  'test.com',
  NOW()
);

-- Check both article and job were created
SELECT COUNT(*) FROM articles WHERE url_hash = 'test-hash-123';
SELECT COUNT(*) FROM job_queue WHERE payload->>'article_url' = 'https://test.com/article';
```

### ✅ Network Timeouts
```bash
# Test timeout behavior (should fail after 15s)
node -e "
const { fetchWithTimeout } = require('./scripts/utils/network');
console.time('timeout');
fetchWithTimeout('https://httpbin.org/delay/20')
  .catch(e => {
    console.timeEnd('timeout');
    console.log('✅ Timeout working:', e.message);
  });
"
```

### ✅ Size Limits
```bash
# Test large feed rejection
node scripts/test/test-rss-fetch.js https://httpbin.org/bytes/2000000
# Should fail with "Feed too large" error
```

### ✅ Retry Logic
```bash
# Test retry with flaky endpoint
node -e "
const { withRetry } = require('./scripts/utils/network');
let attempts = 0;
withRetry(async () => {
  attempts++;
  if (attempts < 3) throw new Error('Fake failure');
  console.log('✅ Retry working: succeeded on attempt', attempts);
}, 3, 100);
"
```

### ✅ Secrets Validation
```bash
# Test invalid key detection (should fail immediately)
SUPABASE_SERVICE_ROLE_KEY=invalid node scripts/job-queue-worker.js
# Should exit with "Invalid credential format" error
```

## 🚨 Production Monitoring

**Critical Alerts:**
- Feed failure_count >= 5
- Job queue depth > 50 items  
- Worker process down/crashed
- Memory usage > 80%
- No articles ingested in 2+ hours

**Success Metrics:**
- RSS fetch success rate >95%
- Article ingestion 200-300/day
- Average job processing <30s
- Memory usage stable <500MB

## 🔒 Security Notes

- **Secrets**: Never log SUPABASE_SERVICE_ROLE_KEY or OPENAI_API_KEY
- **Validation**: All credentials validated on startup
- **Logging**: All logs use structured JSON with redacted secrets
- **Rotation**: Document key rotation procedures

## 📊 Expected Results

**Healthy Production State:**
- ✅ 5 feeds in `feed_registry` with `failure_count = 0`
- ✅ RSS enqueue runs every 10 minutes
- ✅ Articles flowing: ~20-50 per hour during news cycles
- ✅ Job queue processing within 1-2 minutes
- ✅ No timeout or memory errors in logs

---

**Status**: ✅ Ready for production deployment  
**Risk Level**: Low (atomic operations ensure data integrity)  
**Rollback Plan**: Disable scheduler, revert database function if needed

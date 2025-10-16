# TTRC-234 Implementation Complete: Article Embedding Generation

**Date:** 2025-10-15
**Status:** ✅ Code Complete - Ready for Testing
**Priority:** HIGH - Blocks TTRC-231 merge quality testing
**Branch:** `test`

---

## 🎯 Problem Solved

**Issue:** RSS pipeline creates articles WITHOUT embeddings, blocking:
- Story clustering (requires article embeddings)
- Story centroid calculation (aggregates article embeddings)
- Merge quality testing (requires 10+ stories with centroids)

**Root Cause:** No embedding generation step in RSS pipeline flow

**Current State:**
- 377 total articles in TEST database
- Only 18 articles have embeddings (4.8%)
- Only 4-5 stories have centroid_embedding_v1
- Merge quality tests require 10+ stories with centroids

---

## 💡 Solution Implemented

**Approach:** Option 1 - Article Enrichment Job (from architecture decision doc)

### Why This Approach?
1. **Separation of concerns** - Each job does one thing well
2. **Resilience** - Job queue handles retries, failures gracefully
3. **Future-proof** - Easy to add more article enrichment later
4. **Cost-effective** - Can batch embeddings if needed
5. **Follows existing pattern** - Matches story enrichment workflow

### Cost Analysis
- **One-time backfill:** 359 articles × $0.0002 = **$0.07**
- **Ongoing cost:** 40 articles/day × $0.0002 = **$0.008/day** = **$0.25/month**
- **Well within $50/month budget** ✅

---

## 🔧 Changes Made

### 1. Updated `enrichArticle()` Handler
**File:** `scripts/job-queue-worker.js` (lines 195-252)

**What it does:**
- Fetches article by ID
- Generates embedding using OpenAI text-embedding-3-small
- Updates article.embedding_v1 with 1,536-dimensional vector
- Tracks cost per embedding (~$0.0002)

**Key features:**
- Uses first 2000 chars of content for embedding generation
- Includes title + content for semantic representation
- Logs token usage and cost for monitoring

### 2. Registered Handler
**File:** `scripts/job-queue-worker.js` (line 76)

**Change:** Uncommented `'article.enrich': this.enrichArticle.bind(this)`

### 3. Created Migration 028
**File:** `migrations/028_add_article_enrich_job.sql`

**What it does:**
- Updates `upsert_article_and_enqueue_jobs` RPC function
- Now enqueues TWO jobs per article:
  1. `article.enrich` - Generate embedding (NEW)
  2. `process_article` - Legacy clustering trigger

**Important:** This migration MUST be applied to TEST before testing

### 4. Created Backfill Script
**File:** `scripts/backfill-article-embeddings.js`

**What it does:**
- Finds all articles with NULL embedding_v1
- Enqueues `article.enrich` jobs for each
- Supports batch limits for safe testing
- Shows progress indicator and cost estimate

**Usage:**
```bash
# Test with 5 articles
node scripts/backfill-article-embeddings.js 5

# Backfill all articles without embeddings
node scripts/backfill-article-embeddings.js all
```

---

## 📋 Testing Plan

### Phase 1: Apply Migration ✋ **MANUAL STEP REQUIRED**
```sql
-- Copy contents of migrations/028_add_article_enrich_job.sql
-- Paste into Supabase SQL Editor (TEST project)
-- Run migration
```

**Verify migration:**
```sql
-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'upsert_article_and_enqueue_jobs';

-- Should return updated function with article.enrich job creation
```

### Phase 2: Test Single Article
```bash
# Option A: Manually enqueue job for one article
node -e "
import('dotenv/config');
import('@supabase/supabase-js').then(({ createClient }) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Get one article without embedding
  supabase.from('articles')
    .select('id')
    .is('embedding_v1', null)
    .limit(1)
    .single()
    .then(({ data: article }) => {
      if (!article) {
        console.log('No articles without embeddings found');
        return;
      }

      // Enqueue enrichment job
      supabase.from('job_queue')
        .insert({
          job_type: 'article.enrich',
          payload: { article_id: article.id },
          status: 'pending',
          run_at: new Date().toISOString()
        })
        .then(() => {
          console.log('✅ Job enqueued for article:', article.id);
          console.log('Run: node scripts/job-queue-worker.js');
        });
    });
});
"
```

**Expected result:**
1. Job appears in `job_queue` table
2. Worker processes job
3. Article.embedding_v1 populates with vector
4. Console shows: "✅ Generated embedding for article X: { tokens: 150, cost: $0.000003, dimensions: 1536 }"

### Phase 3: Backfill Small Batch
```bash
# Backfill 5 articles (safe test)
node scripts/backfill-article-embeddings.js 5

# Start worker to process jobs
node scripts/job-queue-worker.js
```

**Monitor progress:**
```sql
-- Check job status
SELECT job_type, status, COUNT(*)
FROM job_queue
WHERE job_type = 'article.enrich'
GROUP BY job_type, status;

-- Check embeddings created
SELECT COUNT(*) FROM articles WHERE embedding_v1 IS NOT NULL;
```

### Phase 4: Full Backfill
```bash
# Backfill ALL articles without embeddings
node scripts/backfill-article-embeddings.js all

# Expected: ~359 jobs enqueued
# Estimated cost: $0.07
```

### Phase 5: Verify Clustering Works
Once articles have embeddings, verify clustering picks them up:

```sql
-- Check stories with centroids
SELECT COUNT(*) FROM stories WHERE centroid_embedding_v1 IS NOT NULL;

-- Should increase as clustering jobs process
```

### Phase 6: Run Merge Quality Tests
```bash
# Once 10+ stories have centroids
node scripts/test-merge-quality.js
```

**Expected:**
- Creates 50 test cases
- Shows precision/recall metrics
- No more "Not enough stories with embeddings" error

---

## 🔄 New RSS Pipeline Flow

### Before (BROKEN)
```
RSS Fetch → Article Created (no embedding) → Clustering FAILS → No centroid → Merge detection FAILS
```

### After (FIXED)
```
RSS Fetch
  ↓
Article Created (embedding_v1 = NULL)
  ↓
article.enrich job enqueued
  ↓
Worker generates embedding ($0.0002)
  ↓
Article updated (embedding_v1 = [1536 floats])
  ↓
Clustering uses embedding for candidate search
  ↓
Story centroid calculated from article embeddings
  ↓
Merge detection compares story centroids
```

---

## ⚠️ Important Notes

### Migration 028 MUST Be Applied First
- Without it, new RSS articles won't get enrichment jobs
- Backfill script works independently (doesn't need migration)
- But ongoing RSS fetches need migration to auto-enqueue jobs

### Job Queue Worker Must Be Running
- Jobs sit in `pending` status until worker processes them
- Start worker: `node scripts/job-queue-worker.js`
- Worker polls every 5 seconds for new jobs

### Cost Tracking
- Each embedding costs ~$0.0002 (based on OpenAI pricing)
- Console logs show exact cost per article
- Total cost visible in worker logs

### Retry Logic
- Job queue automatically retries failed jobs (3 attempts)
- Exponential backoff: 2s, 4s, 8s
- After 3 failures, job marked as 'failed'

---

## 📊 Success Metrics

### Phase 1: Single Article Test
- [ ] Migration 028 applied successfully
- [ ] Single article job enqueued
- [ ] Worker processes job without errors
- [ ] Article.embedding_v1 populated with 1536-float vector
- [ ] Cost logged (~$0.0002)

### Phase 2: Small Batch (5 articles)
- [ ] 5 jobs enqueued
- [ ] All 5 complete successfully
- [ ] 5 articles now have embeddings
- [ ] Total cost ~$0.001

### Phase 3: Full Backfill (359 articles)
- [ ] 359 jobs enqueued
- [ ] >95% success rate (340+ articles enriched)
- [ ] Total cost ~$0.07
- [ ] Stories start getting centroids

### Phase 4: Merge Quality Testing
- [ ] 10+ stories have centroid_embedding_v1
- [ ] Merge quality test script runs
- [ ] Precision ≥90%
- [ ] Recall ≥85%

---

## 🐛 Troubleshooting

### Error: "OpenAI not configured"
**Cause:** Missing OPENAI_API_KEY in .env
**Fix:** Add `OPENAI_API_KEY=sk-...` to .env file

### Error: "No handler for job type: article.enrich"
**Cause:** Worker using old code before handler registration
**Fix:** Restart worker: `node scripts/job-queue-worker.js`

### Jobs stuck in 'pending' status
**Cause:** Worker not running
**Fix:** Start worker in separate terminal

### Embeddings not populating
**Cause:** Jobs failing silently
**Fix:** Check `job_queue.error` column for error messages:
```sql
SELECT id, job_type, error, attempts
FROM job_queue
WHERE status = 'failed' AND job_type = 'article.enrich'
ORDER BY created_at DESC
LIMIT 10;
```

### Cost higher than expected
**Cause:** Long articles generating many tokens
**Fix:** Already limited to 2000 chars in enrichArticle() - no action needed

---

## 📁 Files Changed

### Code
- `scripts/job-queue-worker.js` (lines 76, 195-252)
  - Registered article.enrich handler
  - Implemented enrichArticle() method

### Migrations
- `migrations/028_add_article_enrich_job.sql` (NEW)
  - Updates RPC to enqueue article.enrich jobs

### Scripts
- `scripts/backfill-article-embeddings.js` (NEW)
  - Backfills existing articles without embeddings

### Documentation
- `docs/handoffs/2025-10-15-embedding-generation-issue.md` (architecture decision)
- `docs/handoffs/2025-10-15-ttrc234-implementation-complete.md` (this file)

---

## 🚀 Next Steps (Sequential)

1. **Apply Migration 028** (MANUAL)
   - Copy SQL from `migrations/028_add_article_enrich_job.sql`
   - Paste into Supabase SQL Editor (TEST)
   - Run migration
   - Verify function updated

2. **Test Single Article**
   - Enqueue one job manually (see Phase 2 above)
   - Start worker
   - Verify embedding generated

3. **Backfill Small Batch**
   - `node scripts/backfill-article-embeddings.js 5`
   - Verify 5 embeddings generated

4. **Backfill All Articles**
   - `node scripts/backfill-article-embeddings.js all`
   - Monitor progress
   - Verify ~359 embeddings created

5. **Run Merge Quality Tests**
   - Wait for 10+ stories to have centroids
   - `node scripts/test-merge-quality.js`
   - Document precision/recall results

6. **Update JIRA**
   - Move TTRC-234 to "Done"
   - Add results to ticket

---

## 📞 Questions?

- **Architecture:** See `docs/handoffs/2025-10-15-embedding-generation-issue.md`
- **TTRC-234:** https://ajwolfe37.atlassian.net/browse/TTRC-234
- **TTRC-231 (Merge Testing):** https://ajwolfe37.atlassian.net/browse/TTRC-231

---

**Implementation Time:** ~1.5 hours
**Status:** Code complete, ready for migration + testing
**Estimated Testing Time:** 30 minutes (migration + single test) + 1 hour (full backfill)
**Total Cost:** $0.07 one-time + $0.25/month ongoing

---

**Last Updated:** 2025-10-15
**Implemented by:** Claude Code
**Reviewed by:** Josh (PM)

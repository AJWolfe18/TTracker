# TTRC-142: Story Clustering Deployment Checklist

## ✅ READY FOR PRODUCTION DEPLOYMENT

### Test Status
- ✅ All 4 smoke tests passing
- ✅ Clustering algorithm working (75-point threshold)
- ✅ Database constraints fixed
- ✅ Unique article-story linking enforced

## Production Deployment Steps

### 1. Deploy Migration to PRODUCTION
```sql
-- Run the complete migration file:
-- migrations/PROD_TTRC142_clustering_complete.sql

-- This includes:
-- ✅ Fixed similarity_score constraint (0-100 not 0-1)
-- ✅ Unique index on article_story
-- ✅ attach_or_create_story function
-- ✅ Updated upsert_article_and_enqueue function
-- ✅ Auto-clustering trigger
```

### 2. Verify Deployment
```sql
-- Check critical constraint is correct
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'article_story'::regclass 
AND conname = 'article_story_similarity_score_check';
-- Should show: CHECK (similarity_score >= 0 AND similarity_score <= 100)

-- Check functions exist
SELECT proname FROM pg_proc 
WHERE proname IN ('attach_or_create_story', 'upsert_article_and_enqueue');
-- Should return 2 rows

-- Check trigger exists
SELECT tgname FROM pg_trigger 
WHERE tgname = 'trigger_enqueue_clustering';
-- Should return 1 row
```

### 3. Deploy Code (if needed)
The clustering code is already in the test branch. If not on main:
```bash
git checkout main
git merge test  # or cherry-pick specific commits
git push origin main
```

### 4. Start Monitoring
```sql
-- Verify migrations applied
SELECT proname FROM pg_proc WHERE proname = 'attach_or_create_story';
SELECT indexname FROM pg_indexes WHERE tablename = 'article_story';
SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_enqueue_clustering';

-- Check new columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'articles' 
AND column_name IN ('url_canonical', 'url_hash', 'source_domain', 'primary_actor', 'categories');
```

2. **Test Algorithm Locally**
```bash
# Run all P1 smoke tests
npm run qa:smoke

# Or run individually:
npm run qa:boundaries   # Algorithm robustness
npm run qa:integration  # DB atomicity  
npm run qa:idempotency  # Job deduplication
npm run qa:concurrency  # Race conditions

# Should all exit 0 with "[OK]" messages
```

3. **Manual Test - Single Article**
```sql
-- Insert test article
INSERT INTO articles (id, title, url, url_canonical, url_hash, published_at, source_name, source_domain)
VALUES (
  'test-cluster-1',
  'Trump announces new immigration policy',
  'https://test.com/article1',
  'https://test.com/article1',
  encode(digest('https://test.com/article1', 'sha256'), 'hex'),
  NOW(),
  'Test Source',
  'test.com'
);

-- Check if clustering job was created (via trigger)
SELECT * FROM job_queue 
WHERE job_type = 'story.cluster' 
ORDER BY created_at DESC LIMIT 1;

-- Run worker to process
node scripts/job-queue-worker.js

-- Verify story was created
SELECT * FROM stories ORDER BY created_at DESC LIMIT 1;

-- Verify article-story link
SELECT * FROM article_story WHERE article_id = 'test-cluster-1';
```

4. **Batch Test - Multiple Articles**
```sql
-- Create batch clustering job
INSERT INTO job_queue (job_type, payload, status, run_at)
VALUES ('story.cluster.batch', '{"limit": 10}'::jsonb, 'pending', NOW())
ON CONFLICT (job_type, payload_hash) DO NOTHING;

-- Run worker
node scripts/job-queue-worker.js

-- Check results
SELECT 
  s.id,
  s.primary_headline,
  COUNT(ast.article_id) as article_count,
  AVG(ast.similarity_score) as avg_score
FROM stories s
JOIN article_story ast ON ast.story_id = s.id
GROUP BY s.id, s.primary_headline
ORDER BY s.created_at DESC
LIMIT 10;
```

## Validation Criteria

### ✅ Algorithm Validation
- [ ] Actor extraction identifies major political figures
- [ ] Jaro-Winkler similarity working (test with near-duplicates)
- [ ] Score calculation matches expected ranges
- [ ] 75% threshold properly enforced
- [ ] Word boundary matching prevents false positives

### ✅ Database Validation  
- [ ] attach_or_create_story() is idempotent
- [ ] No duplicate article_story mappings
- [ ] Advisory locks preventing race conditions
- [ ] Trigger auto-enqueues clustering jobs
- [ ] pgcrypto digest function working

### ✅ Integration Validation
- [ ] RSS fetch → article insert → clustering job created
- [ ] Worker processes story.cluster jobs successfully
- [ ] Batch clustering handles 50+ articles
- [ ] Error handling doesn't crash worker
- [ ] Job enqueue uses upsert (no 409 conflicts)

### ✅ Performance Validation
- [ ] Single article clustering < 500ms
- [ ] Batch of 50 articles < 30 seconds
- [ ] No memory leaks in worker
- [ ] Database queries using indexes

## Monitoring After Deployment

```sql
-- Monitor clustering performance
SELECT 
  job_type,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM job_queue
WHERE job_type LIKE 'story.cluster%'
  AND completed_at IS NOT NULL
GROUP BY job_type, status;

-- Check clustering accuracy (70-80 range for review)
SELECT 
  CASE 
    WHEN similarity_score >= 90 THEN '90-100'
    WHEN similarity_score >= 80 THEN '80-89'
    WHEN similarity_score >= 70 THEN '70-79'
    ELSE '<70'
  END as score_range,
  COUNT(*) as count
FROM article_story
GROUP BY score_range
ORDER BY score_range DESC;

-- Find potential mis-clusterings for review
SELECT 
  ast.article_id,
  a.title as article_title,
  s.primary_headline as story_headline,
  ast.similarity_score
FROM article_story ast
JOIN articles a ON a.id = ast.article_id
JOIN stories s ON s.id = ast.story_id
WHERE ast.similarity_score BETWEEN 70 AND 80
ORDER BY ast.matched_at DESC
LIMIT 20;
```

## Rollback Plan

If issues occur:

1. **Disable Auto-Clustering**
```sql
DROP TRIGGER IF EXISTS trigger_enqueue_clustering ON articles;
```

2. **Stop Processing Cluster Jobs**
Comment out in job-queue-worker.js handlers

3. **Clean Up Bad Data** (if needed)
```sql
-- Remove recent clustering
DELETE FROM article_story 
WHERE matched_at > NOW() - INTERVAL '1 day';

-- Reset stories created today
DELETE FROM stories 
WHERE created_at > NOW() - INTERVAL '1 day';
```

## Production Deployment (After TEST Success)

Only after 24-48 hours of successful TEST operation:

1. Cherry-pick clustering commits to main branch
2. Deploy database migrations to PROD
3. Monitor closely for first 24 hours

## Success Metrics

- **Duplicate reduction**: Target 40% (measure after 100+ articles)
- **Clustering accuracy**: Target 85% correct groupings
- **Processing time**: <500ms per article
- **Error rate**: <1% of clustering jobs
- **70-80 score range**: <10% (edge cases for future review queue)

## Next Steps After Deployment

1. **TTRC-143**: Story Lifecycle Manager (close old stories)
2. **TTRC-148**: Story Enrichment (generate summaries)
3. **TTRC-158**: Review Queue UI (for 70-80% matches)

## Known P1 Fixes Applied

- ✅ ESM module system throughout
- ✅ pgcrypto digest function for hashing
- ✅ Defensive nulls in RPC calls
- ✅ Idempotent job enqueue with upsert
- ✅ Word boundary matching in actor extraction
- ✅ Smart quote normalization
- ✅ Relaxed candidate prefilter (50 recent stories)
- ✅ Added missing columns to articles table

## P1 Fixes Applied (Jan 21, 2025)

### Algorithm Improvements
- ✅ Added `safeJaroWinkler()` wrapper with try-catch protection
- ✅ String length limits (5000 chars) to prevent memory issues
- ✅ Null/undefined handling for all inputs

### Testing Infrastructure  
- ✅ Created 4 P1 smoke tests in `scripts/tests/`
- ✅ Added `npm run qa:smoke` for automated testing
- ✅ Tests cover: boundaries, atomicity, idempotency, concurrency
- ✅ Adjusted scoring curve for more realistic Jaro-Winkler results

### Error Handling
- ✅ Added `withRetry()` utility with exponential backoff + jitter
- ✅ Integrated retry logic in story-cluster-handler.js
- ✅ 3x retry with backoff for transient failures

### Dependencies
- ✅ Added `natural` package to package.json
- ✅ All code uses ESM imports/exports

---

**Last Updated**: January 21, 2025
**Status**: Ready for TEST deployment
**Estimated Time**: 2-3 hours
**Risk Level**: Medium (new core functionality)

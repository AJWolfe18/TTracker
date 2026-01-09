# TTRC-234 Testing Handoff: Article Embedding Generation

**Date:** 2025-10-15
**Status:** Ready for Testing
**Branch:** `test`
**JIRA:** https://ajwolfe37.atlassian.net/browse/TTRC-234

---

## Current Status Summary

### Completed Work ✅

**Article Embeddings:**
- 377/377 articles now have embeddings (100% complete)
- Cost: ~$0.07 for backfill
- Implementation: `scripts/backfill-article-embeddings.js`

**Story Centroids:**
- 201/216 stories now have centroids (93.1% complete)
- Script created: `scripts/recompute-centroids.js`
- Triggers SQL function: `recompute_story_centroids()`
- Execution time: 1.53 seconds

**Security Fixes Applied:**
- Migration 028 includes all 5 security fixes from expert SQL review
- See `docs/handoffs/2025-10-15-ttrc234-security-fixes.md` for details

---

## What Was Built

### 1. Article Enrichment Handler
**File:** `scripts/job-queue-worker.js` (lines 195-252)

**Purpose:** Generates embeddings for articles using OpenAI

**How it works:**
- Job type: `article.enrich`
- Uses OpenAI text-embedding-3-small model
- Generates 1,536-dimensional vectors
- Updates `articles.embedding_v1` column
- Cost: ~$0.0002 per article

### 2. Migration 028
**File:** `migrations/028_add_article_enrich_job.sql`

**Purpose:** Auto-enqueue enrichment jobs for new RSS articles

**Key changes:**
- Updates `upsert_article_and_enqueue_jobs()` RPC function
- Enqueues `article.enrich` job for each new article
- Includes security hardening (search_path lock, payload_hash)
- Content existence check (skips empty articles)

**Security fixes applied:**
1. SECURITY DEFINER hijack prevention (search_path lock)
2. Payload hash computation for deduplication
3. Removed DROP CASCADE (safer migration)
4. Content existence check (cost optimization)
5. Backfill script payload_hash support

### 3. Backfill Script
**File:** `scripts/backfill-article-embeddings.js`

**Purpose:** Backfill embeddings for existing articles

**Usage:**
```bash
# Test with 5 articles
node scripts/backfill-article-embeddings.js 5

# Backfill all articles
node scripts/backfill-article-embeddings.js all
```

**Status:** Already run successfully (377/377 complete)

### 4. Centroid Recomputation Script (NEW)
**File:** `scripts/recompute-centroids.js`

**Purpose:** Trigger exact centroid calculation for all stories

**What it does:**
- Calls SQL function `recompute_story_centroids()`
- Calculates exact centroid from all article embeddings
- Shows before/after stats
- Validates 10+ stories for merge testing

**Usage:**
```bash
node scripts/recompute-centroids.js
```

**Last run result:**
- Before: 5/216 stories with centroids (2.3%)
- After: 201/216 stories with centroids (93.1%)
- Added: 196 centroids in 1.53 seconds

---

## Testing Plan

### Phase 1: Verify Current State ✅ (COMPLETE)

**Check article embeddings:**
```sql
SELECT
  COUNT(*) as total_articles,
  COUNT(embedding_v1) as articles_with_embeddings,
  ROUND(100.0 * COUNT(embedding_v1) / COUNT(*), 1) as pct_complete
FROM articles;
```

**Expected:** 377/377 (100%)

**Check story centroids:**
```sql
SELECT
  COUNT(*) as total_stories,
  COUNT(centroid_embedding_v1) as stories_with_centroids,
  ROUND(100.0 * COUNT(centroid_embedding_v1) / COUNT(*), 1) as pct_complete
FROM stories;
```

**Expected:** 201/216 (93.1%)

---

### Phase 2: Test New RSS Articles (NEEDS TESTING)

**Goal:** Verify new articles auto-generate embeddings

**Steps:**
1. Start job queue worker:
   ```bash
   node scripts/job-queue-worker.js
   ```

2. Trigger RSS fetch manually:
   ```bash
   curl -X POST "$SUPABASE_URL/functions/v1/rss-enqueue" \
     -H "Authorization: Bearer $EDGE_CRON_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"kind":"fetch_all_feeds"}'
   ```

3. Wait for worker to process jobs (check console output)

4. Verify new articles have embeddings:
   ```sql
   SELECT id, title, embedding_v1 IS NOT NULL as has_embedding
   FROM articles
   ORDER BY created_at DESC
   LIMIT 10;
   ```

**Expected:**
- New articles should have `has_embedding = true`
- Console shows: "✅ Generated embedding for article X: { tokens: 150, cost: $0.000003, dimensions: 1536 }"

**Acceptance Criteria:**
- [ ] New articles auto-get enrichment jobs
- [ ] Worker processes jobs successfully
- [ ] Articles populate with embeddings
- [ ] No duplicate jobs created (deduplication works)

---

### Phase 3: Test Centroid Generation (NEEDS TESTING)

**Goal:** Verify story centroids update after new articles added

**Steps:**
1. Check current centroid count:
   ```sql
   SELECT COUNT(*) FROM stories WHERE centroid_embedding_v1 IS NOT NULL;
   ```

2. Run centroid recomputation:
   ```bash
   node scripts/recompute-centroids.js
   ```

3. Verify centroid count increased (if new articles were added to existing stories)

**Expected:**
- Script runs without errors
- Shows before/after stats
- Stories with new articles get updated centroids

**Acceptance Criteria:**
- [ ] Script runs successfully
- [ ] Centroids calculated for stories with articles
- [ ] Execution time <5 seconds for ~200 stories

---

### Phase 4: Test Merge Quality (NEEDS TESTING - BLOCKED ON TTRC-231)

**Goal:** Verify merge detection works with centroids

**Prerequisite:** Need 10+ stories with centroids (✅ COMPLETE - have 201)

**Steps:**
1. Run merge quality test:
   ```bash
   node scripts/test-merge-quality.js
   ```

**Expected:**
- No error: "Not enough stories with embeddings"
- Creates 50 test cases
- Shows precision/recall metrics

**Acceptance Criteria:**
- [ ] Script runs without embedding errors
- [ ] Precision ≥90%
- [ ] Recall ≥85%

**Note:** This is TTRC-231 work, not TTRC-234 - test only to verify unblocked

---

### Phase 5: Cost Verification (NEEDS MONITORING)

**Goal:** Verify ongoing costs stay within budget

**Check daily costs:**
```sql
SELECT day, spent_usd, openai_calls
FROM budgets
ORDER BY day DESC
LIMIT 7;
```

**Expected:**
- One-time backfill: ~$0.07 (already spent)
- Ongoing: ~$0.008/day = ~$0.25/month
- Well within $50/month budget

**Monitor for 1 week:**
- Check daily budget table
- Verify costs match estimates
- Alert if >$1/day (indicates issue)

**Acceptance Criteria:**
- [ ] Daily costs <$0.05
- [ ] Weekly costs <$0.35
- [ ] No unexpected spikes

---

## Edge Cases to Test

### Empty Content Articles
**Scenario:** RSS article with NULL or empty content

**Expected behavior:**
- Migration 028 includes content existence check
- Should NOT enqueue enrichment job
- Should NOT generate embedding
- Should NOT waste API call

**Test:**
1. Manually create article with empty content
2. Check job_queue - should have NO `article.enrich` job
3. Verify article.embedding_v1 remains NULL

### Duplicate Articles
**Scenario:** Same URL published on same day

**Expected behavior:**
- Unique constraint on (url_hash, published_date)
- Should upsert existing article
- Should NOT create duplicate enrichment job (payload_hash deduplication)

**Test:**
1. Fetch RSS feed twice without waiting
2. Check articles table - should have 1 entry per unique (url, date)
3. Check job_queue - should have 1 `article.enrich` job per article (no duplicates)

### Stories Without Articles
**Scenario:** Story exists but has no articles with embeddings

**Expected behavior:**
- Centroid should be NULL
- Recompute script should skip (no avg to calculate)

**Test:**
1. Check current stories without articles
2. Run recompute script
3. Verify these stories still have NULL centroid

**Query:**
```sql
SELECT s.id, s.primary_headline,
       COUNT(a.id) as article_count,
       s.centroid_embedding_v1 IS NOT NULL as has_centroid
FROM stories s
LEFT JOIN article_story asj ON s.id = asj.story_id
LEFT JOIN articles a ON asj.article_id = a.id
GROUP BY s.id, s.primary_headline, s.centroid_embedding_v1
HAVING COUNT(a.id) = 0;
```

### Backfill Idempotency
**Scenario:** Run backfill script twice on same articles

**Expected behavior:**
- Payload hash deduplication prevents duplicate jobs
- Second run should show "Already enqueued" or skip

**Test:**
1. Pick 5 articles without embeddings
2. Run: `node scripts/backfill-article-embeddings.js 5`
3. Immediately run again: `node scripts/backfill-article-embeddings.js 5`
4. Check job_queue - should only have 5 jobs total (not 10)

---

## Rollback Plan (If Needed)

### If Migration 028 Causes Issues:

**Revert function to previous version:**
```sql
-- Check migration history
SELECT version, description, applied_at
FROM schema_migrations
ORDER BY applied_at DESC
LIMIT 5;

-- If needed, manually restore previous upsert_article_and_enqueue_jobs
-- (Function from migration 027 or earlier)
```

**Stop auto-enrichment:**
```sql
-- Quick fix: Modify function to skip enrichment job
CREATE OR REPLACE FUNCTION upsert_article_and_enqueue_jobs(...)
RETURNS ...
AS $$
BEGIN
  -- ... existing code ...

  -- Comment out this block temporarily:
  -- INSERT INTO job_queue (job_type = 'article.enrich', ...) ...

  -- ... rest of function ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### If Costs Spike:

**Emergency stop:**
1. Stop job queue worker: Kill `node scripts/job-queue-worker.js`
2. Delete pending enrichment jobs:
   ```sql
   DELETE FROM job_queue
   WHERE job_type = 'article.enrich'
     AND status = 'pending';
   ```
3. Investigate cause (check daily_budget table, job errors)

---

## Known Issues

### 15 Stories Without Centroids
**Count:** 15/216 stories (7%) still have NULL centroid

**Possible causes:**
1. Stories have no articles
2. Articles have no embeddings (unlikely - 100% have embeddings)
3. Stories not linked in article_story junction table

**Investigation query:**
```sql
SELECT s.id, s.primary_headline,
       COUNT(asj.article_id) as linked_articles,
       COUNT(a.embedding_v1) as articles_with_embeddings
FROM stories s
LEFT JOIN article_story asj ON s.id = asj.story_id
LEFT JOIN articles a ON asj.article_id = a.id AND a.embedding_v1 IS NOT NULL
WHERE s.centroid_embedding_v1 IS NULL
GROUP BY s.id, s.primary_headline
ORDER BY s.last_updated_at DESC;
```

**Fix (if stories genuinely have no articles):**
- This is expected - stories can exist before articles are clustered
- Centroid will be NULL until articles are added
- No action needed

---

## Success Criteria for TTRC-234 Completion

### Must Have (Blockers)
- [x] 377/377 articles have embeddings (100%)
- [x] 10+ stories have centroids for TTRC-231 (have 201)
- [ ] New RSS articles auto-generate embeddings
- [ ] Centroid recomputation script works
- [ ] No duplicate jobs created (deduplication works)
- [ ] Daily costs <$0.05

### Should Have (Important)
- [ ] Merge quality tests run without embedding errors
- [ ] 95%+ stories have centroids (currently 93%)
- [ ] Edge cases tested (empty content, duplicates, idempotency)
- [ ] 1 week of cost monitoring shows <$0.35/week

### Nice to Have (Optional)
- [ ] Automated nightly centroid recomputation (via cron)
- [ ] Dashboard showing embedding/centroid coverage
- [ ] Alert if daily cost exceeds threshold

---

## Files Changed

### Code
- `scripts/job-queue-worker.js` (lines 76, 195-252)
  - Registered `article.enrich` handler
  - Implemented `enrichArticle()` method

### Migrations
- `migrations/028_add_article_enrich_job.sql` (NEW)
  - Updates RPC to enqueue article.enrich jobs
  - Includes 5 security fixes

### Scripts
- `scripts/backfill-article-embeddings.js` (NEW)
  - Backfills existing articles without embeddings
  - Status: Already run (377/377 complete)

- `scripts/recompute-centroids.js` (NEW)
  - Triggers SQL function to calculate exact centroids
  - Status: Run once (201/216 complete)

### Documentation
- `docs/handoffs/2025-10-15-embedding-generation-issue.md` (architecture decision)
- `docs/handoffs/2025-10-15-ttrc234-implementation-complete.md` (implementation summary)
- `docs/handoffs/2025-10-15-ttrc234-security-fixes.md` (security review)
- `docs/handoffs/2025-10-15-ttrc234-testing-handoff.md` (this file)

---

## Next Steps (For Josh)

### Immediate (Today/Tomorrow)

1. **Test Phase 2: New RSS Articles**
   - Start worker: `node scripts/job-queue-worker.js`
   - Trigger RSS fetch (manual or wait for GitHub Actions)
   - Verify new articles get embeddings
   - Check for duplicate jobs

2. **Monitor Costs**
   - Check `budgets` table daily for 1 week
   - Verify <$0.05/day
   - Alert if unexpected spike

3. **Edge Case Testing**
   - Test empty content handling
   - Test duplicate article deduplication
   - Test backfill idempotency

### Short Term (This Week)

4. **Run Merge Quality Test (TTRC-231)**
   - Once confident in embedding pipeline
   - `node scripts/test-merge-quality.js`
   - Document precision/recall results

5. **Investigate 15 Stories Without Centroids**
   - Run investigation query above
   - Determine if expected (no articles) or bug

6. **Complete TTRC-234**
   - Once all tests pass
   - Update JIRA with test results
   - Transition to "Done"

### Long Term (Future Enhancements)

7. **Automate Nightly Centroid Recomputation**
   - Add GitHub Action to run `scripts/recompute-centroids.js`
   - Schedule: 2 AM daily

8. **Create Monitoring Dashboard**
   - Embedding coverage (articles)
   - Centroid coverage (stories)
   - Daily costs
   - Job queue health

---

## Questions/Blockers

### Open Questions
1. **15 stories without centroids** - Expected or bug?
2. **Nightly recomputation** - Should this be automated now or later?
3. **Cost monitoring** - What threshold should trigger alerts?

### Dependencies
- **TTRC-231** - Blocked until TTRC-234 complete
- **Migration 028** - Must be applied before new RSS articles benefit

### Risks
- **Cost spike** - If RSS volume increases unexpectedly
- **API rate limits** - OpenAI rate limits could cause job failures
- **Centroid drift** - Real-time running average vs exact recompute divergence

---

## Cost Summary

### One-Time Costs (Already Spent)
- Backfill 377 articles: ~$0.07

### Ongoing Costs (Estimated)
- ~40 articles/day × $0.0002 = $0.008/day
- $0.25/month
- Well within $50/month budget

### Total Budget Impact
- Year 1: $0.07 (backfill) + $3.00 (ongoing) = **$3.07**
- Ongoing: **$3/year** (~$0.25/month)

---

## References

- **TTRC-234:** https://ajwolfe37.atlassian.net/browse/TTRC-234
- **TTRC-231:** https://ajwolfe37.atlassian.net/browse/TTRC-231 (merge quality testing)
- **Architecture Decision:** `docs/handoffs/2025-10-15-embedding-generation-issue.md`
- **Security Review:** `docs/handoffs/2025-10-15-ttrc234-security-fixes.md`
- **Implementation Summary:** `docs/handoffs/2025-10-15-ttrc234-implementation-complete.md`

---

**Last Updated:** 2025-10-15 (End of session)
**Status:** Code complete, ready for testing
**Next Action:** Josh to run Phase 2-5 tests
**Expected Completion:** Within 1 week (pending test results)

---

## Session Handoff Notes

**What was done this session:**
1. Created `scripts/recompute-centroids.js` to trigger centroid calculation
2. Ran script successfully: 201/216 stories now have centroids (93.1%)
3. Verified article embeddings: 377/377 complete (100%)
4. Applied all 5 security fixes to migration 028
5. Created comprehensive testing handoff documentation

**What's ready:**
- Article embedding pipeline (worker handler + migration)
- Backfill script (already run successfully)
- Centroid recomputation script (already run once)
- Security-hardened migration 028

**What needs testing:**
- New RSS articles auto-enrichment flow
- Centroid recomputation on new data
- Edge cases (empty content, duplicates, idempotency)
- Cost monitoring over 1 week
- Merge quality tests (TTRC-231)

**Blocker status:**
- TTRC-231 is now UNBLOCKED (have 201 stories with centroids, need 10+)
- TTRC-234 is in "Ready for Test" status
- All code complete, awaiting test results

**Tomorrow pickup:**
1. Read this handoff doc
2. Start with Phase 2 testing (new RSS articles)
3. Monitor costs in budgets table
4. Test edge cases
5. Complete TTRC-234 once tests pass

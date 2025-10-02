# RSS System Critical Fixes - September 23, 2025

## ✅ ALL CHANGES HAVE BEEN APPLIED TO YOUR REPOSITORY

### Files Modified/Created:

1. **`scripts/rss/fetch_feed.js`** - MODIFIED
   - Fixed undefined `feed_id` variable
   - Added `feedId` parameter to `processArticleItemAtomic`
   - Updated function calls to pass the parameter

2. **`.github/workflows/rss-e2e-test.yml`** - MODIFIED
   - Added `topics` array to all feed definitions
   - Added `source_name` field
   - Added `source_domain` field
   - Fixed all 5 news feeds configuration

3. **`migrations/005a_fix_rss_function_alignment.sql`** - NEW FILE CREATED
   - Fixes function name mismatch
   - Aligns parameters with JS calls
   - Generates URL hash internally
   - Returns JSONB instead of TABLE
   - Adds missing columns and constraints

## 🚨 CRITICAL NEXT STEPS

### Step 1: Apply the Migration (MUST DO FIRST!)

```sql
-- In TEST Supabase Dashboard (https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu)
-- Go to SQL Editor
-- Copy and run the ENTIRE contents of: migrations/005a_fix_rss_function_alignment.sql
```

### Step 2: Verify Migration Success

Run these queries in SQL Editor:

```sql
-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'upsert_article_and_enqueue_jobs';

-- Test the function
SELECT * FROM upsert_article_and_enqueue_jobs(
  p_url := 'https://test.com/test',
  p_title := 'Test',
  p_content := 'Test content',
  p_published_at := now(),
  p_feed_id := 'test',
  p_source_name := 'Test',
  p_source_domain := 'test.com'
);
```

### Step 3: Commit Changes

```bash
git add -A
git commit -m "Fix RSS critical issues: function alignment and feed configuration

- Fixed undefined feed_id variable in fetch_feed.js
- Added required fields (topics, source_name) to workflow feeds
- Created migration 005a to align SQL function with JS implementation
- Function now returns JSONB as expected by JavaScript
- Added unique constraint for article deduplication"

git push origin main
```

### Step 4: Run E2E Test

1. Go to GitHub Actions
2. Run "RSS E2E Test (Articles Table)" workflow
3. Select environment: test
4. Click "Run workflow"
5. Monitor for success

## What Was Fixed

### Critical Issues Resolved:
- ✅ Function name mismatch (`upsert_article_and_enqueue` vs `upsert_article_and_enqueue_jobs`)
- ✅ Parameter prefix mismatch (`_` vs `p_`)
- ✅ Missing `p_feed_id` parameter in SQL function
- ✅ URL hash not being generated (now done in SQL)
- ✅ Return type mismatch (TABLE vs JSONB)
- ✅ Feed seeds missing required `topics` field
- ✅ JavaScript `feed_id` undefined variable

### Expected Results After Fixes:
- RSS feeds will fetch successfully
- Articles will be stored in `articles` table
- No duplicate articles (unique constraint enforced)
- Jobs will be created for clustering
- E2E test will pass without errors

## Troubleshooting

If you see "function does not exist" error:
- The migration wasn't applied - run it in SQL Editor

If you see "null constraint violation" error:
- Check that all feeds have topics and source_name

If no articles are created:
- Check job_queue for errors
- Verify RSS feeds are accessible

## Summary

All code has been fixed in your repository. The only remaining step is to apply the SQL migration (`migrations/005a_fix_rss_function_alignment.sql`) to your TEST database, then commit and test.

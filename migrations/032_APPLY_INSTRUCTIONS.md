# Migration 032 - Apply Instructions

**Date:** 2025-11-15
**Issue:** Fix digest() errors blocking article storage (TTRC-268/272 follow-up)
**File:** `migrations/032_fix_digest_migration_028.sql`

---

## Problem Summary

Migration 028's `upsert_article_and_enqueue_jobs` function has digest() errors:
- Unqualified `digest()` instead of `extensions.digest()`
- Wrong argument type: TEXT instead of BYTEA
- Missing `gen_random_uuid()` schema qualification

**Impact:** All RSS feeds parse successfully but articles fail to save to database.

---

## Fixes Applied

### 0. Function Drop & Recreate
✅ Line 23-25: `DROP FUNCTION IF EXISTS` (required to change function body with RETURNS clause)

### 1. Digest Function Calls (4 locations)
✅ Line 59: `extensions.digest(convert_to(p_url, 'UTF8'), 'sha256')`
✅ Line 78: `extensions.gen_random_uuid()`
✅ Line 113: `extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256')`
✅ Line 151: `extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256')`

### 2. ON CONFLICT Targets (2 locations)
✅ Line 132: `ON CONFLICT (payload_hash) WHERE (processed_at IS NULL)` (article.enrich)
✅ Line 169: `ON CONFLICT (payload_hash) WHERE (processed_at IS NULL)` (process_article)

### 3. Type Safety
✅ Line 93: `p_feed_id::bigint` (article INSERT)
✅ Line 106: `feed_id = EXCLUDED.feed_id` (article ON CONFLICT UPDATE)
✅ Line 148: `'feed_id', (p_feed_id::bigint)` (job payload)

### 4. Input Validation
✅ Line 54-56: NULL/blank URL guard (fail fast)

---

## How to Apply

### Step 1: Open Supabase SQL Editor
1. Go to Supabase Dashboard → SQL Editor
2. Click "New Query"

### Step 2: Paste Migration
Copy entire contents of `migrations/032_fix_digest_migration_028.sql` into the editor

### Step 3: Run Migration
Click "Run" button

### Step 4: Verify Success
You should see:
```
Success. No rows returned
```

**Note:** The verification block will output "NOTICE: Migration 032 verification PASSED" in PostgreSQL logs, but Supabase SQL Editor shows "Success. No rows returned" which indicates successful execution.

---

## Smoke Test (After Apply)

### Test 1: Call RPC Directly
```sql
SELECT public.upsert_article_and_enqueue_jobs(
  p_url := 'https://example.com/test-article',
  p_title := 'Test Article',
  p_content := 'Test content for smoke test',
  p_published_at := NOW(),
  p_feed_id := '1',
  p_source_name := 'Test Source',
  p_source_domain := 'example.com'
);
```

**Expected:** Returns JSONB with `article_id`, `is_new: true`, `job_enqueued: true`

### Test 2: Verify Deduplication
Run the same query again.

**Expected:** Returns same `article_id`, `is_new: false`, no new jobs created

### Test 3: Check Job Queue
```sql
SELECT job_type, status, payload->>'article_id', created_at
FROM job_queue
WHERE job_type IN ('process_article', 'article.enrich')
ORDER BY id DESC
LIMIT 5;
```

**Expected:** See 2 jobs (process_article + article.enrich) for the test article

### Test 4: Monitor Worker
Watch worker console for successful article creation (no digest errors)

**Expected:**
```json
{"level":"INFO","message":"RSS feed processing completed","articles_created":1}
```

### Test 5: Check Articles Table
```sql
SELECT id, title, source_name, created_at
FROM articles
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:** See newly created articles with IDs like `art-{uuid}`

---

## Rollback Plan

If migration fails, rollback to Migration 028:
```sql
-- Paste contents of migrations/028_add_article_enrich_job.sql
```

---

## Next Steps After Success

1. ✅ Monitor worker for 5 minutes (verify no digest errors)
2. ✅ Check articles table for new entries
3. ✅ Seed fresh RSS jobs: `node scripts/seed-fetch-jobs.js`
4. ✅ Create JIRA ticket documenting the fix
5. ✅ Update handoff document

---

## Technical Details

**Function Signature:**
```sql
upsert_article_and_enqueue_jobs(
  p_url text,
  p_title text,
  p_content text,
  p_published_at timestamptz,
  p_feed_id text,
  p_source_name text,
  p_source_domain text,
  p_content_type text DEFAULT 'news_report',
  p_is_opinion boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
```

**Permissions:** SECURITY DEFINER, service_role only

**Index Used:** `ux_job_queue_payload_hash_active` (partial index on payload_hash WHERE processed_at IS NULL)

---

**Created by:** Claude Code
**Review:** All feedback from user incorporated
**Status:** Ready to apply

# Migration 019: Story Enrichment Helpers

**JIRA:** TTRC-190  
**Date:** 2025-10-03  
**Environment:** TEST first, then PROD

---

## What This Migration Does

1. **Performance Indexes** - Speeds up article/story queries during enrichment
2. **Job Idempotency** - Prevents duplicate enrichment jobs
3. **Budget RPC** - Tracks OpenAI costs atomically
4. **Security** - Locks down permissions on budget function
5. **Worker Optimization** - Composite indexes for fast job claiming and article ordering
6. **Precision Fix** - Increases spent_usd from 2 to 6 decimal places for micro-costs

---

## Step 1: Apply Migration to TEST

```bash
# Connect to TEST Supabase and run migration
psql "postgresql://postgres.qyoiudzpelswvztbmvzl:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f migrations/019_story_enrichment_helpers.sql
```

**Expected output:**
```
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE FUNCTION
REVOKE
GRANT
ALTER FUNCTION
ALTER TABLE
INSERT 0 1
```

---

## Step 2: Verify Migration Succeeded

```bash
# Run verification queries
psql "postgresql://postgres.qyoiudzpelswvztbmvzl:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f migrations/019_verify.sql
```

**What to look for:**
- ✅ 5 indexes found
- ✅ 1 RPC function found
- ✅ 1 budget row for today exists
- ✅ Test job inserts successfully
- ✅ Second insert with same hash should fail (commented out)
- ✅ spent_usd precision is 6 decimal places (PASS status)

---

## Step 3: Test RPC Function from Node.js

```bash
# Test the increment_budget function
node test-increment-budget.js
```

**Expected output:**
```
✅ RPC call succeeded
✅ Budget tracking working correctly!
✅ Budget accumulation working correctly!
```

---

## Step 4: Update Worker to Use RPC (Optional - Phase 3)

The worker already has budget tracking, but this migration enables atomic updates. 
We'll integrate the RPC function in Phase 3 (backfill).

---

## What Gets Created

### Indexes
- `uq_job_payload` - Unique constraint on (type, payload_hash) for pending/processing jobs
- `idx_article_story_story` - Fast lookups of articles by story_id
- `idx_articles_published_at` - Fast date-ordered article queries
- `idx_article_story_story_order` - Composite index for enrichment article fetch (supports ORDER BY is_primary_source, similarity_score, matched_at)
- `idx_job_queue_pending_run_at` - Fast job claiming (supports WHERE status='pending' AND run_at <= now() ORDER BY run_at)

### RPC Function
```sql
increment_budget(p_day DATE, p_cost NUMERIC, p_calls INTEGER)
```

**Important:** When calling from JavaScript, pass `p_cost` as a string to preserve decimal precision:
```javascript
await supabase.rpc('increment_budget', {
  p_day: '2025-10-04',
  p_cost: '0.001',  // String, not number!
  p_calls: 1
});
```

### Column Precision Fix
- `spent_usd` changed from `NUMERIC(8,2)` → `NUMERIC(10,6)`
- **Why:** OpenAI enrichment costs are ~$0.000167 per story (requires 6 decimal places)
- **Before:** Costs rounded to $0.00 (unusable)
- **After:** Accurate micro-cost tracking

### Security
- Function only callable by service_role (Edge Functions)
- Public access revoked
- SQL injection protection via search_path

---

## Cost Impact

**None** - Database objects only, no operational cost

---

## Rollback (If Needed)

```sql
-- Drop indexes
DROP INDEX IF EXISTS public.uq_job_payload;
DROP INDEX IF EXISTS public.idx_article_story_story;
DROP INDEX IF EXISTS public.idx_articles_published_at;

-- Drop function
DROP FUNCTION IF EXISTS public.increment_budget(date, numeric, integer);
```

---

## Next Steps

After successful TEST verification:
1. ✅ Commit migration file to git
2. ✅ Update JIRA TTRC-190 to "Done"
3. ⏳ Wait for Phase 3 (TTRC-191) to use these helpers for backfill
4. ⏳ Apply to PROD when ready to run backfill

---

## Files Created

- `migrations/019_story_enrichment_helpers.sql` - Main migration
- `migrations/019_verify.sql` - Verification queries
- `test-increment-budget.js` - RPC function test script
- `migrations/README_MIGRATION_019.md` - This file

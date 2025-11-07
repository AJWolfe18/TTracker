# Apply Migration 021a - Lower Threshold to 50

## Quick Action (30 seconds)

1. Open Supabase SQL Editor (TEST project)
2. Copy `migrations/021a_adjust_threshold.sql`
3. Paste and execute
4. Watch for: `DROP FUNCTION`, `CREATE FUNCTION`, `GRANT`, `COMMENT`

## What This Does

Lowers clustering threshold from 65 → 50 points to test if `pg_trgm` similarity is working.

**Current**: 49 articles → 49 stories (nothing clusters)
**Expected After Fix**: Some related articles should cluster together

## Next Steps

After applying:
1. Kill the current worker (Ctrl+C)
2. Clear existing stories:
   ```sql
   DELETE FROM article_story WHERE story_id >= 116;
   DELETE FROM stories WHERE id >= 116;
   ```
3. Restart worker: `node scripts/job-queue-worker.js`
4. Re-cluster: `node scripts/recluster-today.js`
5. Check results in 30 seconds

---

**Created**: 2025-10-11
**Why**: pg_trgm similarity scores may be lower than expected, preventing any clustering

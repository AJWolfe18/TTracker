# Apply Migration 022 - Quick Instructions

## Option 1: Supabase SQL Editor (Recommended - 5 minutes)

1. **Open Supabase TEST project**
   - Go to: https://supabase.com/dashboard
   - Select your TEST project

2. **Open SQL Editor**
   - Click "SQL Editor" in left sidebar
   - Click "New query"

3. **Copy & Execute Migration**
   - Open `migrations/022_clustering_v2_schema.sql` in this repo
   - Copy entire contents
   - Paste into SQL Editor
   - Click "Run" button

4. **Verify Success**
   - Should see multiple "SUCCESS" messages
   - If you see "already exists" errors - that's OK! (means it's idempotent)

5. **Quick Test**
   ```sql
   -- Check new columns exist
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name = 'articles'
     AND column_name IN ('embedding_v1', 'entities', 'keyphrases');

   -- Should return 3 rows

   -- Check cost tracking table
   SELECT COUNT(*) FROM openai_usage;
   -- Should return 0

   -- Check helper function
   SELECT get_daily_openai_spend();
   -- Should return 0.000000
   ```

## Option 2: Via Script (if you prefer CLI)

```bash
node scripts/apply-migration-022.js
```

**Note**: This may fail due to RPC limitations. If it does, use Option 1 (SQL Editor).

---

## What This Migration Does

✅ Adds embedding columns (versioned for future-proofing)
✅ Adds entity/content metadata columns
✅ Creates performance indexes (HNSW, GIN)
✅ Creates cost tracking table
✅ Adds helper functions for budget monitoring

## Safe to Run Multiple Times?

**YES!** All statements use `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`.

## Next Steps After Migration

Once applied, run:

```bash
# Test on 5 articles (dry-run)
node scripts/backfill-clustering-v2.js --dry-run --limit=5

# If dry-run looks good, process 5 articles
node scripts/backfill-clustering-v2.js --limit=5
```

---

**Estimated time**: 5 minutes
**Risk**: Low (idempotent, no data loss)
**Cost**: $0 (just schema changes)

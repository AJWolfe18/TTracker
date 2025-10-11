# ⚠️ URGENT: Apply Migration 021 to Fix Clustering

## The Problem
The database RPC `attach_or_create_story` was hardcoded to return a similarity score of **75.0** for ALL articles and only matched on actor. This caused massive over-clustering (articles scoring 36-41 points were incorrectly grouping together).

## The Fix
Migration 021 implements the actual clustering algorithm with:
- ✅ Real title similarity scoring (using PostgreSQL's pg_trgm extension)
- ✅ Time window filter (±72 hours)
- ✅ Date proximity scoring (0-10 points)
- ✅ Actor matching (5 points)
- ✅ URL duplicate detection (30 points)
- ✅ Threshold: 65 points (max realistic: 90)

## How to Apply (2 minutes)

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your **TEST** project (wnrjrywpcadwutfykflu)
3. Click "SQL Editor" in the left sidebar
4. Click "New Query"

### Step 2: Copy & Execute the Migration
1. Open `migrations/021_fix_clustering_rpc.sql` in this directory
2. Copy the ENTIRE contents
3. Paste into the Supabase SQL Editor
4. Click "Run" (or press Ctrl+Enter)

### Step 3: Verify Success
You should see output like:
```
DROP FUNCTION
CREATE FUNCTION
CREATE EXTENSION
GRANT
COMMENT
```

If you see any errors about `pg_trgm`, it means the extension needs to be enabled first. Just re-run the migration.

## What Happens Next

Once applied:
1. Stop both job queue workers (kill the processes)
2. Clear existing bad clusters:
   ```sql
   DELETE FROM article_story WHERE story_id IN (105, 106, 114, 115);
   DELETE FROM stories WHERE id IN (105, 106, 114, 115);
   ```
3. Restart the job queue worker
4. Re-cluster today's articles to test the fix

## Testing the Fix

After re-clustering, run:
```bash
node scripts/analyze-story-114.js
```

You should see articles with scores <65 create NEW stories instead of clustering together.

---

**Created**: 2025-10-11
**Priority**: CRITICAL - Fixes production clustering bug
**Est. Time**: 2 minutes to apply

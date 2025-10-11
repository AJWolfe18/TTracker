# 🚨 CRITICAL FINDING: pg_trgm Extension Not Working

## Problem

Migration 021a lowered the clustering threshold from 65 to 50, but **ALL 49 articles still created separate stories** (stories 116-164). This is exactly the same problem as before Migration 021.

## Evidence from Worker Logs

```
[story.cluster] Article art-ba8a595e-... created: { story_id: 124, similarity_score: 100 }
[story.cluster] Article art-3de0e933-... created: { story_id: 125, similarity_score: 100 }
[story.cluster] Article art-2fc33ebe-... created: { story_id: 126, similarity_score: 100 }
... (repeated for all 49 articles)
```

**Every single article**:
- Creates a NEW story (`created_new: true`)
- Gets similarity_score: 100 (meaning no match found)
- **ZERO articles cluster together**

## Root Cause Analysis

The `pg_trgm` `similarity()` function is returning values so low that even with threshold=50, nothing meets the cutoff.

**Possible causes**:
1. `pg_trgm` extension not properly enabled
2. `similarity()` function not available in Supabase TEST environment
3. Function syntax error in Migration 021/021a

## What Should Happen

With threshold=50 and actual similarity scoring, we should see:
- Some articles attaching to existing stories (similarity_score: 50-90)
- Related articles clustering together (e.g., multiple Letitia James stories)
- Only truly unique articles creating new stories

## Immediate Next Steps

1. **Verify pg_trgm extension is enabled**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_trgm';
   ```

2. **Test similarity() function directly**
   ```sql
   SELECT similarity('trump', 'trump'); -- Should return 1.0
   SELECT similarity('trump announces', 'trump threatens'); -- Should return ~0.4-0.6
   ```

3. **If pg_trgm isn't working**: Fall back to simpler matching:
   - Word overlap percentage
   - Basic string distance (Levenshtein)
   - Or accept threshold=0 (only exact duplicates cluster)

## Status

- Migration 021: ✅ Applied (fixed hardcoded score bug)
- Migration 021a: ✅ Applied (lowered threshold to 50)
- **Clustering: ❌ STILL BROKEN** (pg_trgm not functioning)

---
**Created**: 2025-10-11 12:00 AM
**Priority**: CRITICAL - Zero clustering is happening

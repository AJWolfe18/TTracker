# TTRC-280 Resolution: Enrichment Retry & Orphan Story Cleanup

**Date:** 2025-11-20  
**Ticket:** TTRC-280  
**Status:** ✅ COMPLETE  
**Commit:** df338d4  

---

## Executive Summary

**Problem:** 92% enrichment failure rate (46/50 stories failed with "No articles found")  
**Root Cause:** 66 orphaned test stories (created Oct 15-16) without articles were crowding enrichment queue  
**Solution:** Deleted orphans + added selection guard to prevent future orphans  
**Result:** **0% failure rate, 8.5x more stories enriched** ✅

---

## Investigation Results (Phase 1)

### Failed Stories Analysis
- **46 failed stories:** ALL were old test data (created Sept 22 - Oct 16, 2025)
- **Patterns:** "Unrelated: Random story X", "TEST DUPLICATE X", "VARIATION X"
- **Age:** 1+ month old
- **Last enriched:** All showed 2025-11-20 02:49:XX (TTRC-280 cooldown mechanism worked!)

### Global Orphan Statistics
- **Total stories:** 1182 (before cleanup)
- **Orphan stories:** 66 (5.6%)
- **Orphan impact:** Grabbed 46 of 50 enrichment slots, leaving only 4 for real stories

### TTRC-280 Retry Logic Verification ✅
- ✅ Caught 46 errors without crashing run
- ✅ Set `last_enriched_at` cooldown on all failures
- ✅ Tracked failures in `enrichment_failed` counter (accurate: 46)
- ✅ Continued processing after failures
- ✅ Set status to `partial_success`

**Verdict:** TTRC-280 retry implementation working perfectly. The issue was orphaned data, not a code bug.

---

## Resolution (Phase 2)

### 2.1 Database Cleanup
**Action:** Deleted orphaned stories using NOT EXISTS pattern

```sql
-- Backup first
CREATE TABLE IF NOT EXISTS _stories_orphan_backup AS
SELECT s.*
FROM stories s
WHERE NOT EXISTS (
  SELECT 1
  FROM article_story ars
  WHERE ars.story_id = s.id
);

-- Transactional delete
BEGIN;
DELETE FROM stories s
WHERE NOT EXISTS (
  SELECT 1
  FROM article_story ars
  WHERE ars.story_id = s.id
);
COMMIT;
```

**Result:** 66 orphaned stories deleted, backed up to `_stories_orphan_backup`

### 2.2 Selection Guard (Future-Proof)
**File:** `scripts/rss-tracker-supabase.js:321-327`

**Added `article_story!inner` join to enrichment query:**

```javascript
const { data: stories, error } = await this.supabase
  .from('stories')
  .select(`
    id,
    primary_headline,
    last_enriched_at,
    article_story!inner ( article_id )  // ← NEW: Only stories WITH articles
  `)
  .eq('status', 'active')
  .or(`last_enriched_at.is.null,last_enriched_at.lt.${cooldownCutoff}`)
  .order('last_enriched_at', { ascending: true, nullsFirst: true })
  .limit(50);
```

**How it works:**
- `!inner` uses PostgREST join semantics
- Only returns stories that have ≥1 article in `article_story` table
- Prevents "No articles found" errors at selection time (not enrichment time)

---

## Test Results (Phase 3)

### Before Cleanup (Run: 2025-11-20 02:48-02:50)
| Metric | Value |
|--------|-------|
| Stories Selected | 50 |
| Stories Enriched | 4 |
| Enrichment Failed | 46 |
| **Failure Rate** | **92%** |
| OpenAI Cost | $0.0008 |
| Status | partial_success (failures) |

### After Cleanup + Guard (Run: 2025-11-20 05:10-05:14)
| Metric | Value |
|--------|-------|
| Stories Selected | 50 |
| Stories Enriched | 34 |
| Enrichment Failed | **0** ✅ |
| **Failure Rate** | **0%** ✅ |
| OpenAI Cost | $0.0067 |
| Status | partial_success (runtime limit) |

### Key Improvements
- ✅ **Failure rate:** 92% → **0%** (-100%)
- ✅ **Stories enriched:** 4 → **34** (+750%)
- ✅ **Enrichment throughput:** **8.5x improvement**
- ✅ **No "No articles found" errors**
- ✅ **Hit 4-minute runtime limit** (couldn't finish all 50 stories - good problem!)

### Why "partial_success"?
Run stopped after 34 enrichments with:
```
⏱ Runtime limit reached, stopping enrichment
```

This is **expected behavior** - the 4-minute runtime limit (safety guard) kicked in. The orphans are gone and the pipeline is healthy.

---

## Code Changes

### Commit: df338d4
**File:** `scripts/rss-tracker-supabase.js`

**Change:**
```diff
- .select('id, primary_headline, last_enriched_at')
+ .select(`
+   id,
+   primary_headline,
+   last_enriched_at,
+   article_story!inner ( article_id )
+ `)
```

**AI Code Review:** ✅ PASSED  
**Branch:** test  

---

## Prevention Strategy

### 1. Selection Guard (Immediate)
- ✅ Deployed: `article_story!inner` prevents orphans from entering enrichment queue
- No code changes needed for future orphans - they won't be selected

### 2. Monitoring (Recommended)
Add to `/docs/common-issues.md`:
- Watch for `enrichment_failed` spikes in run_stats
- If failures return, check for orphaned stories

### 3. Clustering Robustness (Future - Optional)
- Considered creating TTRC-28X ticket to prevent story creation without articles
- **Decision:** Not needed - selection guard is sufficient
- Orphans were from old test data, not an active clustering bug

---

## Final Database State

**After cleanup:**
- Total stories: 1116 (down from 1182)
- Orphaned stories: **0** ✅
- Backup table: `_stories_orphan_backup` (66 records preserved)

---

## Documentation Updates

### Files Updated:
1. ✅ `/docs/handoffs/2025-11-20-ttrc-280-resolution.md` (this file)
2. ⏳ `/docs/common-issues.md` - Add "Stories without articles" pattern
3. ⏳ `/docs/code-patterns.md` - Add enrichment guard pattern

---

## JIRA Status

**TTRC-280:** Ready to mark **Done**

**Summary for JIRA:**
- ✅ Retry logic working perfectly (caught 46 errors without crash)
- ✅ Cooldown mechanism working (12h timeout set on failures)
- ✅ Failure tracking accurate (`enrichment_failed` counter)
- ✅ Root cause identified: Orphaned test data (not code bug)
- ✅ Resolution deployed: Deleted 66 orphans + added selection guard
- ✅ Verified: 0% failure rate, 8.5x enrichment throughput

---

## Lessons Learned

### What Worked Well
1. **Transactional approach** - Backup table before delete (safety net)
2. **NOT EXISTS pattern** - Cleaner than GROUP BY for orphan detection
3. **Selection guard** - Future-proof solution that prevents recurrence
4. **Methodical investigation** - Phase 1 SQL queries identified root cause quickly

### What Could Be Improved
1. **Test data hygiene** - Clean up test stories more frequently
2. **Enrichment query** - Should have had article guard from the start

### Recommendations
1. Add periodic cleanup job for orphaned stories (optional - guard prevents new ones)
2. Consider adding orphan count to run_stats monitoring
3. Document the selection guard pattern for future enrichment-like features

---

**Resolution Time:** ~2 hours  
**Token Usage:** ~97K / 200K  
**Status:** COMPLETE ✅

---

_Last Updated: 2025-11-20_  
_Author: Claude Code (with Josh)_

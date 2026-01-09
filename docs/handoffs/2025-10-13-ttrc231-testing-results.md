# TTRC-231 Testing Results & Critical Fixes Needed

**Date:** 2025-10-13
**Session:** Testing and validation of lifecycle/auto-split/periodic-merge implementation
**Status:** 🚨 **BLOCKED - 2 Critical Issues Found**
**JIRA:** [TTRC-231](https://ajwolfe37.atlassian.net/browse/TTRC-231)
**Branch:** `test`
**Commit:** `d6c294f` (feat: implement lifecycle, auto-split, and periodic merge)

---

## Executive Summary

Implementation of TTRC-231 is **functionally complete** but **NOT production-ready**. Both AI code review and comprehensive testing identified **2 CRITICAL issues** that will cause data loss and database errors. These must be fixed before deployment.

**Risk Level:** MEDIUM (without fixes: HIGH)
**Time to Fix:** 4-6 hours
**Time to QA:** 2-3 days manual testing

---

## What We Built (All Complete ✅)

### 1. Lifecycle Management
- ✅ `scripts/rss/lifecycle.js` - Automatic state transitions (emerging → growing → stable → stale)
- ✅ `scripts/enqueue-lifecycle-job.js` - Manual trigger helper
- ✅ Job handler added to `scripts/job-queue-worker.js`
- ✅ Routing added to `supabase/functions/rss-enqueue/index.ts`
- ✅ Already has hourly cron in `.github/workflows/job-scheduler.yml`

### 2. Auto-Split Detection
- ✅ `scripts/rss/auto-split.js` - Coherence calculation (<0.50 triggers split)
- ✅ Uses pairwise cosine similarity with sampling (max 20 articles)
- ✅ Job handler added to worker
- 🚨 **CRITICAL BUG:** Risk of orphaning articles (see below)

### 3. Periodic Merge
- ✅ `migrations/025_story_merge_audit.sql` - Audit table for merges
- ✅ `scripts/rss/periodic-merge.js` - Merge detection (>0.70 similarity, 3+ entities, same actor)
- ✅ `scripts/enqueue-merge-job.js` - Manual trigger helper
- ✅ `.github/workflows/story-merge.yml` - Daily cron at 2am UTC
- ✅ Job handler added to worker
- ✅ Routing added to rss-enqueue
- 🚨 **CRITICAL BUG:** FK constraint violation (see below)

---

## 🚨 CRITICAL ISSUES (MUST FIX)

### CRITICAL #1: Foreign Key Constraint Violation
**File:** `migrations/025_story_merge_audit.sql` lines 18-19
**Severity:** HIGH - Will cause database errors

**Problem:**
```sql
source_story_id BIGINT NOT NULL,
target_story_id BIGINT NOT NULL,
...
CONSTRAINT fk_source_story FOREIGN KEY (source_story_id)
  REFERENCES stories(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
```

Columns are `NOT NULL` but FK tries to `SET NULL` on delete = **logical impossibility**.

**Impact:**
- Migration succeeds initially
- When stories are deleted, DB throws constraint violation errors
- Audit trail becomes corrupted/incomplete

**Fix Options:**
```sql
-- Option 1: Make columns nullable (RECOMMENDED for audit table)
source_story_id BIGINT,
target_story_id BIGINT,

-- Option 2: Use CASCADE instead
ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
```

**Recommendation:** Use Option 1 (nullable) since this is an audit table - preserving story IDs even after deletion is valuable for historical analysis.

---

### CRITICAL #2: Data Loss Risk in splitStory()
**File:** `scripts/rss/auto-split.js` lines 220-246
**Severity:** CRITICAL - Articles can be permanently lost

**Problem:**
Current sequence:
1. Fetch articles (line 203-214)
2. **Delete ALL article links from original story** (line 220-224) ⚠️
3. Re-cluster each article individually (line 236-245)

If re-clustering fails (network error, DB timeout, etc.), articles are **orphaned** - no longer linked to ANY story and cannot be recovered without manual SQL intervention.

**Impact:**
- Articles permanently disappear from system
- No rollback mechanism
- User data loss

**Fix:**
```javascript
// BETTER APPROACH: Only delete AFTER successful re-clustering
const newLinks = [];
for (const article of articles) {
  try {
    const result = await clusterArticle(article.id);
    if (result.success && result.story_id) {
      newLinks.push({ article_id: article.id, new_story_id: result.story_id });
    }
  } catch (err) {
    console.error(`Failed to cluster article ${article.id}:`, err.message);
    // Keep article in original story on failure
  }
}

// Only remove successfully re-clustered articles
if (newLinks.length > 0) {
  for (const link of newLinks) {
    await supabase.from('article_story')
      .delete()
      .eq('story_id', storyId)
      .eq('article_id', link.article_id);
  }
}
```

---

## ⚠️ HIGH-PRIORITY WARNINGS

### WARNING #1: Missing Split Audit Table
**Impact:** Cannot rollback splits, no historical record
**Fix:** Create `story_split_actions` table matching merge audit structure

### WARNING #2: No Deduplication in Merge Detection
**Impact:** Could create merge chains (A→B, then B→C) instead of direct merges
**Fix:** Track merged stories in loop, skip already-merged stories

### WARNING #3: GitHub Actions Workflow Missing Permissions
**File:** `.github/workflows/story-merge.yml`
**Impact:** Security - GITHUB_TOKEN has broader permissions than needed
**Fix:**
```yaml
name: Story Merge Detection

permissions:
  contents: read

on:
  schedule:
    - cron: '0 2 * * *'
```

### WARNING #4: No Failure Alerting in Workflows
**Impact:** Silent failures - no one knows if merge job fails
**Fix:** Add Slack/email notifications or JIRA comments on failure

### WARNING #5: Sampling Bias in Coherence Calculation
**Impact:** Fixed-step sampling may miss time-concentrated bursts of incoherent articles
**Fix:** Use random sampling instead of fixed-step

---

## ✅ What's Working Well

- **Core algorithms are sound** - Coherence, merge criteria, lifecycle thresholds all validated
- **Merge operations safe** - Complete audit trail, articles moved (not deleted)
- **Integration points correct** - All handlers wired properly in worker and edge functions
- **Error handling consistent** - `{success: boolean, error?: string}` pattern throughout
- **Async/await correct** - No dangling promises
- **Performance optimized** - Sampling prevents O(n²) from becoming bottleneck

---

## Testing Coverage

### ✅ Completed
- Code quality review (imports, async/await, SQL syntax)
- Algorithm validation (cosine similarity, merge criteria, thresholds)
- Integration point verification (worker handlers, edge function routing)
- Edge case identification (0 articles, missing embeddings, large stories)
- AI code review via GitHub Actions

### ⏸️ Not Yet Done (Blocked by Critical Fixes)
- Manual testing with real data
- Split operation with network failures
- Merge with already-merged stories
- Concurrent job execution
- Performance testing with 50+ article stories
- End-to-end workflow testing

---

## Files Modified in This Session

### New Files Created (7):
1. `scripts/rss/lifecycle.js` - 186 LOC
2. `scripts/rss/auto-split.js` - 339 LOC (🚨 HAS CRITICAL BUG)
3. `scripts/rss/periodic-merge.js` - 370 LOC
4. `scripts/enqueue-lifecycle-job.js` - 44 LOC
5. `scripts/enqueue-merge-job.js` - 52 LOC
6. `migrations/025_story_merge_audit.sql` - 114 LOC (🚨 HAS CRITICAL BUG)
7. `.github/workflows/story-merge.yml` - 17 LOC (⚠️ NEEDS PERMISSIONS FIX)

### Modified Files (2):
1. `scripts/job-queue-worker.js` - Added 3 handlers (lifecycle, split, merge)
2. `supabase/functions/rss-enqueue/index.ts` - Added routing for lifecycle and merge jobs

### Documentation:
- `docs/handoffs/2025-10-13-ttrc231-COMPLETE.md` - Original completion handoff (premature)
- `docs/handoffs/2025-10-13-ttrc231-testing-results.md` - This document (current state)

---

## Cost Analysis

**Implementation Cost:** $0 (no new OpenAI calls, reuses existing embeddings)
**Testing Cost:** ~$0.50 (AI code review + testing subagent)
**Monthly Operational Cost:** $0 (all jobs are SQL-based, no AI calls)

---

## Next Steps (Start Here Tomorrow)

### Phase 1: Fix Critical Issues (Priority 1 - Do First)
1. **Fix migration 025** - Make FK columns nullable (1 hour)
   - File: `migrations/025_story_merge_audit.sql`
   - Test: Apply migration, delete a merged story, verify audit table intact

2. **Fix splitStory() data loss risk** (2-3 hours)
   - File: `scripts/rss/auto-split.js`
   - Reorder operations to prevent article orphaning
   - Add transaction safety or rollback mechanism
   - Test: Trigger split with simulated network failures

3. **Add workflow permissions** (15 minutes)
   - File: `.github/workflows/story-merge.yml`
   - Add `permissions: {contents: read}`

### Phase 2: High-Priority Improvements (Priority 2)
4. Create `story_split_actions` audit table (1 hour)
5. Add deduplication check in merge detection (1 hour)
6. Add GitHub Actions failure notifications (30 minutes)

### Phase 3: Manual Testing (Priority 3)
7. Test lifecycle transitions with backdated stories
8. Test split with unrelated articles
9. Test merge with duplicate stories
10. Test concurrent operations
11. Performance test with large stories (50+ articles)

### Phase 4: Deploy to Production (After All Tests Pass)
12. Update JIRA to "Ready for Prod"
13. Create deployment checklist
14. Monitor for 48 hours post-deploy
15. Document rollback procedures

---

## Known Issues & Edge Cases

### Handled Correctly ✅
- Articles missing embeddings (filtered out, returns null)
- Single-article stories (coherence = 1.0, won't split)
- Empty centroid embeddings (merge skips, no crash)
- Large stories (sampling limits to 190 comparisons)

### Not Handled ❌
- 0-article stories (linger as "zombies")
- Concurrent lifecycle updates (no mutex/advisory lock)
- Merge source/target same ID (very rare, would require DB corruption)
- Split audit trail (no record of splits performed)

---

## JIRA Status

**Current:** In Review
**Next:** Blocked (after documenting these findings)
**Reason:** Critical bugs must be fixed before testing can proceed

---

## Success Metrics (After Fixes)

### Lifecycle Management
- [ ] Stories transition through states correctly
- [ ] Stale stories (>5 days) marked properly
- [ ] No performance degradation on hourly runs

### Auto-Split
- [ ] Low-coherence stories (<0.50) split successfully
- [ ] No articles lost during split operations
- [ ] Original story archived properly
- [ ] Split audit trail complete

### Periodic Merge
- [ ] Duplicate stories merged correctly
- [ ] Audit table tracks all merge operations
- [ ] No merge chains created
- [ ] Articles moved (not lost)
- [ ] Merge operations reversible via audit table

---

## Architecture Context

**Database:** Supabase TEST environment
**Branch:** `test` (auto-deploys to Netlify test site)
**Job Queue:** Existing worker at `scripts/job-queue-worker.js`
**Cron Jobs:** GitHub Actions (lifecycle: hourly at :05, merge: daily at 2am UTC)
**Edge Functions:** Supabase Deno-based (rss-enqueue handles routing)

---

## Testing Agent Report Location

Full 10-section testing report available in previous session context:
- Executive Summary
- Critical Issues (2)
- Warnings (5)
- Edge Cases (5)
- Algorithm Validation
- Data Safety Assessment
- Integration Points Validation
- Code Quality Checks
- Test Coverage Assessment
- Production Readiness Checklist

**AI Code Review:** GitHub Actions run 18479700197 (completed successfully but hit token limits, JSON parsing failed)

---

## Questions for Tomorrow

1. Should we create split audit table now or defer to later?
2. Should we add random sampling or keep fixed-step for now?
3. Do we need rollback scripts before deploying merge functionality?
4. Should merge/split be feature-flagged for gradual rollout?
5. What's the acceptable risk level for initial production deployment?

---

## Resources

- **Handoff Docs:** `/docs/handoffs/2025-10-13-ttrc231-*.md`
- **Implementation Plan:** `/docs/handoffs/2025-10-13-ttrc231-plan.md`
- **Original Todo List:** `/docs/handoffs/2025-10-13-ttrc231-todos.md`
- **Migration:** `/migrations/025_story_merge_audit.sql`
- **Scripts:** `/scripts/rss/{lifecycle,auto-split,periodic-merge}.js`
- **Workflow:** `.github/workflows/story-merge.yml`

---

## Definition of Done (Not Yet Met)

- ✅ Business outcome clearly stated
- ✅ Feature implemented
- ❌ Edge cases handled (2 critical bugs found)
- ❌ No regressions (testing blocked)
- ✅ Cost <$50/month ($0 operational cost)
- ✅ JIRA updated (In Review)
- ✅ Handoff created (this document)

**Blocking Issues:** 2 critical bugs must be fixed before "Done"

---

**Prepared by:** Claude Code
**Session End:** 2025-10-13 22:40 UTC
**Token Usage:** ~59K tokens
**Next Session:** Fix critical issues, then manual testing

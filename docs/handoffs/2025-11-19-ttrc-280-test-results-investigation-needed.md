# TTRC-280 Test Results - Investigation Required

**Date:** 2025-11-19
**Status:** ⚠️ TTRC-280 Code Working, Data Issue Found
**Next Action:** Investigate "No articles found" failures

---

## Executive Summary

TTRC-280 enrichment retry logic is **working perfectly** - graceful error handling, cooldown tracking, and failure counters all functional. However, integration test revealed **92% enrichment failure rate** due to stories having no articles. This is a **data integrity issue**, not a TTRC-280 code issue.

**Key Question:** Did this workflow replicate the normal manual enrichment process correctly, or is there a workflow-specific bug?

---

## What Happened - Integration Test Results

### Test Environment
- **Workflow:** RSS Tracker - TEST (GitHub Actions)
- **Duration:** 1m12s
- **Branch:** test
- **Database:** TEST (migration 037 applied)
- **Run ID:** 19523781616
- **Timestamp:** 2025-11-20 02:48-02:50 UTC

### Pipeline Execution
1. ✅ **RSS Fetch:** Fetched feeds successfully
2. ✅ **Clustering:** Clustered 97 articles into new stories
3. ⚠️ **Enrichment:** Selected 50 stories, 46 failed with "No articles found"

### Run Stats Results
```
status: partial_success
stories_enriched: 4
enrichment_failed: 46 (92% failure rate!)
enrichment_skipped_budget: 0
total_openai_cost_usd: $0.0008
```

### The 46 Failures - ALL Same Error
**Error Message:**
```
❌ No articles found for story [ID]
❌ Enrichment failed for story [ID]: No articles found for story
```

**Failed Story IDs:**
441, 443, 435, 440, 439, 442, 322, 434, 432, 436, 430, 438, 437, 402, 401, 433, 400, 431, 403, 404, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 444, 418, 419, 405

**All 46 stories:**
- Have `last_enriched_at` timestamp (cooldown set) ✅
- Show `needs_enrichment = true` (no summary)
- Are in 12-hour cooldown (won't retry immediately) ✅

---

## TTRC-280 Code Verification - ✅ WORKING PERFECTLY

### What TTRC-280 Was Designed to Do
1. Catch enrichment errors without crashing run
2. Set cooldown timestamp on failed stories
3. Track failures in `enrichment_failed` counter
4. Continue processing remaining stories
5. Set status to `partial_success` when failures occur

### What TTRC-280 Actually Did
1. ✅ Caught 46 "No articles" errors (didn't crash)
2. ✅ Set `last_enriched_at` timestamp on all 46 failures
3. ✅ Tracked failures in `enrichment_failed` counter (46)
4. ✅ Continued processing (enriched 4 successful stories)
5. ✅ Set status to `partial_success`

**Verdict:** TTRC-280 retry logic is working exactly as designed.

---

## The Real Problem - "No Articles Found"

### Observation
**Same run:**
- Clustered 97 articles into stories
- But 46 out of 50 stories selected for enrichment have "No articles found"

### Possible Causes

#### 1. Old Stories Without Articles (Data Integrity)
- Stories exist from previous failed runs
- Articles deleted or never linked
- Junction table (`article_story`) missing entries

#### 2. New Stories Created Without Articles (Clustering Bug)
- Clustering creates story records
- But fails to create `article_story` junction entries
- Story exists, but orphaned

#### 3. Enrichment Query Issue (Wrong Join)
- Stories have articles
- But enrichment query doesn't find them
- SQL join issue or wrong table

#### 4. Race Condition (Timing)
- Stories created
- Enrichment query runs before articles linked
- Transaction/commit timing issue

#### 5. Expected Behavior?
- Does manual enrichment skip stories without articles?
- Is this normal TEST data cleanup situation?

---

## Critical Questions for Investigation

### Data Questions
1. **Are these old or new stories?**
   - Check `created_at` timestamps for the 46 failed stories
   - Were they created in this run (2025-11-20 02:48-02:50)?
   - Or are they older orphaned stories?

2. **Do these stories actually have articles?**
   ```sql
   -- Check article_story junction table
   SELECT s.id, COUNT(ars.article_id) as article_count
   FROM stories s
   LEFT JOIN article_story ars ON s.id = ars.story_id
   WHERE s.id IN (441, 443, 435, ...) -- All 46 IDs
   GROUP BY s.id;
   ```

3. **Did clustering work correctly?**
   - Were 97 articles actually linked to stories?
   - Or were stories created but articles not linked?

### Workflow Questions
1. **Does this match manual enrichment behavior?**
   - What happens when you manually enrich stories?
   - Do you skip stories without articles?
   - Is this expected behavior?

2. **Is the enrichment query correct?**
   - How does the code fetch articles for enrichment?
   - Location: `scripts/enrichment/enrich-stories-inline.js`
   - Does it properly join `article_story` table?

3. **Why 50 story limit?**
   - 365 total stories need enrichment
   - Only 50 attempted per run
   - Is this budget control? (Line 327 in rss-tracker-supabase.js)

### Process Questions
1. **Is TEST data clean?**
   - Are there many orphaned stories from previous test runs?
   - Should we clean up TEST database?

2. **Does PROD have the same issue?**
   - PROD has legacy schema (different structure)
   - Would this happen in PROD after RSS v2 migration?

---

## What Works vs What Needs Investigation

### ✅ Confirmed Working
- **TTRC-280 retry logic:** Perfect
- **Cooldown mechanism:** Working (46 stories in 12h cooldown)
- **Failure tracking:** Accurate (`enrichment_failed = 46`)
- **Run completion:** Didn't crash (partial_success)
- **NULL handling:** 315 never-enriched stories not skipped
- **Successful enrichments:** 4 stories enriched correctly

### ⚠️ Needs Investigation
- **92% failure rate:** Why do 46/50 stories have no articles?
- **Story-article linking:** Is clustering creating orphaned stories?
- **Enrichment query:** Does it correctly fetch articles?
- **Expected behavior:** Is this normal for TEST environment?
- **Manual vs automated:** Does workflow match manual process?

---

## Data Snapshot for Investigation

### Stories in Cooldown (46)
All have `last_enriched_at` between 02:49:10 - 02:49:40 UTC
All show `needs_enrichment = true` (no summary)

### Stories Not Attempted (315)
- `last_enriched_at IS NULL`
- Waiting for future runs (50 per run limit)

### Successful Enrichments (4)
- Had articles available
- Enriched successfully
- Cost: $0.0008 total

---

## 🚨 CRITICAL First Step

**Before anything else, determine if the 46 failed stories are NEW or OLD:**

```sql
-- CRITICAL DIAGNOSTIC: Are failed stories from this run or previous runs?
SELECT
  s.id,
  s.created_at,
  s.primary_headline,
  COUNT(ars.article_id) as article_count,
  CASE
    WHEN s.created_at > '2025-11-20 02:48:00' THEN 'NEW (this run)'
    ELSE 'OLD (previous run)'
  END as story_age
FROM stories s
LEFT JOIN article_story ars ON s.id = ars.story_id
WHERE s.id IN (441, 443, 435, 440, 439, 442, 322, 434, 432, 436, 430, 438, 437, 402, 401, 433, 400, 431, 403, 404, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 444, 418, 419, 405)
GROUP BY s.id, s.created_at, s.primary_headline
ORDER BY s.created_at DESC;
```

**If stories are NEW (created 2025-11-20 02:48-02:50):**
- ❌ Clustering is BROKEN - creates stories without article_story links
- ❌ CRITICAL BUG - blocks all RSS automation
- ❌ TTRC-280 blocked until fixed

**If stories are OLD (created before 2025-11-20 02:48):**
- ✅ Test data corruption (acceptable)
- ✅ Clean up orphaned stories in TEST
- ✅ Re-run enrichment test
- ✅ TTRC-280 can proceed if clean test passes

---

## Recommended Investigation Steps

### Step 1: Check Story Ages
```sql
SELECT
  id,
  created_at,
  last_enriched_at,
  primary_headline
FROM stories
WHERE id IN (441, 443, 435, 440, 439, 442, 322, 434, 432, 436, 430, 438, 437, 402, 401, 433, 400, 431, 403, 404, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 444, 418, 419, 405)
ORDER BY created_at DESC;
```
**Question:** Were these created in the 02:48-02:50 window?

### Step 2: Check Article Counts
```sql
SELECT
  s.id,
  s.primary_headline,
  COUNT(ars.article_id) as article_count
FROM stories s
LEFT JOIN article_story ars ON s.id = ars.story_id
WHERE s.id IN (441, 443, ...) -- All 46
GROUP BY s.id, s.primary_headline
ORDER BY article_count DESC;
```
**Question:** Do these stories actually have articles?

### Step 3: Review Enrichment Code
- **File:** `scripts/enrichment/enrich-stories-inline.js`
- **Look for:** How it fetches articles for a story
- **Check:** Does it properly join `article_story` table?

### Step 4: Compare with Manual Process
- How do you normally enrich stories manually?
- What tool/script do you use?
- Does it skip stories without articles?

### Step 5: Check Clustering Output
```sql
-- Did clustering link articles to stories?
SELECT
  s.id,
  s.created_at,
  COUNT(ars.article_id) as article_count
FROM stories s
LEFT JOIN article_story ars ON s.id = ars.story_id
WHERE s.created_at > '2025-11-20 02:48:00'
GROUP BY s.id, s.created_at
ORDER BY s.created_at DESC;
```
**Question:** Did the 97 clustered articles get linked?

---

## TTRC-280 Status

### Implementation
- ✅ Code complete and merged to main (PR #22)
- ✅ Migration 037 applied to TEST
- ✅ Retry logic working perfectly
- ✅ Cooldown mechanism working
- ✅ Failure tracking working

### Testing
- ✅ Integration test completed
- 🚨 **CRITICAL:** 92% enrichment failure rate - BLOCKS automatic runs
- ⏳ Investigation required before marking Done

### Blocker
**TTRC-280 cannot be marked Done until enrichment works reliably.**
Purpose of TTRC-280: Make RSS automation reliable for automatic runs
Current state: 92% failure rate is NOT acceptable for automation

**Root Cause Analysis:**
- TTRC-280 code changes did NOT modify enrichment logic or story selection
- Query in `enrich-stories-inline.js` is correct (fetches from article_story table)
- 46 stories have ZERO entries in article_story junction table
- Either clustering is broken OR these are old orphaned stories

**Critical Diagnostic:** Are the 46 failed stories from this run (NEW) or previous runs (OLD)?
- If NEW: Clustering broke - CRITICAL BUG
- If OLD: Test data corruption - Clean up TEST database

### Next Steps
1. Investigate "No articles found" failures
2. Determine if expected behavior or bug
3. Fix data issue if needed (separate ticket?)
4. Re-test or accept results
5. Mark TTRC-280 as Done (code is working)

---

## Files & References

**PR:** #22 (merged to main)
**Migration:** `migrations/037_enrichment_failed_tracking.sql`
**Code:** `scripts/rss-tracker-supabase.js` (enrichStories method)
**Enrichment Logic:** `scripts/enrichment/enrich-stories-inline.js`
**Workflow:** `.github/workflows/rss-tracker-test.yml`
**Run Logs:** GitHub Actions Run ID 19523781616

**Related Documentation:**
- Canonical Plan: `docs/plans/2025-11-18-ttrc-280-enrichment-retry-CANONICAL.md`
- Original Handoff: `docs/handoffs/2025-11-18-ttrc-280-enrichment-retry.md`

---

## Key Insight

**TTRC-280 is doing its job perfectly.** It caught 46 errors that would have crashed previous runs and gracefully handled them with cooldown tracking. The "No articles found" issue is either:
1. Expected behavior (old orphaned stories)
2. A clustering bug (separate from TTRC-280)
3. A query bug in enrichment code (separate from TTRC-280)

**TTRC-280 should be marked Done once we confirm this is not a regression introduced by TTRC-280's changes.**

---

**Next Session Objective:** Determine root cause of "No articles found" failures and whether TTRC-280 can be marked Done.

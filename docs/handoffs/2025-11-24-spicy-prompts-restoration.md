# Handoff: Spicy Prompts Restoration

**Date:** 2025-11-24
**Status:** Prompts updated, testing revealed frontend issue
**Commit:** `e3b91d6` - `feat(enrichment): restore Full Anger Mode to prompts`
**AI Code Review:** ✅ Passed

---

## What Was Done

### 1. Updated Enrichment Prompts (`scripts/enrichment/prompts.js`)

**SYSTEM_PROMPT (Story Summaries):**
- Added context line: "It's 2025. Trump is president."
- Changed `summary_spicy` from 100-140 words → **200-300 words**
- Added ANGRY tone instructions:
  - "Call out the bullshit directly"
  - "Who benefits? Who gets fucked?"
  - Personal language: "YOUR taxes, YOUR rights"
  - Profanity allowed
- Added **BANNED OPENINGS** list (no more "This is outrageous...")
- Added **EXAMPLE OPENINGS** for variety
- Added **ACTION element**: End with what readers can do

**EO_ENRICHMENT_PROMPT (Executive Orders):**
- Added context line
- Changed word counts from 100-160 → **150-250 words per section**
- Updated sections 2-4 with angry tone:
  - Section 2: "The Real Agenda" (expose the bullshit)
  - Section 3: "Reality Check" (call out lies)
  - Section 4: "Why This Is Fucking Dangerous"
- Kept JSON field names unchanged for database compatibility

### 2. Fixed Duplicate Prompt Issue (`scripts/enrichment/enrich-stories-inline.js`)

- **Deleted** hardcoded SYSTEM_PROMPT (was out of sync)
- **Added** import from `./prompts.js` (single source of truth)
- Now both `job-queue-worker.js` and `enrich-stories-inline.js` use the same prompt

### 3. Test Results

Tested on 3 older stories (IDs 1858-1860). Results:
- ✅ Personal language ("YOUR taxes", "you're footing the bill")
- ✅ No banned openings used
- ✅ Angry tone ("circus", "power grab", "shitshow")
- ⚠️ Word count was 124-156 (below 200-300 target)
- ⚠️ Only 1 of 3 used profanity

---

## Issue Discovered: Empty Articles on Frontend

**Problem:** Test site shows "almost empty articles" because:
- Latest stories (IDs 1905-1914) have **NO summaries** - not enriched yet
- Frontend sorts by `last_updated_at` descending
- Users see newest (un-enriched) stories first

**Root Cause:** Stories are created from RSS feeds but enrichment runs separately/later. No filter prevents un-enriched stories from displaying.

**Recommended Fix:** Filter stories in the frontend/API to only show stories that have been enriched:

```sql
-- Add to stories-active edge function query:
.not('summary_neutral', 'is', null)
```

Or add a `is_enriched` boolean flag and filter on that.

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/enrichment/prompts.js` | SYSTEM_PROMPT + EO_ENRICHMENT_PROMPT updated |
| `scripts/enrichment/enrich-stories-inline.js` | Now imports from prompts.js |
| `scripts/test-spicy-prompts.js` | Test script (can delete) |

---

## Next Steps

### Priority 1: Fix Frontend to Hide Un-Enriched Stories
- Update `supabase/functions/stories-active` to filter out stories without summaries
- This prevents "empty article" experience

### Priority 2: Verify Word Count
- Current output is ~150 words, target is 200-300
- May need to make prompt stricter: "MUST be 200-300 words minimum"
- Or accept shorter summaries if tone is good

### Priority 3: Run Enrichment on New Stories
- Stories 1905-1914 need enrichment
- Either trigger RSS pipeline (includes enrichment) or run standalone enrichment

### Optional: Delete Test Script
```bash
rm scripts/test-spicy-prompts.js
```

---

## Reference: The Approved Tone

From `docs/spicy-prompts-update-guide.md` and `scripts/spicy-eo-translator.js`:

> "Be ANGRY and TRUTHFUL. This isn't news reporting - it's warning people about fascism."
>
> "Expose the REAL agenda... WHO gets screwed... Call out the fascist bullshit."

**Brand Voice:** "Angry but accurate, funny but factual"

---

## Test Command

To test the new prompts on a few stories:
```bash
node scripts/test-spicy-prompts.js 3
```

---

*Handoff prepared for next session*

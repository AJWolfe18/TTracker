# Handoff: TTRC-119 Prompt Improvements + Frontend Filter

**Date:** 2025-11-25
**Status:** Complete
**Commits:** `761d9ee`, `2d05087`, `44f1209`
**AI Code Review:** Passed

---

## What Was Done

### 1. Prompt Updates (`scripts/enrichment/prompts.js`)

**Added to SYSTEM_PROMPT:**
- **Banned openings:** "Guess what?", "So, ", "Well, ", "Look, " (in addition to existing "It's outrageous", etc.)
- **Progressive perspective:**
  ```
  PERSPECTIVE:
  - You're writing for a progressive audience who opposes Trump and the Republican agenda.
  - Don't "both sides" corruption - when Republicans are doing the damage, say so.
  - This is accountability journalism from a liberal viewpoint, not neutral reporting.
  ```

### 2. Frontend Filter (`public/story-api.js`)

Added filter to hide un-enriched stories:
```javascript
summary_neutral: 'not.is.null'
```

**Note:** Also updated `stories-active` edge function, but frontend doesn't use it - queries DB directly.

### 3. Documentation Fix (`CLAUDE.md`)

Added correct Supabase project refs:
- **TEST:** `--project-ref wnrjrywpcadwutfykflu`
- **PROD:** `--project-ref osjbulmltfpcoldydexg`

Previous deploys were failing due to wrong/missing project ref.

### 4. Created Monitoring Ticket

**TTRC-292:** Add Enrichment Status Monitoring to Health Dashboard
- Track un-enriched stories/EOs
- Surface failures instead of hiding them
- Added to Epic TTRC-249

---

## Test Results

Tested on 3 stories:
- No banned openings used
- Progressive framing present ("GOP is busy feeding you lies")
- Frontend now hides un-enriched stories

---

## Still Pending

### EO Prompt Updates (Not Done)
The `EO_ENRICHMENT_PROMPT` was NOT updated with progressive perspective. The EO summaries shown on the site are still bland/neutral.

**Recommendation:** Update `EO_ENRICHMENT_PROMPT` with:
- Same progressive perspective
- Same banned openings list
- Then re-enrich recent EOs

### Run RSS Pipeline
New prompt hasn't been tested on fresh stories yet. Need to trigger:
```bash
gh workflow run "RSS Tracker - TEST" --ref test
```

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/enrichment/prompts.js` | Banned openings + progressive perspective |
| `public/story-api.js` | Filter un-enriched stories |
| `supabase/functions/stories-active/index.ts` | Filter (redundant but good practice) |
| `CLAUDE.md` | Correct Supabase project refs |

---

## Key Learnings

1. **Frontend bypasses edge functions** - `story-api.js` queries DB directly via PostgREST
2. **Supabase project refs matter** - Wrong ref = 403 error, no clear message
3. **Two enrichment prompts exist:**
   - `SYSTEM_PROMPT` - Story enrichment (updated)
   - `EO_ENRICHMENT_PROMPT` - Executive Order enrichment (NOT updated)

---

## Tomorrow's Prompt

```
Continue TTRC-119 wrap-up:

1. Update EO_ENRICHMENT_PROMPT with progressive perspective (same as story prompt)
2. Trigger RSS pipeline to test new story prompt on fresh content
3. Review new summaries for quality
4. Optional: Re-enrich recent EOs with updated prompt

Reference: docs/handoffs/2025-11-25-ttrc-119-prompt-improvements.md
```

---

*Handoff prepared for next session*

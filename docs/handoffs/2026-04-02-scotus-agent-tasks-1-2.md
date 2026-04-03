# Handoff: SCOTUS Claude Agent — Tasks 1-2

**Date:** 2026-04-02
**Branch:** test
**Commits:** 0a38469, 55a5225

## What Was Done

### Task 1: Migration 090 — scotus_enrichment_log
- Created `migrations/090_scotus_enrichment_log.sql` (observability table for agent runs)
- Also committed untracked `migrations/087_scotus_compound_dispositions.sql` (compound disposition CHECK constraint)
- Both applied to TEST via Supabase Dashboard SQL Editor (Josh pasted manually)
- Verified: table exists, empty, queryable. Compound dispositions filter works.

### Task 2: Prompt v1
- Created `docs/features/scotus-claude-agent/prompt-v1.md` (658 lines, 14 sections)
- 5 gold set calibration examples authored from verified truth (NOT from DB — 3/5 DB cases had wrong hard fields)
- Deterministic source selection policy: syllabus first, 30K cap, truncate from end
- Uses Bash/curl for PostgREST (WebFetch can't set custom headers)
- All 16 plan checklist items verified YES
- Structural validation: all PostgREST URL patterns tested against live API, all 33 columns confirmed
- Desk check: Barrett (compound 9-0) and Horn (compound 5-4) both PASS on all hard fields

## Key Findings

1. **WebFetch is unusable for API calls** — it takes URL + prompt for web scraping, no custom headers/methods/body. All cloud agent PostgREST calls must use Bash/curl.
2. **Supabase MCP not connected to TTracker** — only WhiskeyPal. DDL migrations need manual SQL paste. Consider connecting TTracker for future work.
3. **DB enrichment data is unreliable** — 3/5 gold cases had wrong dispositions or vote splits. Never use DB values as source of truth for prompt examples.

## What's Next

### Task 3: Create Cloud Trigger (BLOCKED on Josh prereqs)

Josh must do before next session:
1. **Configure Cloud Environment** at claude.ai/code with:
   - `SUPABASE_URL` = `https://wnrjrywpcadwutfykflu.supabase.co` (TEST)
   - `SUPABASE_SERVICE_ROLE_KEY` = (TEST service role key)
   - Network access: **Full** (required for *.supabase.co)
2. **Clean up 5 disabled test triggers** at claude.ai/code/scheduled
3. **Note the `environment_id`** — needed for trigger creation

### After Task 3
- Task 4: Iterate on prompt if gold set validation fails
- Task 5: Extended validation (10-15 cases)
- Task 6: Enable daily schedule
- Task 7: ADO housekeeping (create epic + stories)

## Files Changed
- `migrations/087_scotus_compound_dispositions.sql` (committed, was untracked)
- `migrations/090_scotus_enrichment_log.sql` (new)
- `docs/features/scotus-claude-agent/prompt-v1.md` (new)

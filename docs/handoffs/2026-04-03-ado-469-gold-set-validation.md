# Handoff: SCOTUS Claude Agent — Task 3 Gold Set Validation

**Date:** 2026-04-03
**Branch:** test
**Commit:** 9d7afe7
**ADO:** 469 (Testing)

## What Was Done

### Task 3: Create Cloud Trigger + Gold Set Validation

1. **Discovered environment_id** via Josh creating a test trigger in UI, then reading it via `RemoteTrigger list`
   - Environment: `env_01YRYGLu8C8ijpVWdPAwgVSQ` ("TTracker TEST")
   - Trigger: `trig_01S2xQVXfaB8rGJpbaPCWPvV`

2. **Reset 5 gold set cases** (286, 120, 137, 174, 68) to `enrichment_status='pending'`
   - Pre-run snapshot saved: `validation-results/2026-04-03-pre-run-snapshot.json`

3. **Created and configured trigger** (multiple iterations):
   - API doesn't accept `repositories`, `max_turns`, or `ref` at any level
   - Prompt goes in `job_config.ccr.events[].data.message.content`
   - Model goes in `job_config.ccr.session_context.model`
   - Repo goes in `job_config.ccr.session_context.sources[].git_repository.url`
   - **Bootstrap approach:** Short prompt tells agent to `git fetch origin test && git checkout -B test origin/test`, then read `prompt-v1.md` from the repo

4. **Ran trigger 4 times** to get it working:
   - Run #1: No repo configured → agent couldn't find prompt file
   - Run #2: Josh added repo in UI but agent still couldn't find file (git checkout test didn't track remote properly)
   - Run #3: Fixed with `git fetch origin test && git checkout -B test origin/test` → WORKED. Enriched 2 gold cases (Bufkin, TikTok partial). TikTok had JSON escaping error.
   - Run #4: Reset TikTok, re-ran → enriched all 4 remaining gold cases + TikTok properly. 6/6 cases enriched, 0 failed.

5. **Scored against gold truth:** 100% PASS on all hard fields for all 5 cases.

6. **Documented results:** `validation-results/2026-04-03-gold-set-v1.json`

## Key Findings

### RemoteTrigger API Structure
```json
{
  "job_config": {
    "ccr": {
      "environment_id": "env_...",
      "events": [{"data": {"message": {"content": "PROMPT HERE", "role": "user"}, "type": "user", "uuid": "..."}}],
      "session_context": {
        "allowed_tools": ["Bash", "Read", ...],
        "model": "claude-sonnet-4-20250514",
        "cwd": "/home/user/TTracker",
        "sources": [{"git_repository": {"url": "https://github.com/AJWolfe18/TTracker"}}]
      }
    }
  }
}
```
- `repositories`, `max_turns`, `ref` are NOT valid fields
- Repo defaults to main branch — must use explicit `git fetch origin test && git checkout -B test origin/test` in bootstrap prompt
- Prompt is limited to events message content (can't pass 35K inline practically — bootstrap approach reads from repo)

### Issues Found (Non-Blocking)
1. **JSON escaping in curl:** Apostrophes in opinion text break single-quoted curl JSON bodies. Agent retried but only partially updated fields. Needs prompt fix (use heredoc or double-quote escaping).
2. **Query inconsistency:** Run #3 found 3/6 pending cases, run #4 found all 6. Possibly PostgREST response size limits with large text columns in select.

## What's Next

### Task 4: Fix JSON Escaping (Optional — Prompt Iteration)
- Update prompt to use heredoc syntax for curl bodies, or escape apostrophes
- This would prevent the partial-update issue seen with TikTok in run #3
- Low priority since run #4 handled it cleanly

### Task 5: Extended Validation (ADO-470)
- Run against 10-15 cases (mix of gold + non-gold + edge cases)
- Verify quality on cases NOT in the gold set examples
- Check cost/duration at scale

### Task 6: Enable Daily Schedule
- Set `cron_expression: "0 20 * * 1-5"` (4 PM UTC, Mon-Fri, 1hr after SCOTUS releases)
- For PROD: create new environment with PROD Supabase credentials

## Files Changed
- `docs/features/scotus-claude-agent/validation-results/2026-04-03-gold-set-v1.json` (new)
- `docs/features/scotus-claude-agent/validation-results/2026-04-03-pre-run-snapshot.json` (new)

# GPT-5 Code Review Workflow

## Overview

Automated AI code reviews using OpenAI's GPT-5 via the Responses API. Reviews ONLY the latest commit on PRs, providing BLOCKERS and NON-BLOCKING feedback.

**Status:** ✅ Working (as of 2025-10-07)
**Workflow File:** `.github/workflows/ai-code-review.yml`
**Trigger:** PR opened/synchronized, or manual via workflow_dispatch

---

## Working Configuration

### Minimal Payload (REQUIRED)

GPT-5 Responses API requires minimal payload - most parameters cause 400 errors.

```json
{
  "model": "gpt-5",
  "max_output_tokens": 8000,
  "input": [
    {"role": "system", "content": [{"type": "input_text", "text": "..."}]},
    {"role": "user", "content": [{"type": "input_text", "text": "..."}]}
  ]
}
```

**Key commits:**
- `293369c` - Working minimal payload
- `8cd58b5` - Enhanced system prompt with repo context

### Response Parser

GPT-5 returns text in `.output_text` when successful:

```bash
TEXT=$(jq -r '
  ( .output_text // "" ) as $ot
  | if ($ot|type=="string" and ($ot|length)>0) then $ot
    else ([ .output[]?.content[]? | select(.type=="output_text") | .text ] | join("\n\n"))
    end
' < "$RESP_FILE")
```

---

## What DOESN'T Work ❌

### Parameters That Cause 400 Errors

1. **`modalities: ["text"]`**
   - Error: `Unknown parameter: 'modalities'`
   - Commit that failed: `3734562`

2. **`text: { format: "markdown" }`**
   - Error: `Invalid type for 'text.format': expected a text format, but got a string instead`
   - Commit that failed: `5e4af86`

3. **`response_format: { type: "text" }`**
   - Error: `Unsupported parameter: 'response_format'. In the Responses API, this parameter has moved to 'text.format'`
   - But `text.format` also fails (see above)
   - Commit that failed: `c8a8108`

4. **`reasoning: { effort: "none" }`**
   - Error: `Invalid value: 'none'. Supported values are: 'low', 'medium', and 'high'`
   - Don't use reasoning at all in minimal payload
   - Commit that failed: `ea8311f`

5. **`temperature: 0`**
   - GPT-5 doesn't support temperature parameter
   - Rejected in initial testing

### Response Issues

**Empty responses when incomplete:**
```json
{
  "status": "incomplete",
  "incomplete_details": {"reason": "max_output_tokens"},
  "output": [{"type": "reasoning", "summary": []}]
}
```
- Fix: Increased `max_output_tokens` from 1500 → 8000
- Commit: `3bc0451`

**Reasoning-only output (no text):**
```json
{
  "status": "completed",
  "output": [{"type": "reasoning", "summary": []}]
}
```
- Fix: Removed reasoning parameter entirely, use minimal payload
- Commit: `1b35cba`

---

## System Prompt (Enhanced)

**Location:** Built in workflow step "Build prompt header"

**Contains:**
- Role: Senior Staff Engineer
- Scope: Latest commit only
- Focus: Security > Performance > Style > Tests
- Repo context:
  - Project: TrumpyTracker (RSS + Story clustering)
  - Stack: Node.js ESM, Supabase, vanilla JS
  - Budget: <$50/mo
  - Style rules: cursor pagination, UTC timestamps, pure functions
  - Security: no secrets, parameterized SQL, RLS respected
- Output format: JSON (requested via prompt, not enforced by API)

**Format requested:**
```json
{
  "BLOCKERS": [
    {"file": "path/file.js", "lines": "128-140", "type": "security|bug|perf", "why": "...", "patch": "..."}
  ],
  "NON_BLOCKING": [
    {"file": "path/file.js", "lines": "50-52", "type": "style|test", "why": "...", "patch": "..."}
  ]
}
```

---

## Troubleshooting

### Workflow fails at "Probe Responses API"

**Symptoms:** HTTP 400 error during probe step

**Diagnosis:**
```bash
gh run view <run-id> --log | grep -A 20 "error"
```

**Common causes:**
- Added unsupported parameter (see "What DOESN'T Work" above)
- API key expired/invalid
- Model name incorrect (should be exactly `gpt-5`)

**Fix:** Revert to minimal payload, check probe matches review payload structure

### Empty PR comments / No review posted

**Symptoms:** Workflow succeeds but no comment appears

**Diagnosis:**
```bash
gh pr view <pr-number> --comments
```

**Common causes:**
- Parser can't extract `.output_text` from response
- Response status is "incomplete" (need more tokens)
- All chunks failed retry logic

**Fix:** Check workflow logs for "Empty model output" messages, increase `max_output_tokens`

### Reviews are generic / missing context

**Symptoms:** GPT-5 gives generic advice, doesn't understand TrumpyTracker patterns

**Fix:** Verify system prompt includes repo context (commit `8cd58b5`)

---

## Future Enhancements (TTRC-199)

**Goal:** Structured JSON output for CI automation

**Parameters to test:**
1. `response_format` with `json_schema` - enforce JSON structure
2. `reasoning.effort: "low"` - balance cost vs quality
3. `verbosity` parameter - control output length
4. `seed` parameter - deterministic reviews

**Risk:** Any new parameter may cause 400 errors. Test incrementally.

---

## Manual Testing

**Trigger workflow on PR #N:**
```bash
gh workflow run "AI Code Review (Latest Commit Only)" --ref main -f pr_number=N
```

**Check status:**
```bash
gh run list --workflow="AI Code Review (Latest Commit Only)" --limit 1
```

**View logs:**
```bash
gh run view <run-id> --log
```

**Check PR comments:**
```bash
gh pr view <pr-number> --comments
```

---

## Cost Monitoring

**Current usage:** ~$0.10 per review (GPT-5 pricing)

**Budget cap:** $50/month enforced in workflow

**Tracking:** Check `budgets` table in Supabase for daily spend

---

## Related Issues

- **TTRC-198:** Initial GPT-5 workflow fix (Done)
- **TTRC-199:** Advanced parameters testing (Backlog)

## Key Commits

- `293369c` - Working minimal payload ✅
- `8cd58b5` - Enhanced system prompt with repo context
- `3bc0451` - Increased max_output_tokens to 8000
- `c8a8108` - Failed: response_format attempt
- `5e4af86` - Failed: modalities removal
- `3734562` - Failed: text.format attempt
- `1b35cba` - Disabled reasoning (caused empty output)
- `ea8311f` - Failed: reasoning.effort: "none"

---

**Last Updated:** 2025-10-07
**Maintainer:** Josh + Claude Code

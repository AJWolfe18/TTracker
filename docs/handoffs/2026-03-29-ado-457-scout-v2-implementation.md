# Handoff: ADO-457 - Scout v2 (Triage + Targeted Retry)

**Date:** 2026-03-29
**Ticket:** ADO-457
**Status:** Code complete, awaiting dry-run verification
**Branch:** `test`
**Commit:** 77a23d2

---

## What Was Implemented

Scout v2 adds two capabilities to the SCOTUS Scout enrichment system, addressing the 76-86% accuracy ceiling from v1.

### 1. Triage (merits vs non-merits classification)

Non-merits cases (cert denials, stay orders, shadow docket) were polluting v1 results. Scout tried to extract vote splits and dispositions that don't exist, producing false failures.

**How it works:**
- **Deterministic merits signals** (no API call): syllabus > 200 chars OR fact_review_status = 'ok'
- **Perplexity triage** (for everything else): simple "merits or non-merits?" question (~$0.005/call)
- **Safe direction**: defaults to merits on ambiguous/null/error responses -- never suppresses without confidence
- **Stored**: `is_merits_decision` BOOLEAN column (NULL = unclassified, persists across runs)
- **Reporting**: every Perplexity-triaged non-merits flagged `[SPOT-CHECK]` in console and JSON output

### 2. Targeted Retry (fix fixable validation failures)

v1 left cases as `uncertain` when a single field was wrong. v2 sends one targeted follow-up question.

**How it works:**
- Validator now returns structured error codes (`{code, field, message}`) instead of plain strings
- 10 retryable codes with field-specific Perplexity prompts (e.g., "What was the vote split?")
- Response parsed through existing `parseScoutResponse()` + `validateScoutResult()` -- no second parser
- Clone-before-merge: original parsed object is never mutated
- Non-merits safety valve: if retry response contains "certiorari denied" etc., reclassifies instead of patching
- Max 1 retry per case

### 3. Migration 089

```sql
ALTER TABLE scotus_cases ADD COLUMN IF NOT EXISTS is_merits_decision BOOLEAN DEFAULT NULL;
```

Plus partial index on unclassified cases. **NOT YET APPLIED** -- must run via Supabase Dashboard.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `scripts/scotus/scout-validator.js` | +79/-61 | Structured error codes, BLOCKING_CODES set |
| `scripts/enrichment/scotus-scout.js` | +415/-6 | Triage, retry, reporting, budget tracking |
| `tests/scotus-scout-unit.test.js` | +5/-5 | Updated assertions for issue objects |
| `migrations/089_scotus_merits_classification.sql` | +18 NEW | is_merits_decision column |
| `supabase/migrations/20260330000000_...sql` | +18 NEW | Supabase copy |

---

## Code Reviews

Two reviews completed, all findings fixed:

**feature-dev:code-reviewer** (code bugs):
- Fixed: double-counted enrichment cost (calculateCost called twice)
- Fixed: attemptRetry mutated caller's parsed object (now clones)
- Fixed: budget call count excluded triage/retry API calls

**superpowers:code-reviewer** (spec alignment):
- Fixed: parseTriageResponse returned null on empty input (should default to merits)
- Fixed: budget counter inflated by cached non-merits (split into _cached vs _api)
- Documented: retry only fires on 'uncertain', not 'failed' (intentional -- parser failures are structural)

---

## What's NOT Changed

- scout-parser.js, scout-prompt.js, syllabus-extractor.js, oyez-client.js
- Safety guardrails (--confirm, --output-json requirements)
- Rollback capture mechanism
- Budget enforcement ($1.50/run cap, $5/day daily limit)
- All v1 acceptance criteria still met

---

## Next Session: Verification

### Prerequisites
1. **Apply migration 089** via Supabase Dashboard SQL editor on TrumpyTracker-Test

### Dry-run sequence
```bash
# 1. Known problem cases (triage accuracy)
node scripts/enrichment/scotus-scout.js --dry-run --ids=40,55,56,57,63,73,4 --output-json=v2-trial.json

# Expected:
#   IDs 40, 55, 56, 57, 73 -> triaged as non-merits
#   ID 63 (Trump) -> merits, pass or fixed by retry
#   ID 4 (Connelly) -> merits, author=Thomas after retry

# 2. Gold set comparison
node scripts/enrichment/scotus-scout.js --dry-run --gold-set --output-json=v2-gold.json
# Check BOTH denominators (v1 total vs v2 merits-only)

# 3. 25-case batch
node scripts/enrichment/scotus-scout.js --dry-run --limit=25 --output-json=v2-batch.json
# Check: triage decisions, retry stats, ok rate
```

### What to look for
- **Triage accuracy**: every `[SPOT-CHECK]` case in the report should actually be non-merits
- **Zero false non-merits**: no merits case should be suppressed
- **Retry effectiveness**: how many uncertain cases get fixed
- **Cost**: should be ~$0.01-0.02/case average (vs $0.01 flat in v1)

---

## Key Design Decisions (and WHY)

1. **No deterministic non-merits gates** -- heuristics like docket prefix patterns are suggestive but unproven. All non-merits classification goes through Perplexity to avoid false suppression.

2. **Retry only on 'uncertain', not 'failed'** -- failed status comes from parser/API errors (malformed JSON, timeouts). A targeted field question won't fix structural failures.

3. **Budget tracks cached vs API triage separately** -- `triage_non_merits_cached` (no API call) vs `triage_non_merits_api` (Perplexity call). Only API calls count toward budget `p_calls`.

4. **Error codes are stable contracts** -- once defined, codes cannot be renamed or removed without updating the retry map. Comment block in scout-validator.js documents this.

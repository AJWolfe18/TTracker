# Scout v2: Triage + Targeted Retry

## Context

Scout v1 achieves 76-86% accuracy enriching SCOTUS cases via single-pass Perplexity queries. The remaining failures fall into two categories:

1. **Non-merits cases** (cert denials, stay orders, shadow docket) — these lack vote splits, authors, and formal dispositions because SCOTUS never ruled on the substance. They shouldn't go through the merits enrichment pipeline.
2. **Merits cases with fixable errors** — missing fields, invalid enums, contradictions. Manual trial showed that a single targeted follow-up question to Perplexity fixes these (Connelly author, Trump v US sources).

## Design

### Change 1: Triage (classify merits vs non-merits)

**Problem:** Non-merits cases (cert denials, stay orders) pollute the enrichment pipeline. Scout tries to extract vote splits and dispositions that don't exist, producing failures that aren't real failures.

**Triage is a correctness-critical gate.** A false "non-merits" classification suppresses the case entirely. This is worse than a normal enrichment miss. The design must minimize false non-merits classifications.

#### Step 1: Deterministic merits classification (no API call, safe direction only)

Some signals can confirm a case IS merits without risk of false suppression:

```javascript
const DETERMINISTIC_MERITS = [
  // Has substantial syllabus text = definitely argued and decided
  (c) => c.syllabus && c.syllabus.length > 200,
  // Already enriched successfully in a prior run
  (c) => c.fact_review_status === 'ok',
];
```

If any merits signal matches → skip triage, proceed to enrichment. No API call needed.

**There are no deterministic non-merits gates.** Heuristics like docket prefix patterns (`^\d+A\d+`) and missing syllabus/opinion text are suggestive but not proven against our dataset. Promoting them to hard suppression gates risks false non-merits classifications. All non-merits classification goes through Perplexity triage (Step 2).

The heuristics can be used as **soft signals** passed to the Perplexity triage prompt for context (e.g., "this case has docket prefix 'A' suggesting it may be an application"), but they do not independently suppress cases.

#### Step 2: Perplexity triage (all non-deterministic-merits cases)

```
Is [case_name] ([docket_number]) a Supreme Court merits decision
(full briefing, oral argument, written opinion)? Or is it a
non-merits action (certiorari denied, stay order, GVR, shadow
docket)? Answer ONLY: "merits" or "non-merits".
```

Cost: ~$0.005 per triage call. Only invoked for cases that can't be classified deterministically.

#### Classification storage

**Separate field from processing status.** `fact_review_status` (ok/needs_review/failed) tracks processing outcomes. Case classification is a different dimension.

New column: `is_merits_decision BOOLEAN DEFAULT NULL`
- `NULL` = not yet classified
- `true` = merits decision, eligible for enrichment
- `false` = non-merits, skip enrichment

`fact_review_status` is untouched for non-merits cases (stays NULL). No semantic overloading.

#### On non-merits classification:
- Set `is_merits_decision = false`
- Skip enrichment
- Log in report with classification reason (deterministic signal or Perplexity response)
- **Non-merits cases are not deleted or hidden** — they remain in the database for potential future handling (shadow docket tracking is a separate future feature)

#### Safety: triage verification
- Report includes a "triage decisions" section listing every case classified as non-merits and the reason
- Any case triaged as non-merits via Perplexity (not deterministic) is flagged for human spot-check
- Triage accuracy is measured explicitly in verification (see Verification Plan)

### Change 2: Targeted Retry (fix validation failures)

**Where:** After the validator runs in `scotus-scout.js`, before marking a case as uncertain/failed.

#### Structured error codes (not string matching)

The validator currently returns human-readable issue strings. Keying retry logic on those strings is brittle — if wording changes, retries break silently.

**Fix:** Add structured error codes to the validator alongside messages:

```javascript
// In scout-validator.js, issues become objects:
{ code: 'MISSING_VOTE_SPLIT', field: 'vote_split', message: 'Missing required field: vote_split' }
{ code: 'INVALID_DISPOSITION_ENUM', field: 'disposition', value: 'stayed', message: 'Invalid formal_disposition enum: "stayed"' }
{ code: 'UNANIMOUS_WITH_DISSENTERS', message: 'Unanimous vote (9-0) but dissent_authors is non-empty' }
```

Retry logic keys on `code`, not `message`. Existing code that reads `.message` is unaffected (backwards compatible).

**Codes are stable contracts.** Once defined, codes should not be renamed or removed without updating the retry map. Add a comment block in `scout-validator.js` listing all codes as the authoritative reference. New codes can be added freely; existing codes are frozen.

#### Retry prompt map (keyed on codes)

```javascript
const RETRY_PROMPTS = {
  MISSING_VOTE_SPLIT: { ... },
  MISSING_DISPOSITION: { ... },
  MISSING_MAJORITY_AUTHOR: { ... },
  INVALID_DISPOSITION_ENUM: { ... },
  UNANIMOUS_WITH_DISSENTERS: { ... },
  MISSING_SUBSTANTIVE_WINNER: { ... },
};
```

Each entry defines the follow-up question template with `{case_name}`, `{docket}`, and field-specific placeholders.

#### Retry response parsing (single extraction path)

**Problem:** A separate mini-parser for retry responses creates a second extraction standard alongside the main Scout parser. That's a maintenance smell.

**Fix:** Retry prompts ask Perplexity to return JSON in the same schema Scout uses:

```
For {case_name} ({docket}), what was the vote split?
Answer as JSON: {"vote_split": "N-N"}
```

The response goes through the **existing** `parseScoutResponse()` function (with the retry fields merged into the original result), then through the **existing** `validateScoutResult()`. One parser, one validator, no second extraction path.

#### Retry scope: field-local vs case-posture issues

Some validation failures aren't isolated missing values — they stem from upstream misunderstanding of case posture (e.g., "stayed" as disposition because the case is a stay order, not a merits decision). A field-local patch would make the record look cleaner without being truer.

**Guard:** If retry detects a case-posture issue (e.g., Perplexity's retry response says "this was not a merits decision" or "certiorari was denied"), the retry should reclassify the case as non-merits rather than patching the field. Specifically:

- If retry response contains signals like "certiorari denied", "stay order", "not a merits decision" → set `is_merits_decision = false`, skip remaining enrichment
- This is a safety valve, not a primary triage path

**Reporting: distinct outcome buckets.** "Pre-enrichment triage non-merits" and "retry-discovered non-merits" are tracked as separate categories everywhere — in the JSON output, the console report, and the summary stats. This prevents analysis from blurring whether the triage classifier or the enrichment pass found the posture issue. Specifically:

```javascript
stats.triage_non_merits    // classified before enrichment (Step 1/2)
stats.retry_non_merits     // discovered during retry (safety valve)
stats.retry_field_fixed    // retry resolved a field-level issue
stats.retry_still_failed   // retry attempted but case still needs_review
```

#### Flow:
1. Scout first pass runs as normal
2. Validator returns issues array (with structured codes)
3. If status is uncertain or failed AND issues have matching retry codes:
   - Construct targeted question from template + case data
   - Call Perplexity (~$0.005-0.01)
   - Merge retry JSON response into original Scout result
   - Re-run through existing parser + validator (same path, no second parser)
   - If retry reveals non-merits posture → reclassify, don't patch
4. If still fails after 1 retry: mark as `needs_review`
5. Max 1 retry per case

**What retry does NOT do:**
- Does not re-run the entire Scout prompt
- Does not retry on parse errors (structural, not data issues)
- Does not retry more than once
- Does not change the cost for cases that pass first time

### Change 3: Migration

```sql
-- New column for case classification (separate from processing status)
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS is_merits_decision BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN scotus_cases.is_merits_decision IS
'Case classification: true=merits (eligible for enrichment), false=non-merits (cert denied, stay, GVR). NULL=not yet classified.';
```

No changes to `fact_review_status` CHECK constraint. Classification and processing status stay separate.

### Files Modified

| File | Change |
|------|--------|
| `scripts/enrichment/scotus-scout.js` | Add triage step before enrichment, retry logic after validation |
| `scripts/scotus/scout-validator.js` | Add structured error codes alongside existing messages |
| `migrations/089_scotus_merits_classification.sql` | Add `is_merits_decision` boolean column |

### No changes to

- Safety guardrails, rollback capture, budget enforcement (all unchanged)
- `scout-parser.js`, `scout-prompt.js` (unchanged)
- `syllabus-extractor.js`, `oyez-client.js` (unchanged)

## Cost Impact

Cost depends on case mix and triage hit rate. Not a clean linear model — branching logic means per-case cost varies.

| Scenario | v1 Cost | v2 Cost | Notes |
|----------|---------|---------|-------|
| Case passes first try | $0.01 | $0.01 | Unchanged — deterministic triage skips API call |
| Case needs retry | $0.01 (wasted) | $0.015-0.02 | First pass + targeted follow-up |
| Non-merits, deterministic triage | $0.01 (wasted) | $0.00 | No API call needed |
| Non-merits, Perplexity triage | $0.01 (wasted) | $0.005 | Triage call only |
| False non-merits (triage error) | N/A | $0.005 (cost) + missed case (risk) | Mitigated by spot-check |
| **Full run (~145 cases)** | **~$1.50** | **~$1.40-1.80** | Range reflects uncertainty in triage/retry mix |

## Verification Plan

### 1. Triage accuracy (new, critical)

Run triage on ALL ~145 cases. Measure:
- How many classified as non-merits (deterministic vs Perplexity)
- **False non-merits rate:** Manually verify every Perplexity-triaged non-merits case against the actual docket. Target: 0 false non-merits.
- **False merits rate:** Less critical (case just gets enriched normally and may fail), but track it.
- Report must list every non-merits classification with the reason.

### 2. Retry effectiveness (on known problem cases)

Run Scout v2 on the 6 problem cases from the trial (IDs: 40, 55, 56, 57, 63, 73):
- Tyndall (40), Pinehurst (56), Coalition for TJ (55), McHenry (73), Bowe (57): should be triaged as non-merits
- Trump (63): should pass first-pass or after retry

Run on Connelly (ID: 4): should get author=Thomas after retry

### 3. Batch comparison (v1 vs v2)

Run 25-case batch. Compare:
- ok rate on merits cases vs v1 baseline (v1 was 76% overall, but included non-merits cases in denominator)
- v2 ok rate should be measured on merits cases only
- Gold set comparison: meet or exceed v1's 86% on gold cases

### 4. Full run

Run all ~145 cases. Report must include:
- Triage decisions (merits count, non-merits count, classification reasons)
- ok/uncertain/failed/needs_review distribution (on merits cases only)
- Retry stats: how many retries triggered, how many resolved the issue
- Gold set accuracy
- Cost breakdown (triage calls + first-pass + retries)

**No pre-set ok-rate target.** The v1 baseline (76% on all cases) included non-merits in the denominator. v2 changes the denominator. Report the numbers and evaluate based on actual distribution, not a pre-committed threshold.

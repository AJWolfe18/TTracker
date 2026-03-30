# Scout v2: Triage + Targeted Retry

## Context

Scout v1 achieves 76-86% accuracy enriching SCOTUS cases via single-pass Perplexity queries. The remaining failures fall into two categories:

1. **Non-merits cases** (cert denials, stay orders, shadow docket) — these lack vote splits, authors, and formal dispositions because SCOTUS never ruled on the substance. They shouldn't be enriched.
2. **Merits cases with fixable errors** — missing fields, invalid enums, contradictions. Manual trial showed that a single targeted follow-up question to Perplexity fixes these (Connelly author, Trump v US sources).

## Design

### Change 1: Triage (skip non-merits)

**Where:** Early in the per-case loop in `scotus-scout.js`, before the main enrichment query.

**How:** After fetching a case from DB, ask Perplexity a short triage question:

```
Is [case_name] ([docket_number]) a Supreme Court merits decision
(full briefing, oral argument, written opinion)? Or is it a
non-merits action (certiorari denied, stay order, GVR, shadow
docket)? Answer ONLY: "merits" or "non-merits".
```

**On "non-merits" response:**
- Set `fact_review_status = 'non_merits'` in DB (add to CHECK constraint)
- Skip enrichment for this case
- Log it in the report
- Cost: ~$0.005 per triage call

**On "merits" response:**
- Proceed to normal Scout enrichment

**Optimization:** Only triage cases that don't already have a `case_type` or other indicator. Cases that already passed enrichment successfully don't need triage on reruns.

### Change 2: Targeted Retry (fix validation failures)

**Where:** After the validator runs in `scotus-scout.js`, before marking a case as uncertain/failed.

**How:** Map validation errors to targeted follow-up prompts:

```javascript
const RETRY_PROMPTS = {
  'Missing required field: vote_split':
    'What was the vote split in {case_name} ({docket})? Format: N-N (e.g. 5-4, 9-0).',

  'Missing required field: formal_disposition':
    'What was the formal SCOTUS disposition in {case_name} ({docket})? ' +
    'Use one of: affirmed, reversed, vacated, remanded, reversed_and_remanded, ' +
    'vacated_and_remanded, affirmed_and_remanded, dismissed.',

  'Missing required field: majority_author':
    'Who delivered the opinion of the Court in {case_name} ({docket})? Last name only.',

  'Invalid formal_disposition enum':
    'The disposition "{value}" is not standard. For {case_name} ({docket}), ' +
    'what was the formal SCOTUS disposition? Must be one of: affirmed, reversed, ' +
    'vacated, remanded, reversed_and_remanded, vacated_and_remanded, ' +
    'affirmed_and_remanded, dismissed.',

  'Unanimous vote but dissent_authors is non-empty':
    'For {case_name} ({docket}), sources conflict: vote is listed as {vote_split} ' +
    'but {dissent_authors} listed as dissenters. Was this a merits decision? ' +
    'What was the actual vote split and who dissented?',

  'Missing required field: substantive_winner':
    'In {case_name} ({docket}), who benefits from the ruling and why? One sentence.'
};
```

**Flow:**
1. Scout first pass runs as normal
2. Validator returns issues array
3. If status is uncertain or failed AND issues match a retry prompt:
   - Construct targeted question from template + case data
   - Call Perplexity with the targeted question (~$0.005-0.01)
   - Parse the response: extract the specific field value from Perplexity's text answer (regex for vote_split pattern N-N, disposition enum match, last-name extraction for author, free text for substantive_winner)
   - Patch the specific failing field(s) into the original result
   - Re-run validator on the patched result
4. If still fails after 1 retry: mark as `needs_review` (give up gracefully)
5. Max 1 retry per case

**What retry does NOT do:**
- Does not re-run the entire Scout prompt
- Does not retry on parse errors (those are structural, not data issues)
- Does not retry more than once
- Does not change the cost for cases that pass first time

### Change 3: Migration (add 'non_merits' to CHECK constraint)

```sql
ALTER TABLE scotus_cases
DROP CONSTRAINT scotus_cases_fact_review_status_check;

ALTER TABLE scotus_cases
ADD CONSTRAINT scotus_cases_fact_review_status_check
CHECK (fact_review_status IS NULL OR fact_review_status IN
  ('ok', 'needs_review', 'failed', 'non_merits'));
```

### Files Modified

| File | Change |
|------|--------|
| `scripts/enrichment/scotus-scout.js` | Add triage step, retry logic after validation |
| `migrations/089_scotus_non_merits_status.sql` | Add 'non_merits' to CHECK constraint |

### No changes to

- Safety guardrails, rollback capture, budget enforcement (all unchanged)
- `scout-parser.js`, `scout-validator.js`, `scout-prompt.js` (unchanged)
- `syllabus-extractor.js`, `oyez-client.js` (unchanged)
- Gold truth, unit tests (add new tests for retry/triage only)

## Cost Impact

| Scenario | v1 Cost | v2 Cost |
|----------|---------|---------|
| Case passes first try (76-86%) | $0.01 | $0.01 (unchanged) |
| Case needs retry (10-20%) | $0.01 (wasted) | $0.02 (first pass + retry) |
| Non-merits case (5-10%) | $0.01 (wasted) | $0.005 (triage only) |
| **Full run (~145 cases)** | **~$1.50** | **~$1.60-1.80** |

## Verification Plan

1. Run Scout v2 on the 6 problem cases from the trial (IDs: 40, 55, 56, 57, 63, 73)
   - Tyndall, Pinehurst, Coalition for TJ: should be triaged as non-merits
   - McHenry, Bowe: should be triaged as non-merits
   - Trump: should pass after retry (if it fails first pass again)
2. Run on Connelly (ID: 4) — should get author=Thomas after retry
3. Run on 25-case batch — compare ok rate vs v1 baseline (was 76%)
4. Gold set comparison — should meet or exceed v1's 86%
5. Full run — target: >90% ok rate on merits cases

# 2026-01-31: ADO-323 SCOTUS Prompt-QA Alignment

## Summary

Added ACCURACY CONSTRAINTS to PASS2_SYSTEM_PROMPT to reduce false REJECTs caused by prompt-QA mismatch. Also added `--case-ids` option for targeted enrichment testing.

## What Was Done

**Story 1: Prompt Constraints**
- Added `PASS2_PROMPT_VERSION = 'v2-ado323-qa-aligned'`
- Appended ACCURACY CONSTRAINTS section to end of PASS2_SYSTEM_PROMPT:
  - Banned scale words (nationwide, millions, etc.)
  - Banned scope phrases (sets precedent, opens the door, etc.)
  - Lane discipline (standing vs merits)
  - Tone-severity alignment
  - Impact-without-overclaim examples

**Story 2: Targeted Enrichment**
- Added `--case-ids=145,161,230` CLI option to `enrich-scotus.js`
- Order-preserving, deduplicating fetch

**Story 3: Regression Testing**
- Ran 4-case test (145, 173, 285, 287)
- Layer A improved: 2/4 APPROVE (was 0/6)
- Layer B still catches slips (GPT doesn't follow constraints 100%)

## Results

| Metric | Before | After |
|--------|--------|-------|
| Layer A APPROVE | 0/6 | 2/4 |
| Layer A FLAG | 6/6 | 1/4 |
| Layer A REJECT | 0/6 | 1/4 |

GPT still occasionally produces banned phrases ("millions", "opens the door") despite constraints. This is expected - the QA system is the backstop.

## Files Changed

- `scripts/enrichment/scotus-gpt-prompt.js` - Added ACCURACY CONSTRAINTS + version
- `scripts/scotus/enrich-scotus.js` - Added --case-ids option

## Next Steps

1. Monitor production enrichment for improvement
2. If REJECTs persist, consider strengthening constraints or adjusting validator sensitivity
3. ADO-317 dashboard work (separate)

## Commits

- (pending) feat(ado-323): add ACCURACY CONSTRAINTS to SCOTUS prompt + --case-ids option

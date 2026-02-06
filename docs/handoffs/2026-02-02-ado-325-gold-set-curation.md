# Handoff: ADO-325 - Gold Set Curation

**Date:** 2026-02-02
**ADO:** [325](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/325) (Active)
**Branch:** test

## Summary

Started gold set curation for SCOTUS QA calibration. Created evaluation framework and reviewed first 3 cases.

## What Was Done

1. Created evaluation framework with 7 criteria (Accuracy, Scope, Tone, Facts, Label, Level, Procedural) - each scored 1-3
2. Created tracking CSV: `docs/features/scotus-qa/gold-set-review.csv`
3. Reviewed 3 Level 2 (procedural) cases:
   - **Case 174** (Laboratory Corp v. Davis) → GOLD candidate - clean procedural description
   - **Case 11** (FDA v. Alliance) → FIX - overclaims precedential impact
   - **Case 203** (NRC v. Texas) → BAD-EXAMPLE - confusing "reversed" language

## Files Created

- `docs/features/scotus-qa/gold-set-curation.md` - Evaluation framework
- `docs/features/scotus-qa/gold-set-review.csv` - Tracking spreadsheet (open in Excel)
- `docs/features/scotus-tracker/courtlistener-api-usage.md` - API usage doc for Free Law Project

## Next Session

1. Josh reviews CSV and adds verdicts for Level 2 cases
2. Pull Level 1 cases (people-side wins) into CSV
3. Pull Level 3 cases (narrow defendant wins) into CSV
4. Continue review until 15-20 gold examples identified

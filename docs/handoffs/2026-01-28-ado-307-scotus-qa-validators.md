# 2026-01-28: ADO-307 SCOTUS QA Validators Complete

## Summary

ADO-307 (Layer A: Deterministic QA Validators) implemented and pushed to test branch. Created `scripts/enrichment/scotus-qa-validators.js` with hyperbole lint and procedural posture checks. All 15 unit tests pass.

## What Was Done

1. Created `scotus-qa-validators.js` with validators for hyperbole, scale words, and procedural posture
2. Created `.test.js` file with comprehensive tests
3. Ran code review - identified 3 issues
4. Fixed issue #2 (false positives on multi-word phrases) with normalized phrase matching:
   - Detection: strict space-boundary matching (prevents "every American-made" → "every american")
   - Support: lenient matching (allows "millions-strong" → "millions")
5. Skipped issues #1 and #3 (could make things worse)
6. Fixed pre-commit hook matcher: `Bash(*git commit*)` to catch `git add && git commit`
7. Created ADO-311 for Jest test runner setup (backlog)

## Commits

- `e17c58d` - Initial validators implementation
- `f9b0f03` - Phrase matching fix for false positives

## Files Created/Modified

- `scripts/enrichment/scotus-qa-validators.js` - Validators with normalized phrase matching
- `scripts/enrichment/scotus-qa-validators.test.js` - 15 test cases
- `.claude/settings.local.json` - Fixed hook matcher

## Next Steps

1. **ADO-308**: Add QA schema columns to `scotus_cases` table and integrate validators into enrichment pipeline
2. **ADO-309**: Implement retry logic and human review workflow
3. **ADO-311**: Jest test runner setup (backlog)

# Handoff: ADO-324 - Fix affected_sentence validation bug

**Date:** 2026-02-02
**ADO:** [324](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/324) (Resolved)
**Branch:** test
**Commit:** 2f47049

## Summary

Fixed the critical fail-open bug where Layer B validation failures caused silent approval of bad content (Case 173: approved despite claiming non-existent dissenters).

## What Changed

| Fix | Description |
|-----|-------------|
| **P1: Fail-closed verdict** | Layer B errors/null now return `REVIEW` instead of passing through to `APPROVE` |
| **P2: Graceful degradation** | Invalid issues dropped individually, not entire response invalidated |
| **Enhanced normalization** | Case-insensitive, em-dash, ellipsis, Unicode handling |
| **Layer A dissent check** | New `ungrounded_dissent_reference` validator catches Case 173 pattern deterministically |

## Test Results

- 88 unit tests passing (Layer B)
- Manual validation of Case 173 pattern confirms fix
- Verdict precedence now: `REJECT > REVIEW > FLAG > APPROVE`

## Files Changed

- `scripts/enrichment/scotus-qa-layer-b.js` - Core fix
- `scripts/enrichment/scotus-qa-validators.js` - Dissent check
- `scripts/enrichment/qa-issue-types.js` - New issue type
- `*test.js` files - Test coverage

## Next Steps

1. **Integration test:** Run enrichment batch with `LAYER_B_MODE=enforce` on a few cases
2. **Verify:** Case 173 should now get `REJECT` (dissent mismatch) or `REVIEW` (if Layer B drops issue)
3. **Then:** ADO-325 (curate gold set) to calibrate the 95% reject rate

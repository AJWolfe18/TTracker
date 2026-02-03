# Handoff: ADO-324 - Fix affected_sentence validation bug

**Date:** 2026-02-02
**ADO:** [324](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/324) (Resolved)
**Branch:** test
**Commits:** 2f47049, 341e11e

## Summary

Fixed the critical fail-open bug where Layer B validation failures caused silent approval of bad content (Case 173: approved despite claiming non-existent dissenters).

## What Changed

| Fix | Description |
|-----|-------------|
| **P1: Fail-closed verdict** | Layer B errors/null now return `REVIEW` instead of passing through to `APPROVE` |
| **P2: Graceful degradation** | Invalid issues dropped individually, not entire response invalidated |
| **Enhanced normalization** | Case-insensitive, em-dash, ellipsis, Unicode handling |
| **Layer A dissent check** | New `ungrounded_dissent_reference` validator catches Case 173 pattern deterministically |

## Integration Test Results

Ran full QA pipeline on Cases 173, 287, 145:

| Case | Layer A | Layer B | Final | Status |
|------|---------|---------|-------|--------|
| 173 (BLOM Bank) | REJECT | REJECT | REJECT | ✅ Fixed - was APPROVE before |
| 287 (Case v. Montana) | REJECT | REJECT | REJECT | ✅ Caught scale issue |
| 145 (Noem v. Abrego) | APPROVE | REJECT | REJECT | ✅ Layer B caught accuracy |

## Key Finding: Layer B 91% Reject Rate

Analysis of all 44 enriched cases:
- Layer A (enforced): 50% APPROVE, 5% FLAG, 2% REJECT
- Layer B (shadow): **91% REJECT**, 2% APPROVE

Layer B flags `accuracy_vs_holding` on 41/44 cases. This suggests:
1. Content generation has systematic issues, OR
2. Layer B needs calibration with gold examples

**32 cases are published** that Layer B wanted to reject. Need human review to determine if Layer B is correct.

## PROD Deployment Recommendation

- ✅ Deploy Layer A enforce mode
- ⚠️ Keep Layer B in shadow mode until ADO-325/326 complete
- ✅ Deploy ADO-324 fix (fail-closed protects us)

## Next Session: ADO-325 (Gold Set Curation)

1. Review 15-20 cases manually
2. Mark good editorials as gold standards
3. Then ADO-326 integrates them into Layer B prompt

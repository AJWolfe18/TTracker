# ADO-438: Disposition Bug Fix + Bufkin Invariant

**Date:** 2026-03-08 | **Commits:** 296045f, ac6cab9 | **Branch:** test

## What was done
Three fixes + one code review fix applied to SCOTUS enrichment:
1. **Prompt clarification** — DISPOSITION RULES block in Pass 1 prompt
2. **Post-extraction cross-check** — `validatePass1()` searches full text for formal SCOTUS patterns, overrides GPT when regex disagrees. Guard added to not override specific dispositions with 'other' from compound patterns.
3. **Bufkin invariant** — Tightened who_loses regex (noun "benefits"/"gains" no longer flagged)
4. Re-ran enrichment on 7 affected cases, validated.

**Validation: 126/145 (86.9%) → 131/145 (90.3%), no regressions.**

## TODO for next session
1. **Update ADO-438** — move to Testing, add validation results as comment
2. **Flag for Josh:** Case 131 (Vanderstok) expected value in validation may be wrong — formal text says "judgment is reversed" but validation expects "vacated". Josh should verify.
3. **Remaining failures:** 7 vote_split nulls (pre-existing SCOTUSblog lookup), 2 disposition mismatches (51+64 — CourtListener text lacks formal conclusion), 3 edge case issues
4. **ADO-440** now unblocked — 108 unenriched cases can proceed once ADO-438 accepted

# ADO-438: Disposition Bug Fix + Bufkin Invariant

**Date:** 2026-03-08 | **Commit:** 296045f | **Branch:** test

## What was done
Three fixes applied to SCOTUS enrichment:
1. **Prompt clarification** — Added DISPOSITION RULES block to Pass 1 explaining SCOTUS disposition = action on court immediately below
2. **Post-extraction cross-check** — `validatePass1()` now searches full opinion text for formal SCOTUS conclusion patterns (judgment_*, citation_*, compound, "we affirm/reverse/vacate"). Overrides GPT when formal regex disagrees. Fixed Horn (137, reversed→affirmed), Riley (224, reversed→vacated), Bowe (285, prompt alone fixed to vacated).
3. **Bufkin invariant** — Tightened who_loses regex to not flag noun "benefits"/"gains". Bufkin (120) now fully enriches.

## Results
- Validation: **126/145 (86.9%) → 131/145 (90.3%)**, no regressions
- 4 of 7 targeted cases fixed; remaining 3:
  - Kirtz (51), Wullschleger (64): CourtListener text lacks formal conclusion language — cross-check can't help, only prompt change available
  - Vanderstok (131): Formal text says "judgment is reversed" but validation expects "vacated" — **expected value may be wrong** (SCOTUS reversed the Fifth Circuit). Josh should verify.

## Next
- ADO-438 → Testing (fixes applied, validation improved)
- Remaining 7 vote_split nulls are pre-existing SCOTUSblog lookup issues (not in ADO-438 scope)
- ADO-440 (108 unenriched cases) can proceed once ADO-438 is accepted

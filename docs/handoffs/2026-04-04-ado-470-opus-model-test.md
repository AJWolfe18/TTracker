# Handoff: SCOTUS Claude Agent — Opus Model Test

**Date:** 2026-04-04
**Branch:** test
**ADO:** 470 (Active)

## What Was Done

### Opus vs Sonnet Model Comparison
- Updated RemoteTrigger (trig_01S2xQVXfaB8rGJpbaPCWPvV) model from claude-sonnet-4-20250514 to claude-opus-4-6
- Ran agent on same 5 hard cases (23, 108, 118, 138, 226) with identical prompt
- Scored results against known actuals from Sonnet baseline

### Results: Opus Wins

| Metric | Sonnet | Opus |
|--------|--------|------|
| Pass rate | 3/5 (60%) | 5/5 (100%) |
| Wrong fields unflagged | 2 cases | 0 cases |
| Runs needed (5 cases) | 2 | 1 |
| Duration | ~341s across 2 runs | 630s in 1 run |

Key improvements:
- ID 118 (SF v. EPA): Opus got all 5 fields correct. Sonnet got disposition wrong.
- ID 226 (Medina v. PP): Opus got all 3 dissenters. Sonnet only listed 1 of 3.
- ID 108 (Glossip): Both wrong on recusal math, but Opus flagged for review. Sonnet didn't.
- ID 138 (FDA v. Wages): Opus got precise disposition (vacated_and_remanded). Sonnet imprecise.

### Tone Gap Identified
- Current SCOTUS prompt defines summary_spicy as "engaging, accessible, not academic"
- Does NOT reference the tone system (public/shared/tone-system.json)
- Missing: "The Betrayal" voice, level-specific tone calibration, opening patterns, profanity rules
- Output is good journalism but too neutral for TrumpyTracker brand
- New ADO card needed for prompt tone integration

### scotus-review Skill Created
- `.claude/commands/scotus-review.md` — slash command to review enrichment output
- Checks hard fields, editorial quality, tone, completeness
- Invoked as `/scotus-review 23,108` or `/scotus-review latest`
- Needs update: tone check section should reference tone-system.json (currently incorrect)

## Files Changed
- `docs/features/scotus-claude-agent/validation-summary.md` — Added Opus row, updated comparison table and recommendation
- `docs/features/scotus-claude-agent/validation-results/2026-04-04-opus-v1.json` — New, Opus test results
- `.claude/commands/scotus-review.md` — New skill (not in git)
- `docs/handoffs/2026-04-04-ado-470-opus-model-test.md` — This file

## Tone System Locations (for next session)
1. `docs/PRODUCT_VISION.md` (lines 87-111) — Brand voice DOs/DON'Ts
2. `public/shared/tone-system.json` — Operational single source of truth
3. `docs/features/labels-tones-alignment/plan.md` — Architecture plan, frame buckets
4. `scripts/enrichment/scotus-variation-pools.js` — 60+ SCOTUS opening patterns by level (deprecated but informative)

## What's Next
1. Create ADO card: SCOTUS prompt tone integration (update prompt-v1.md to align with tone system)
2. Update scotus-review skill tone check section
3. Re-run agent with tone-aligned prompt, review with /scotus-review
4. Admin dashboard review card (ADO-340) remains the go-live blocker

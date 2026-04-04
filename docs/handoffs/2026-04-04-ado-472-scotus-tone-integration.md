# Handoff: SCOTUS Prompt Tone Integration

**Date:** 2026-04-04
**Branch:** test
**ADO:** 472

## What Was Done

### Prompt v1.1 — Tone System Integration
Updated `docs/features/scotus-claude-agent/prompt-v1.md` with:

1. **Brand Voice section** added to Step 4 (editorial fields):
   - "The Betrayal" voice + framing
   - Level-specific tone calibration table (0-5)
   - Profanity rules (allowed only at levels 4-5)
   - Opening pattern guidance by level (inspired by scotus-variation-pools.js)
   - 27 banned openings from tone-system.json
   - Voice DOs/DON'Ts from PRODUCT_VISION.md

2. **Gold set examples rewritten** (5 cases):
   - Barrett (level 2): Eye-roll tone — "Not a profile in courage"
   - Bufkin (level 3): Sardonic — "The system works great — for the system"
   - Horn (level 3): Sardonic — "the corporate lobby is not happy"
   - Davis (level 1): Cautious skepticism — "Read the tea leaves"
   - TikTok (level 5): Alarm bells — "That should scare you"

3. **Prompt metadata** updated: version v1.1, target model Opus

### scotus-review Skill Created
`.claude/commands/scotus-review.md` — slash command to review enrichment output:
- Hard field validation against `tests/scotus-gold-truth.json`
- Tone checking against `public/shared/tone-system.json`
- Level calibration, profanity compliance, banned opening detection
- Completeness checks for all required fields

### Validation Run
- Reset 5 cases (23, 108, 118, 138, 226) to pending
- Triggered cloud agent (Opus, run log ID 12)
- **Results: 5/5 PASS, 330s runtime**
- Tone: 4/5 clearly on-brand, 1/5 (Vidal, level 2) slightly mild but appropriate
- Hard fields: All valid, 1 edge case (Glossip 6-2 recusal — correct split but not flagged for review)
- Key tone wins: Medina ("slammed the courthouse door"), Glossip ("drag a man off death row"), SF v EPA ("dictionary from 1961")

## Files Changed
- `docs/features/scotus-claude-agent/prompt-v1.md` — Tone integration + gold set rewrites
- `.claude/commands/scotus-review.md` — New skill
- `docs/features/scotus-claude-agent/validation-results/2026-04-04-tone-v1.1.json` — Validation results
- `docs/features/scotus-claude-agent/validation-summary.md` — Added Round 6 row + details

## What's Next
1. **Admin dashboard review card (ADO-340)** — go-live blocker, Josh needs UI to review/publish enriched cases
2. **Enable daily schedule** — trigger cron_expression is currently empty string (disabled). Set to `0 16 * * 1-5` (4PM UTC weekdays) when ready
3. **Events feature schema rework** — separate track, see `docs/features/events-tracker/design.md`

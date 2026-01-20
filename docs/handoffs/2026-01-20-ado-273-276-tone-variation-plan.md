# Handoff: Tone Variation Fix Planning Complete

**Date:** 2026-01-20
**Branch:** test
**Commit:** 2c59ea3
**Status:** Planning complete, ready for Phase 1 implementation

---

## Summary

Created comprehensive plan for fixing repetitive GPT outputs across all 4 content types. This is an **architectural pivot** from the original level-based variation system.

---

## ADO Work Items Created

| ADO | Content | Phase | Effort | Dependencies |
|-----|---------|-------|--------|--------------|
| **273** | EOs | 1 | 1 session | None |
| **274** | Stories | 2 | 1 session | 273 |
| **275** | SCOTUS | 3 | 0.5 session | 273, 274 |
| **276** | Pardons | 4 | 0.5 session | 273-275 |

---

## Key Architecture Decisions

### Problem: Original level-based system doesn't work
- Can't know alarm level until GPT determines it
- But need alarm level to select appropriate variation
- Result: hardcoded to level 3, all outputs similar

### Solution: Frame bucket approach
1. **3 frame buckets** instead of 6 levels: `alarmed` / `critical` / `cautious_positive`
2. **Estimate frame pre-GPT** from title + abstract + category keywords
3. **Device-only instructions** (structure, not intensity)
4. **Mismatch fuse** in prompt lets GPT correct if estimate wrong
5. **Deterministic selection** via hash for reproducibility

### What stays the same
- Labels (0-5 scale with content-specific names)
- Voices (Transaction/Chaos/Power Grab/Betrayal)
- Colors (red→green gradient)
- Tone calibration by level in prompt
- Category pools (miller/donor/default for EOs, etc.)

---

## Plan Location

`docs/features/labels-tones-alignment/tone-variation-fix-plan.md`

Contains:
- Full architecture specification
- Content-type-specific details for all 4 types
- Device card template
- Frame estimation functions
- Acceptance criteria
- Migration strategy

---

## Next Session: Phase 1 (ADO-273 - EOs)

### Files to modify:
1. `executive-orders-tracker-supabase.js` - Store FR abstract in `description`
2. `eo-variation-pools.js` - Rewrite with frame buckets + device-only cards
3. `prompts.js` - Fix payload, add REQUIRED VARIATION, mismatch fuse, section bans
4. `enrich-executive-orders.js` - Wire deterministic selection + batch tracking

### Prompt to start:
```
Continue ADO-273: Implement EO tone variation fix (Phase 1).

Read: docs/features/labels-tones-alignment/tone-variation-fix-plan.md

Start with: Store FR abstract in tracker, then rewrite eo-variation-pools.js
```

---

## Session Stats

- Investigation + architecture design discussion
- Created comprehensive multi-phase plan
- Created 4 ADO work items (273-276)
- Commit: 2c59ea3

**Token usage:** ~65K input, ~15K output

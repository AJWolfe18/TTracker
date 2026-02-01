# Handoff: ADO-312 UI De-Vibe Plan

**Date:** 2026-01-28
**ADO:** #312 - De-vibe UI: Remove AI aesthetic tells, implement B/W + stamp design
**State:** New (ready to start)

## What Happened

Created comprehensive plan to remove "vibe coded" AI aesthetic from TrumpyTracker UI:
- Researched vibe-coded tells (blue, gradients, blur, hover lifts, glows)
- Created interactive preview: `public/style-preview.html`
- Iterated with Josh on direction: **Pure B/W + gray stamp-style severity badges**
- Finalized plan: `docs/features/ui-devibe/plan.md`

## Final Direction Confirmed

- **Zero color** - No blue, no red, pure B/W + grays
- **Stamp badges** - Severity as angled stamps with border, no fill, gray only
- **Gray categories** - No colored category badges
- **B/W buttons** - White on dark, black on light
- **No effects** - No gradients, blur, hover lifts, or glows
- **Remove emojis** - Clean up any decorative emoji usage

## Next Session Prompt

```
Continue ADO-312: UI De-Vibe implementation.

1. Read the plan: docs/features/ui-devibe/plan.md
2. Move ADO-312 to Active
3. Start with Phase 1: Update CSS variables in themes.css
   - Light mode B/W palette
   - Dark mode B/W palette
4. Then Phase 2: Remove effects (gradients, blur, hover lifts)
5. Then Phase 3: Convert severity badges to stamp style
6. Test both themes after each phase
7. Preview file for reference: public/style-preview.html

Key files:
- public/themes.css (primary - all changes here)
- public/style-preview.html (reference for final look)
```

## Files Created

- `docs/features/ui-devibe/plan.md` - Full implementation plan
- `public/style-preview.html` - Interactive preview of final direction
- `.claude/commands/start-work.md` - New slash command for workflow

## Untracked Files

These should be committed:
- `docs/features/ice-tracker/` (unrelated - ICE tracker PRD)
- `docs/handoffs/2026-01-25-ado-275-scotus-tone-variation.md`
- `docs/handoffs/2026-01-26-ado-305-306-scotus-qa.md`
- `scripts/scotus/fix-source-urls.js`
- `scripts/scotus/test-gpt-enrichment.js`
- `scripts/scotus/test-opinion.txt`
- `.claude/commands/start-work.md`
- `public/style-preview.html`
- `docs/features/ui-devibe/plan.md`
- This handoff

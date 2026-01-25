# SCOTUS UI Fixes Plan

## Overview
Track UI fixes for SCOTUS cards that need to go to prod.

## Commits Pending for Prod

| Commit | Description | Status |
|--------|-------------|--------|
| `9fddda5` | fix(scotus): consistent impact colors + remove disposition from cards | Pending verification on test |
| `d121927` | fix(scotus): remove emojis from card (author icon + view details arrow) | Pending verification on test |
| `d00faa7` | fix(scotus): simplify sources section - remove citations, add header | Pending verification on test |
| `3754ab2` | fix(scotus): add missing closing paren in sources section | Pending verification on test |
| `df7ec09` | fix(scotus): correct dark theme box-shadow colors for levels 3 and 1 | Pending verification on test |

## Changes in 9fddda5

1. **Consistent impact badge colors** - Added `SCOTUS_LABEL_TO_LEVEL` reverse lookup so same label always shows same color (fixes DB inconsistency where same label had different `ruling_impact_level` values)

2. **Removed disposition from cards** - "Reversed", "Vacated", etc. no longer shown on card view (still in modal)

3. **Date moved to right** - Timestamp now right-aligned in card header

4. **CSS colors updated** - Match business-logic-mapping.md exactly

## Related ADO Items
- ADO-301: Add category badges to SCOTUS cards (future work, top-left now available)

## Verification Checklist
- [ ] Impact badges show consistent colors for same label
- [ ] Disposition not visible on cards
- [ ] Disposition still visible in modal
- [ ] Date appears on right side of card
- [ ] No ⚖️ emoji next to judge name
- [ ] No ↗ arrow on "View details" button
- [ ] Modal shows "Sources" header with CourtListener + PDF links
- [ ] No citations/evidence anchors section in modal

## Cherry-pick Command
```bash
git cherry-pick 9fddda5 d121927 d00faa7 3754ab2 df7ec09
```

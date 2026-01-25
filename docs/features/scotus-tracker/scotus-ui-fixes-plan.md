# SCOTUS UI Fixes Plan

## Overview
Track UI fixes for SCOTUS cards that need to go to prod.

## Commits Pending for Prod

| Commit | Description | Status |
|--------|-------------|--------|
| `9fddda5` | fix(scotus): consistent impact colors + remove disposition from cards | Pending verification on test |

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

## Cherry-pick Command
```bash
git cherry-pick 9fddda5
```

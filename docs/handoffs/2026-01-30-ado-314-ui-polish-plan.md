# Handoff: ADO-314 UI Polish Plan Created

**Date:** 2026-01-30
**ADO:** #314 - UI Polish: Fix visual inconsistencies across all tabs
**State:** New → Active (planning complete)

## What Was Done

Created comprehensive UI polish plan with expert UX review:
- Identified 7 specific inconsistencies across tabs
- Got expert UX recommendations from frontend-design analysis
- Documented exact file locations and code changes needed
- User chose "Full polish pass" scope

## Plan Location

**File:** `C:\Users\Josh\.claude\plans\zany-tickling-diffie.md`

## Next Session

```
Resume ADO-314: Execute the UI polish plan.

1. Read plan: C:\Users\Josh\.claude\plans\zany-tickling-diffie.md
2. Follow implementation order (Phases A, B, C)
3. Start with JS fixes (pardons-app.js, app.js)
4. Then CSS polish (themes.css)
5. Visual test, code review, commit, push
```

## Key Fixes

| Issue | File | Line |
|-------|------|------|
| Pardons theme toggle missing emojis | pardons-app.js | 254 |
| Pardons "View details" missing arrow | pardons-app.js | 483 |
| SCOTUS "View details" missing arrow | app.js | 846 |
| Filter sorting not alphabetical | all *-app.js | TBD |
| Filter pill wrapping collision | themes.css | ~1374 |
| Missing focus states | themes.css | ~2617 |

## Related

- ADO-312: De-vibe work (CSS mostly done, ready to commit)
- `public/style-preview.html`: Visual reference for B/W direction

# Handoff: ADO-312 UI De-Vibe Progress

**Date:** 2026-01-29
**ADO:** #312 - De-vibe UI: Remove AI aesthetic tells, implement B/W + stamp design
**State:** Active (in progress)

## What Was Done

Phases 1-4 completed:
- **Phase 1:** CSS variables updated to B/W palette (links gray, buttons monochrome, categories gray)
- **Phase 2:** Removed gradients, blur, hover lifts, glows, noise texture
- **Phase 3:** Severity badges converted to stamp style with rotation in themes.css
- **Phase 4:** JS color constants updated to gray in app.js, pardons-app.js, tone-system.json

## Issues Found During Testing

### 1. Grey Film Effect (Both Modes)
Everything looks washed out, like a grey overlay. Cause: too many grey tones, not enough contrast.

**Fix needed:**
- Increase text contrast (darker blacks, crisper whites)
- Card backgrounds need more contrast with page
- Summary text too muted

### 2. Severity Badges Not Showing as Stamps
Pardons page shows filled grey rectangles, NOT bordered stamp style. The `.tt-spicy-badge` class in pardons-app.js likely uses inline styles or different class than `.tt-severity`.

**Fix needed:**
- Check how pardons-app.js renders spicy badges
- Ensure it uses stamp style (border, no fill, rotation)
- May need to update `.tt-spicy-badge` CSS or JS rendering

### 3. Button Width Inconsistency
"View details" button narrower in dark mode vs light mode.

**Fix needed:**
- Check button padding/border differences between themes

## Files Modified (NOT YET COMMITTED)

```
public/themes.css          - CSS variables + removed effects
public/app.js              - ALARM_COLORS to gray
public/pardons-app.js      - CONNECTION_TYPES, CORRUPTION_LABELS to gray
public/shared/tone-system.json - colors to gray
```

## Reference

- Target design: `public/style-preview.html` (FINAL section)
- Plan: `docs/features/ui-devibe/plan.md`

## Next Session Prompt

```
Continue ADO-312: Fix UI de-vibe issues.

1. Read handoff: docs/handoffs/2026-01-29-ado-312-ui-devibe-progress.md
2. Fix grey film effect:
   - Increase contrast in CSS variables
   - --text-primary should be pure black (#000 or #0a0a0a)
   - --text-secondary less grey, more readable
3. Fix severity/spicy badges on pardons page:
   - Find .tt-spicy-badge usage in pardons-app.js
   - Update to use stamp style (border, no fill, rotation)
4. Fix button width consistency
5. Test all pages in both themes
6. Run code review, commit, push
7. Update ADO-312 to Testing
```

## Server

Local server: `npm run server` → http://localhost:8000/

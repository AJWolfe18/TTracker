# Handoff: TTRC-335 Promote Theme Preview to Main Frontend

**Date:** 2025-12-30
**Branch:** test
**Commits:** 644b8ad, b3b499f, 8f199f5
**Status:** Complete

## Summary

Promoted the new theme preview UI to become the main frontend, replacing the legacy Tailwind/dark-mode-only dashboard.

## Changes Made

### Phase 1: Legacy Files Archived to `/legacy/`

Moved 14 files to `public/legacy/` folder (keeps them runnable as fallback):
- `index.html`, `executive-orders.html`, `eo-detail.html`
- `dashboard.js`, `dashboard-components.js`, `dashboard-filters.js`, `dashboard-stats.js`, `dashboard-utils.js`
- `story-feed.js`, `story-card.js`, `story-api.js`, `story-styles.css`
- `eo-page.js`, `eo-detail.js`
- Copied `supabase-browser-config.js` and `category-config.js` for legacy dependencies

### Phase 2: Files Renamed

| Old Name | New Name |
|----------|----------|
| `theme-preview.html` | `index.html` |
| `theme-preview.js` | `app.js` |
| `eo-theme-preview.html` | `executive-orders.html` |
| `eo-theme-preview.js` | `eo-app.js` |
| `theme-shared.js` | `shared.js` |

### Phase 3: Cross-References Updated

1. **Both HTML files:**
   - Replaced hardcoded TEST Supabase config with `<script src="supabase-browser-config.js"></script>`
   - Updated script src paths to new filenames
   - Updated titles/descriptions

2. **app.js (lines 1117-1120):**
   - Changed tab hrefs from absolute (`/theme-preview.html`) to relative (`./`)

3. **eo-app.js (lines 143, 169-172):**
   - Changed logo href and all tab hrefs to relative paths

4. **shared.js:**
   - Updated comment
   - Added defensive config check that shows visible error if SUPABASE_CONFIG missing

### Environment Configuration

Now uses `supabase-browser-config.js` for automatic TEST/PROD detection:
- `localhost`, `test--*.netlify.app` → TEST database
- Production URLs → PROD database

## Files Summary

| Action | Count |
|--------|-------|
| Moved to /legacy/ | 14 files |
| Renamed | 5 files |
| Edited | 4 files |

## Testing Required

Visit http://localhost:8000 (server already running):

- [ ] `/` loads Stories page
- [ ] `/executive-orders.html` loads EO page
- [ ] Tab navigation works between pages
- [ ] Theme toggle persists
- [ ] `/?story=13710` opens modal
- [ ] `/?tab=scotus` shows Coming Soon
- [ ] Close modal returns to correct URL
- [ ] Esc key closes modals
- [ ] TEST badge visible
- [ ] `/legacy/index.html` still works

## Additional Fixes (same session)

- **b3b499f:** Added moderate/minor severity filter options (was missing "Swamp Shit" and "Clown Show")
- **8f199f5:** Removed uppercase from tagline in light mode

## JIRA Status

- TTRC-335: Done ✅
- TTRC-339: Created (server-side caching - future)

## Related Tickets

- **TTRC-334:** Theme Preview V2 (DONE - prerequisite)
- **TTRC-337:** Mobile UI Simplification (future)
- **TTRC-338:** Entities table for actor names (future)

## Reference Docs

- `docs/guides/ui-patterns.md` - UI standards
- `C:\Users\Josh\.claude\plans\sorted-jingling-crayon.md` - Execution plan

# Handoff: ADO-314 UI Polish Progress

**Date:** 2026-01-31
**ADO:** #314 - UI Polish: Fix visual inconsistencies across all tabs
**State:** Active (in progress) - NOT YET COMMITTED

## What Was Done

### Session 1 Fixes (all *-app.js files)
- Removed theme toggle emojis (back to "Light" / "Dark")
- Removed arrow icons from "View details" buttons
- Changed EO "View analysis" to "View details" for consistency
- Removed "Expand summary" / "Read more" buttons from all cards (cleaner UX)
- Changed search to Enter-based (was type-as-you-search) in Stories and EO
- Fixed category sorting: "Other" now last in Stories dropdown
- Pardons connection type dropdown already alphabetically sorted

### Session 2 Fixes
- **EO Severity Pills** - Changed from dropdown to pills matching Stories/Pardons pattern
  - Now uses alarm_level filtering instead of eo_impact_type
  - Pills display all 6 levels (0-5) with labels from getAlarmLabel()
- **SCOTUS Search** - Added search functionality matching other tabs
  - Enter-based search with local state
  - Searches case_name, majority_author, summary_spicy, who_wins/loses, docket_number
  - Active filter chips with clear all functionality
- **SCOTUS Card Source** - Added CourtListener link to card footer (like other tabs)
- **SCOTUS Modal** - Renamed "Download PDF" to "Download Opinion"
- **ADO #315** - Created bug for EO data normalization (Education capitalization, non-normalized category)

### CSS Fixes (themes.css)
- Fixed EO badge dark mode visibility (was white-on-white)
- Fixed headline truncation (removed min-height causing text bleed)
- Fixed modal double lines (removed border-top from action sections)
- Fixed View details button alignment (always right-aligned with margin-left: auto)
- Added row-gap to severity filters for better wrapping
- Added focus states for more interactive elements
- Added filter chip hover state

## Files Modified (NOT COMMITTED)

```
public/app.js           - Stories + SCOTUS: search, expand removal, button fixes, SCOTUS source link
public/eo-app.js        - EO: severity pills, search, expand removal, button text fix
public/pardons-app.js   - Pardons: expand removal, button fixes
public/themes.css       - All CSS fixes listed above
```

## Known Issues (Resolved or Pending)

1. **SCOTUS colored badges** - Likely browser cache. User viewing from test, not local.
2. **EO "Education" capitalization** - ADO #315 created (database fix needed)
3. **EO non-normalized category** - ADO #315 created (database fix needed)
4. **SCOTUS modal space above title** - User said "doesn't make sense, will come back to it"
5. **EO header restructuring** - Deferred for future consideration

## SCOTUS Local View

SCOTUS should work locally - `localhost` IS detected as test environment in supabase-browser-config.js.
The data will load from TEST Supabase. User may just need to navigate to `?tab=scotus` locally.

## Next Steps

1. Hard refresh browser and visual test all pages
2. Run code review and QA tests
3. Commit changes
4. Push to test branch
5. Update ADO-314

## Server

Local server was running at http://localhost:8000/ - restart with `npm run server` if needed.

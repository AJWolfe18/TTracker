# Handoff: ADO-270 Stories Tone System

**Date**: 2026-01-18
**ADO**: 270
**Status**: ✅ COMPLETE
**Branch**: test
**Commits**: `06f1749`, `0066fb0`

## Summary

Wired Stories to the shared tone system with full 0-5 alarm_level support.

## What Was Done

### Phase 0: Database Migration
- `migrations/064_add_alarm_level_to_stories.sql`
- Added `alarm_level` SMALLINT column with CHECK(0-5) constraint
- Backfilled from legacy severity (critical→5, severe→4, moderate→3, minor→2)
- Created index for filtering
- **Migration NOT applied yet** - run via Supabase SQL editor before next RSS run

### Phase 1: Variation Pools
- `scripts/enrichment/stories-variation-pools.js`
- 4 pools: donor, state_power, democracy, default
- Category-based pool selection via getPoolKey()
- All levels 0-5 have opening patterns in each pool
- "The Chaos" voice framing throughout

### Phase 2: Enrichment Updates
- `scripts/enrichment/prompts.js` SYSTEM_PROMPT:
  - Added tone calibration by level (0-5)
  - Added `{variation_injection}` placeholder
  - Changed output to request `alarm_level` instead of text `severity`

- `scripts/enrichment/enrich-stories-inline.js`:
  - Imports variation pool functions
  - Builds and injects variation into prompt
  - Extracts `alarm_level` from GPT response
  - Derives legacy `severity` for backward compatibility
  - Writes both fields to database

### Phase 3: Frontend Updates
- `public/app.js`:
  - Fetches labels from `/shared/tone-system.json`
  - ALARM_LABELS and ALARM_COLORS fallbacks
  - Helper functions: getAlarmLevel, getAlarmLabel, getAlarmLevelCssClass
  - Queries include alarm_level field
  - Filter logic uses getAlarmLevel() with legacy fallback

- `public/themes.css`:
  - Added CSS variables for levels 0-1 (low, positive)
  - Added .tt-severity[data-severity="low|positive"] rules

## Before Next RSS Run

**CRITICAL**: Apply the migration before running RSS tracker:

```sql
-- Run in Supabase SQL Editor (TEST project: wnrjrywpcadwutfykflu)
-- Copy contents of migrations/064_add_alarm_level_to_stories.sql
```

The enrichment code expects the `alarm_level` column to exist.

## Next Steps

1. **Apply migration** to TEST database
2. Continue with **ADO-271 (EOs)** - same pattern as stories
3. Continue with **ADO-272 (SCOTUS)** - enable profanity at levels 4-5

## Architecture Notes

- Stories now use numeric 0-5 `alarm_level` as primary field
- Legacy `severity` text field derived for backward compatibility (null for levels 0-1)
- Frontend uses getAlarmLevel() which checks alarm_level first, then falls back to legacy severity mapping
- This ensures existing data renders correctly while new enrichments use the full 0-5 scale

## Files Changed

```
migrations/064_add_alarm_level_to_stories.sql  (new)
scripts/enrichment/stories-variation-pools.js  (new)
scripts/enrichment/prompts.js                  (modified)
scripts/enrichment/enrich-stories-inline.js    (modified)
public/app.js                                  (modified)
public/themes.css                              (modified)
docs/features/labels-tones-alignment/plan.md   (modified)
```

## Token Usage

Session tokens: ~50K

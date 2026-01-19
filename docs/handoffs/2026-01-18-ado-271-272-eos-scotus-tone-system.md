# Handoff: ADO-271 + ADO-272 — EOs & SCOTUS Tone System

**Date**: 2026-01-18
**Branch**: test
**Commits**: 5aa72bd, 207cc30, 62864b5

---

## Summary

Completed tone system alignment for Executive Orders (ADO-271) and SCOTUS (ADO-272). All 4 content types now have code complete:

| ADO | Content | Voice | Status |
|-----|---------|-------|--------|
| 269 | Pardons | "The Transaction" | ✅ Complete |
| 270 | Stories | "The Chaos" | ✅ Complete (migration 064 pending) |
| 271 | EOs | "The Power Grab" | ✅ Complete (migration 065 pending) |
| 272 | SCOTUS | "The Betrayal" | ✅ Complete (frontend doesn't exist yet) |

---

## What Was Done

### ADO-271 (Executive Orders)

**New Files:**
- `migrations/065_add_alarm_level_to_executive_orders.sql` — Adds alarm_level (0-5) column with constraint, backfill from legacy severity_rating, and index
- `scripts/enrichment/eo-variation-pools.js` — 3 pools (miller/donor/default) based on category + eo_impact_type

**Modified Files:**
- `scripts/enrichment/prompts.js` — EO_ENRICHMENT_PROMPT now has "THE POWER GRAB" voice, tone calibration by level (0-5), {variation_injection} placeholder, profanity rules (levels 4-5 only)
- `scripts/enrichment/enrich-executive-orders.js` — Imports variation pools, builds injection, writes alarm_level, derives severity_rating from alarm_level
- `public/eo-app.js` — Fetches tone-system.json, has getAlarmLevel() helper with legacy fallback from eo_impact_type

**Pool Selection Logic:**
```javascript
// miller: authoritarian_overreach, fascist_power_grab, immigration_border
// donor: corrupt_grift, economy_jobs_taxes, environment_energy
// default: all others
```

### ADO-272 (SCOTUS)

**Modified Files:**
- `scripts/enrichment/scotus-gpt-prompt.js` — "THE BETRAYAL" voice framing ("guardians becoming arsonists"), explicit profanity rules for levels 4-5
- `scripts/enrichment/scotus-variation-pools.js` — Level 0 "democracy_wins" now has "suspicious celebration" variations

**Note:** scotus-app.js doesn't exist yet — the tab shows "coming soon". Labels are ready in tone-system.json for when the frontend is built.

---

## Pending: Apply Migrations

**REQUIRED BEFORE TESTING:**

Run these in Supabase SQL Editor (TEST project: wnrjrywpcadwutfykflu):

1. **Stories** (if not done yet):
   ```
   migrations/064_add_alarm_level_to_stories.sql
   ```

2. **EOs**:
   ```
   migrations/065_add_alarm_level_to_executive_orders.sql
   ```

Both migrations are idempotent (safe to re-run).

---

## Testing After Migrations

### Test Stories
Trigger RSS tracker:
```bash
gh workflow run "RSS Tracker - TEST" --ref test
```

### Test EOs
Run EO enrichment on a few orders:
```bash
node scripts/enrichment/enrich-executive-orders.js 3
```

### Verify Frontend
- Stories: https://test--trumpytracker.netlify.app/
- EOs: https://test--trumpytracker.netlify.app/executive-orders.html

---

## Files Changed

```
migrations/065_add_alarm_level_to_executive_orders.sql  (NEW)
scripts/enrichment/eo-variation-pools.js                (NEW)
scripts/enrichment/prompts.js                           (modified)
scripts/enrichment/enrich-executive-orders.js           (modified)
public/eo-app.js                                        (modified)
scripts/enrichment/scotus-gpt-prompt.js                 (modified)
scripts/enrichment/scotus-variation-pools.js            (modified)
docs/features/labels-tones-alignment/plan.md            (modified)
```

---

## Key Implementation Details

### EO Alarm Level Flow
1. Enrichment worker calls getPoolKey(category, eo_impact_type)
2. selectVariation() picks opening/device/structure/closing
3. buildVariationInjection() creates prompt text
4. GPT returns alarm_level 0-5
5. normalizeAlarmLevel() validates it
6. alarmLevelToLegacySeverity() derives legacy field (null for 0-1)
7. Both written to database

### Frontend Legacy Fallback
```javascript
function getAlarmLevel(eo) {
  if (eo.alarm_level !== null) return eo.alarm_level;
  if (eo.eo_impact_type) return LEGACY_IMPACT_TO_ALARM[eo.eo_impact_type];
  return 3; // default
}
```

---

## Next Steps

1. Apply migrations 064 + 065 to TEST Supabase
2. Test Stories RSS tracker run
3. Test EO enrichment run
4. Verify frontend displays correct labels/colors
5. If all good, consider PR to main for PROD deployment

---

## Reference

- Plan: `/docs/features/labels-tones-alignment/plan.md`
- Dev Notes: User provided in initial message
- Previous Handoffs:
  - `/docs/handoffs/2026-01-18-ado-270-stories-tone-system.md`
  - `/docs/handoffs/2026-01-16-ado-269-pardons-phase2.md`

# EO Pipeline Fix Plan (ADO-271 Addendum)

**Date:** 2026-01-18
**ADO:** 271
**Status:** ✅ COMPLETED (2026-01-19)

---

## Problem Statement

The EO enrichment pipeline is broken. The new tone system code exists but never executes:

1. **Tracker has OLD inline AI** - `executive-orders-tracker-supabase.js` generates `summary`, `severity_rating` etc. using an old prompt that doesn't know about `alarm_level`, variation pools, or "The Power Grab" voice.

2. **Enrichment script has no trigger** - `enrich-executive-orders.js` has the new tone system but no workflow runs it.

3. **Field gap** - New enrichment doesn't generate `summary` (the basic description), only the detailed sections.

### Current Flow (Broken)
```
Federal Register API
    → executive-orders-tracker-supabase.js
        → OLD inline AI generates: summary, severity_rating, policy_direction
        → Writes to DB
    [END - new enrichment never runs]
```

### Desired Flow (Fixed)
```
Federal Register API
    → executive-orders-tracker-supabase.js (NO AI - just import)
        → Raw data to DB
    → enrich-executive-orders.js (ALL AI here)
        → summary, alarm_level, sections, variation pools
        → Writes to DB
```

---

## Fix Plan

### Phase 1: Update Enrichment Script

**File:** `scripts/enrichment/prompts.js`

Add `summary` to `EO_ENRICHMENT_PROMPT` output JSON:
```javascript
{
  "summary": "2-3 sentence neutral summary of what this order does",
  "section_what_they_say": "...",
  // ... existing fields
}
```

**File:** `scripts/enrichment/enrich-executive-orders.js`

Update to write `summary` field:
```javascript
.update({
  summary: enrichment.summary,  // ADD THIS
  section_what_they_say: enrichment.section_what_they_say,
  // ... existing fields
})
```

### Phase 2: Strip Old AI from Tracker

**File:** `scripts/executive-orders-tracker-supabase.js`

Remove:
- `generateAIAnalysis()` function (lines ~41-125)
- OpenAI API call
- All references to AI-generated fields in the insert

Keep:
- Federal Register API fetch
- Database insert with raw data only (title, order_number, date, URLs, etc.)
- Duplicate detection logic

### Phase 3: Create Enrichment Workflow

**Option A:** Add step to existing tracker workflow

**File:** `.github/workflows/executive-orders-tracker.yml`

```yaml
- name: Enrich Executive Orders
  env:
    # ... same env vars
  run: node scripts/enrichment/enrich-executive-orders.js 50
```

**Option B:** Create separate workflow (like pardons)

**File:** `.github/workflows/enrich-eos.yml`

```yaml
name: Enrich Executive Orders (GPT)
on:
  workflow_dispatch:
  workflow_run:
    workflows: ["Track Executive Orders"]
    types: [completed]
# ... similar to enrich-pardons.yml
```

**Recommendation:** Option A is simpler. Option B provides more flexibility (can re-enrich without re-importing).

---

## Testing Plan

### Pre-Test Setup
1. Delete 2-3 test EOs from DB
2. Verify `alarm_level` column exists (migration 065)

### Test Sequence

1. **Run tracker workflow**
   ```bash
   gh workflow run "Test Environment - Executive Orders" --ref test
   ```
   - Verify: EOs imported with raw data only
   - Verify: `summary` is NULL, `alarm_level` is NULL

2. **Run enrichment** (manual or via workflow)
   ```bash
   node scripts/enrichment/enrich-executive-orders.js 5
   ```
   - Verify: `summary` populated
   - Verify: `alarm_level` is 0-5 numeric
   - Verify: `section_what_they_say` etc. populated
   - Verify: Variation injection working (check logs)

3. **Check frontend**
   - https://test--trumpytracker.netlify.app/executive-orders.html
   - Verify: Correct labels from tone-system.json
   - Verify: Correct colors (red/orange/yellow/blue/cyan/green)

### Regression Check
- Stories pipeline still works (RSS tracker → enrichment)
- Pardons pipeline still works (research → enrich)

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/enrichment/prompts.js` | Add `summary` to EO prompt output |
| `scripts/enrichment/enrich-executive-orders.js` | Write `summary` field |
| `scripts/executive-orders-tracker-supabase.js` | Remove AI, import raw only |
| `.github/workflows/executive-orders-tracker.yml` | Add enrichment step OR create new workflow |

---

## Acceptance Criteria

- [x] EO tracker imports raw data without AI call
- [x] EO enrichment generates `summary` + all tone system fields
- [x] Workflow triggers enrichment after import
- [ ] Frontend displays correct labels/colors from tone-system.json (needs verification)
- [ ] No regression in Stories or Pardons pipelines (needs verification)

---

## Related

- **ADO-271:** Original story for EO tone system alignment
- **Plan:** `docs/features/labels-tones-alignment/plan.md`
- **Handoff:** `docs/handoffs/2026-01-18-ado-271-272-eos-scotus-tone-system.md`

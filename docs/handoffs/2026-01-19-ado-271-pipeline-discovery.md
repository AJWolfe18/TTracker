# Handoff: ADO-271 Pipeline Issue Discovery

**Date:** 2026-01-19
**Branch:** test
**Commits:** ef2aa68, 018e295, 579a739

---

## Summary

Discovered that the EO enrichment pipeline is broken. The new tone system code exists but never executes because the tracker has its own old AI and there's no workflow to run the new enrichment.

---

## What Was Done This Session

1. **Fixed ADO-269 (Pardons)** - Committed perplexity-research.js v1.5
   - Changed corruption_level validation from 1-5 to 0-5
   - Added string→number coercion (Perplexity sometimes returns "0" as string)
   - Added secondary_connection_types, partial dates, money validation

2. **Documented ADO-271 Pipeline Issue**
   - Created `docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md`
   - Updated main `plan.md` with current status
   - Updated ADO-271 to Active state with new description

3. **Verified Pipeline Status**
   - Stories: ✅ Properly wired (rss-tracker → enrich-stories-inline.js)
   - Pardons: ✅ Fixed (research + enrich workflows exist)
   - EOs: ❌ Broken (tracker has old AI, enrichment never runs)
   - SCOTUS: ✅ Code done (no frontend)

---

## ADO Status

| ADO | State | Status |
|-----|-------|--------|
| 269 | Resolved | ✅ perplexity v1.5 committed |
| 270 | Testing | 🧪 Needs end-to-end test |
| 271 | **Active** | ⚠️ Pipeline fix needed |
| 272 | New | ✅ Code done, no frontend |

---

## Next Session Prompt

```
Continue ADO-271 EO pipeline fix.

Read the plan: docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md

The issue: EO tracker has old inline AI that generates `summary`. New enrichment script has tone system but no workflow runs it, and it doesn't generate `summary`.

Fix needed:
1. Add `summary` to EO_ENRICHMENT_PROMPT output in prompts.js
2. Update enrich-executive-orders.js to write `summary` field
3. Strip old AI from executive-orders-tracker-supabase.js (just import raw data)
4. Add enrichment step to workflow OR create enrich-eos.yml

After fix, test all three pipelines:
- Stories: gh workflow run "RSS Tracker - TEST" --ref test
- EOs: gh workflow run "Test Environment - Executive Orders" --ref test + enrichment
- Pardons: gh workflow run "Enrich Pardons (GPT)" --ref test
```

---

## Files Changed

```
scripts/enrichment/perplexity-research.js  (committed - v1.5)
docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md  (new)
docs/features/labels-tones-alignment/plan.md  (updated status)
```

---

## Reference

- Main plan: `docs/features/labels-tones-alignment/plan.md`
- EO fix plan: `docs/features/labels-tones-alignment/eo-pipeline-fix-plan.md`
- ADO-271: https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/271

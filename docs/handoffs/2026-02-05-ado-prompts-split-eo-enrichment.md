# Handoff: prompts.js Split + EO Enrichment PROD Deploy

**Date:** 2026-02-05
**ADO:** Related to ADO-271, ADO-273, ADO-282

## What Changed

### 1. prompts.js Split (test branch)

**Before:** Single monolithic `scripts/enrichment/prompts.js` with Stories, EOs, and Pardons prompts coupled together.

**After:** Per-feature prompt files following SCOTUS pattern:

```
scripts/enrichment/
├── prompts.js              # Barrel re-export shim (backwards compat)
└── prompts/
    ├── stories.js          # SYSTEM_PROMPT, ENHANCED_SYSTEM_PROMPT, buildUserPayload
    ├── executive-orders.js # EO_ENRICHMENT_PROMPT, buildEOPayload
    └── pardons.js          # PARDONS_ENRICHMENT_PROMPT, buildPardonPayload
```

**Importers updated (all 4):**

| File | Old Import | New Import |
|------|------------|------------|
| `enrich-executive-orders.js` | `./prompts.js` | `./prompts/executive-orders.js` |
| `enrich-stories-inline.js` | `./prompts.js` | `./prompts/stories.js` |
| `job-queue-worker.js` | `./enrichment/prompts.js` | `./enrichment/prompts/stories.js` |
| `test-eo-prompt.js` | `./enrichment/prompts.js` | `./enrichment/prompts/executive-orders.js` |

**Barrel shim preserved** for any other code still importing from `prompts.js` - re-exports all symbols from the 3 new files.

### 2. EO Enrichment Deployed to PROD (main branch)

**PRs merged:**
- PR #70: Add EO enrichment Phase 2 to PROD workflow
- PR #71: Hotfix - add missing `style-patterns-core.js`
- PR #72: Fix batch count validation (pending merge)

**Files added to main:**
- `scripts/enrichment/prompts/executive-orders.js`
- `scripts/enrichment/eo-style-patterns.js`
- `scripts/shared/style-patterns-core.js`

**Workflow updated:**
- `.github/workflows/executive-orders-tracker.yml` now has Phase 2 enrichment step
- Concurrency block added (`eo-tracker` group)

**PROD schema change:**
- Added `enrichment_meta JSONB` column to `executive_orders` table

### 3. Results

- 41 PROD EOs enriched successfully
- Cost: $0.036
- All `enriched_at = NULL` rows now populated

## Pattern for Future Prompt Splits

When adding/modifying prompts for a feature:

1. **Create dedicated file:** `scripts/enrichment/prompts/<feature>.js`
2. **Export named constants:** `<FEATURE>_PROMPT`, `build<Feature>Payload`
3. **Each file gets its own:** `const CURRENT_YEAR = new Date().getUTCFullYear()`
4. **Update importer** to use direct path (not barrel)
5. **Keep barrel shim** updated if other code might still use old path

**Existing pattern to follow:** `scripts/scotus/scotus-gpt-prompt.js`

## Impact on Inflight Work

### Pardons (ADO-246, etc.)
- `scripts/enrichment/prompts/pardons.js` exists on test
- `enrich-pardons.js` should update import to `./prompts/pardons.js`
- Can deploy pardons enrichment independently now

### Stories
- `scripts/enrichment/prompts/stories.js` exists on test
- Both `enrich-stories-inline.js` and `job-queue-worker.js` already updated
- No action needed unless modifying story prompts

## Files to Reference

- Plan: `C:\Users\Josh\.claude\plans\snoopy-sparking-moth.md`
- Test commit: `f8d321b` (prompts split)
- Main commits: PR #70, #71, #72

## Next Session

- Merge PR #72 (batch count fix)
- Update any architecture docs that reference `prompts.js` as single file
- Consider updating `enrich-pardons.js` import path when touching pardons

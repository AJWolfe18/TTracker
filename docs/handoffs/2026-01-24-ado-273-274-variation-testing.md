# Handoff: ADO-273/274 Variation System Testing

**Date:** 2026-01-24
**Branch:** test
**Commit:** 75932b0

## Summary

Executed testing plan for tone/variation systems with feedback-driven improvements. Both EO and Stories variation systems validated successfully.

## Test Results

| Phase | ADO | Result | Details |
|-------|-----|--------|---------|
| Phase 1 | ADO-273 (EO Variation) | **PASS** | 5/5 enriched, unique patterns, prompt_version=v4-ado273 |
| Phase 2 | ADO-274 (Stories Variation) | **PASS** | 5/5 enriched, severity fix applied, unique patterns |

## Fixes Applied During Testing

### 1. Preflight Script (NEW)
- `scripts/preflight-test-env.js` - Verifies TEST environment before enrichment
- Uses `base64url` for JWT decode (not base64) per feedback
- Checks URL contains TEST project ref

### 2. EO Enrichment Script
- Fixed env var validation to match fallback logic (SUPABASE_TEST_* || SUPABASE_*)
- Added `RUN_START` timestamp logging for deterministic verification
- Added hard-fail gate: exits non-zero if successCount !== batchSize
- Added collision flag logging when pattern pool exhausted

### 3. Stories Test Script
- Added `RUN_START` timestamp logging
- Added hard-fail gate if insufficient cooldown-eligible stories
- Added hard-fail gate if successCount !== limit at end

### 4. Severity Constraint Fix (CRITICAL)
- **File:** `scripts/enrichment/stories-style-patterns.js`
- **Issue:** `alarmLevelToLegacySeverity()` returned `high/medium/low` but DB constraint expects `severe/moderate/minor`
- **Fix:** Updated function to return correct DB enum values

## ADO Status

| Ticket | State | Notes |
|--------|-------|-------|
| ADO-273 | **Ready for Prod** | EO variation validated, ready for PROD deployment |
| ADO-274 | Testing | Stories variation validated BUT has PROD blocker |
| ADO-276 | New | Pardons variation not yet implemented |

## PROD Blockers (Must Fix Before ADO-274 "Ready for Prod")

### 1. Add `enrichment_meta` JSONB to Stories Table

```sql
ALTER TABLE stories ADD COLUMN enrichment_meta JSONB;
-- Store: { prompt_version, frame, style_pattern_id, collision, model, enriched_at }
```

**Why required:**
- Cannot prove which system produced which output
- Cannot diagnose why summaries might repeat
- Cannot selectively backfill/rollback specific patterns
- Cannot audit regressions when patterns change

### 2. (Optional but Recommended) Add `enrichment_meta` to EOs Too

Per feedback, add the same JSONB column to `executive_orders` for consistency. Pattern debugging will hit EOs just as often as Stories.

## Files Changed

```
scripts/preflight-test-env.js          (NEW)
scripts/enrichment/enrich-executive-orders.js
scripts/enrichment/stories-style-patterns.js
scripts/test-spicy-prompts.js
```

## Next Steps

1. **Create migration** for `enrichment_meta` JSONB column on stories (and optionally EOs)
2. **Update enrichment scripts** to populate enrichment_meta
3. **Mark ADO-274 "Ready for Prod"** after migration applied
4. **Implement ADO-276** (Pardons variation) using same architecture

## Test Artifacts

- `eo-test-output.log` - EO enrichment test output
- `stories-test-output.log` - Stories enrichment test output

## Validation Commands

```bash
# Run preflight check
node scripts/preflight-test-env.js

# Test EO enrichment (5 items)
node scripts/enrichment/enrich-executive-orders.js 5

# Test Stories enrichment (5 items)
node scripts/test-spicy-prompts.js --limit=5
```

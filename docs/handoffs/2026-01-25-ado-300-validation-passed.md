# 2026-01-25: ADO-300 Validation Passed

**ADO-300** at Testing. Validation complete, ready for final SQL check then Ready for Prod.

## What Happened
- Applied stage_mismatch fix (commit `3ed7fbd`) - clampable issues no longer burn retry ladder
- Ran 25-case validation test
- **Sidestepping at 21%** (target 15-25%, was 57%) - PASSED

## Results
- 19 successful (16 high, 3 medium confidence)
- 5 skipped (low confidence - mostly "too many quotes")
- 1 failed (Pass 2 validation error)
- 4 cases correctly clamped (1 cert_no_merits, 3 procedural_no_merits)
- Cost: $0.14

## Commits on test branch
```
3ed7fbd fix(scotus): treat stage_mismatch as clampable, not fatal
d96f223 fix(scotus): gpt-5-mini compatibility + clamp detection fix
3fac9b1 fix(scotus): use gpt-5-mini as primary
b0157b1 feat(scotus): ADO-300 clamp/retry/publish override
```

## Tomorrow
1. Run SQL to verify overall Sidestepping rate across all enriched cases:
   ```sql
   SELECT ruling_label, COUNT(*) ct,
          ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) pct
   FROM scotus_cases WHERE enrichment_status = 'enriched'
   GROUP BY ruling_label ORDER BY ct DESC;
   ```
2. If still in target range → Move ADO-300 to Ready for Prod
3. Cherry-pick commits to main, apply migration 072 to PROD
4. ADO-295 (backfill system) is separate follow-up

## Note: gpt-5-mini Reliability
Many "Empty GPT response" errors requiring fallback to gpt-4o-mini. Not blocking, but worth monitoring.

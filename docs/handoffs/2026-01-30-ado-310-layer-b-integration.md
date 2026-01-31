# Handoff: ADO-310 Layer B Integration

**Date:** 2026-01-30
**ADO:** 310 (moved to Resolved)
**Commit:** e9bdfd7

## What Was Done

Integrated Layer B LLM QA module into `scripts/scotus/enrich-scotus.js`. The integration adds:

- **LAYER_B_MODE** env var: `off` (default) | `shadow` | `enforce`
- **LAYER_B_RETRY** env var: When true and mode=enforce, retry Pass 2 on fixable Layer B REJECT

Flow:
1. Layer A runs deterministic validators
2. If Layer A REJECT + not fixable → skip Layer B (save cost)
3. If Layer A passes → run Layer B if mode != 'off'
4. Merge verdicts with `computeFinalVerdict()`
5. If Layer B REJECT + fixable + retry enabled → retry with combined directives
6. Write all Layer B columns to DB (always, even in shadow mode)

## Files Changed

- `scripts/scotus/enrich-scotus.js` - Main integration

## Testing Done

- All 68 Layer B unit tests pass
- Dry-run verified with all mode combinations
- No syntax errors

## Next Steps

1. Run enrichment with `LAYER_B_MODE=shadow` on a batch of cases to validate
2. Review Layer B verdicts in database (`qa_layer_b_verdict`, `qa_layer_b_issues`)
3. If results look good, switch to `LAYER_B_MODE=enforce` for production

## Test Command

```bash
LAYER_B_MODE=shadow node scripts/scotus/enrich-scotus.js --limit=5
```

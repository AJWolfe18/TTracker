# TTRC-315: Tiered Guardrail Implementation - COMPLETE

**Date:** 2025-12-18
**Status:** Complete, deployed to test
**Branch:** test
**Commits:** fec597e, 877c119

---

## High-Level Summary

**Problem:** Articles about the same event (0.87-0.90 embedding similarity) weren't clustering. Only 2% of stories had multiple articles. Example: 3 Venezuela oil tanker articles ended up in 3 separate stories.

**Root Cause:** TTRC-311 guardrail required "concrete reasons" (entity overlap, title match, exact slug) but these failed for semantically similar articles with different phrasing.

**Solution:** Tiered guardrail with stemmer-based slug token similarity:
- 0.90+ embedding auto-passes
- 0.85+ embedding with slug token overlap passes
- Porter stemmer canonicalizes verbs (SEIZED/SEIZURE/SEIZES → SEIZE)
- High-signal event filter (ORDER/SIGN/BAN excluded)
- Anchor token requirement (must have non-event overlap like TANKER)

---

## What Was Implemented

### New Code in `scripts/rss/scoring.js`
- `EVENT_STEM_TO_ROOT` - stem → canonical verb mapping
- `HIGH_SIGNAL_EVENTS` - verbs that qualify as event overlap
- `STOP_TOKENS` / `SKIP_TOKENS` - filter generic terms
- `TIERED_GUARDRAIL` - config with env var overrides
- `singularizeToken()` - conservative plural handling
- `canonicalizeEventToken()` - Porter stemmer + allowlist
- `normalizeSlugTokens()` - full token pipeline
- `slugTokenSimilarity()` - main similarity function

### Updated `scripts/rss/hybrid-clustering.js`
- Import new functions from scoring.js
- Tiered guardrail logic with feature flag
- Merge reason logging (behind env var)

---

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `ENABLE_TIERED_GUARDRAIL` | `true` | Set `false` to disable |
| `VERY_HIGH_EMBEDDING` | `0.90` | Auto-pass threshold |
| `TOKEN_OVERLAP_EMBED_MIN` | `0.85` | Min for slug-token |
| `LOG_CLUSTER_GUARDRAIL` | `false` | Verbose logging |

---

## Validation Results

```
Venezuela Oil Tanker tests: 3/3 pass
Generic verb blocking (ORDER/SIGN): 2/2 pass
High-signal events (CONFIRM/INDICT): 2/2 pass
Anchor requirement: 1/1 pass

Total: 8/8 pass
QA smoke tests: All pass
```

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/rss/scoring.js` | +160 lines (stemmer, token similarity) |
| `scripts/rss/hybrid-clustering.js` | +46 lines (tiered guardrail) |
| `scripts/test-ttrc315.mjs` | New validation test script |
| `docs/plans/ttrc-315-clustering-guardrail-fix.md` | Plan document |

---

## Pending

- **JIRA ticket:** Create TTRC-315 manually (MCP timed out)
  - Type: Story, Parent: TTRC-225
  - Summary: "Fix clustering guardrail with stemmer-based slug token similarity"

---

## Next Steps

1. **Monitor next RSS run** - Check if multi-article story rate improves from 2%
2. **Review merge reasons** - Set `LOG_CLUSTER_GUARDRAIL=true` temporarily to see why articles cluster
3. **Optional recluster** - If results look good, recluster last 7 days (separate ticket)

---

## Rollback

If false positives emerge:
```bash
# Disable tiered guardrail instantly
ENABLE_TIERED_GUARDRAIL=false
```

No code change needed - feature flag reverts to original TTRC-311 logic.

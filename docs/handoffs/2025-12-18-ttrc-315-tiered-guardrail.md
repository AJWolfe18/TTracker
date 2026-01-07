# TTRC-315: Tiered Guardrail Implementation Complete

**Date:** 2025-12-18
**Status:** Implemented, pushed to test, awaiting AI code review
**Branch:** test
**Commit:** fec597e

---

## Session Summary

| Task | Status |
|------|--------|
| Plan review with expert dev feedback | Done |
| Stemmer-based token canonicalization | Done |
| Slug token similarity function | Done |
| Tiered guardrail logic | Done |
| Validation tests (8/8 pass) | Done |
| QA smoke tests | Pass |
| Commit & push | Done |
| AI code review | In progress |
| JIRA ticket | Manual creation needed (MCP timeout) |

---

## What Was Implemented

### Problem Solved
Articles with 0.87-0.90 embedding similarity weren't clustering (only 2% multi-article rate). Example: Venezuela oil tanker articles ended up in 3 separate stories despite 0.90 embedding similarity.

### Solution
Tiered guardrail with stemmer-based slug token similarity:

1. **Tiered embedding thresholds:**
   - `>= 0.90` embedding: Auto-pass (very high = concrete enough)
   - `>= 0.85` embedding + slug token overlap: Valid reason

2. **Porter stemmer + allowlist:**
   - `EVENT_STEM_TO_ROOT` maps stems to canonical forms
   - Handles all conjugations: SEIZE/SEIZED/SEIZURE/SEIZING → SEIZE

3. **High-signal event filter:**
   - `HIGH_SIGNAL_EVENTS` excludes generic verbs (ORDER, SIGN, BAN)
   - Only SEIZE, INDICT, ARREST, etc. qualify as "event overlap"

4. **Anchor token requirement:**
   - Must have non-event overlap (e.g., TANKER, HEGSETH)
   - Prevents merges on event tokens alone

5. **Safety features:**
   - `ENABLE_TIERED_GUARDRAIL=false` reverts to original logic
   - `LOG_CLUSTER_GUARDRAIL=true` enables verbose logging

---

## Files Modified

| File | Changes |
|------|---------|
| `scripts/rss/scoring.js` | +160 lines: stemmer, constants, `slugTokenSimilarity()` |
| `scripts/rss/hybrid-clustering.js` | +46 lines: tiered guardrail logic |
| `scripts/test-ttrc315.mjs` | New: 8 validation test cases |
| `docs/plans/ttrc-315-clustering-guardrail-fix.md` | Plan document |

---

## Validation Results

```
=== TTRC-315 Slug Token Similarity Dry-Run ===

✅ Venezuela Oil Tanker - Same event, different phrasing
✅ Venezuela Oil Tanker - Alternative phrasing
✅ Venezuela - All three slugs should match
✅ Generic ORDER - Should NOT pass (low-signal event)
✅ Generic SIGN - Should NOT pass (low-signal event)
✅ Hegseth confirmation - Should pass
✅ Indict - Should pass
✅ Only event overlap, no anchor - Should NOT pass

Passed: 8/8
```

---

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `ENABLE_TIERED_GUARDRAIL` | `true` | Set `false` to disable |
| `VERY_HIGH_EMBEDDING` | `0.90` | Auto-pass threshold |
| `TOKEN_OVERLAP_EMBED_MIN` | `0.85` | Min for slug-token |
| `LOG_CLUSTER_GUARDRAIL` | `false` | Verbose logging |

---

## Next Steps

1. **Check AI code review:** https://github.com/AJWolfe18/TTracker/actions/runs/20357800099
2. **Create JIRA ticket manually:** TTRC-315 (Story, parent TTRC-225)
3. **Monitor clustering:** Run RSS tracker and check multi-article rate
4. **Optional recluster:** If results look good, recluster last 7 days

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Porter stemmer + allowlist | Covers all conjugations without mangling proper nouns |
| HIGH_SIGNAL_EVENTS filter | ORDER/SIGN/BAN too generic, would merge unrelated stories |
| Anchor token requirement | Prevents merges on event tokens alone |
| Pipeline order: singularize before stop filter | HOUSES → HOUSE → caught by STOP_TOKENS |
| Logging off by default | Would be very verbose in production |

---

## Risk Mitigations

1. **False positives:** Anchor requirement + high-signal filter + high embedding threshold
2. **Rollback:** `ENABLE_TIERED_GUARDRAIL=false` instantly reverts
3. **Tuning:** All thresholds are env-configurable
4. **Analysis:** Merge reason logging available via env var

---

## Token Usage

Session consumed approximately 35K tokens.

# 2026-01-25: ADO-303 Phase 0 Pass 1 Fixes

**ADO-303** in Testing. All 4 recommended fixes implemented.

## Commits
```
08e34ca feat(ado-303): implement Phase 0 Pass 1 fixes
871b91f feat(ado-303): cert skip + quote truncation
a794cf1 feat(ado-303): add party repair + opener fixer post-gen
```

## What Was Implemented

### Phase 0 (Original)
| Feature | Description |
|---------|-------------|
| Model config | gpt-4o-mini only (removed gpt-5-mini fallback) |
| Generic party lint | Bans standalone "petitioner"/"respondent" |
| Publish gate | Rule-based checks before publishing |
| Retry logic | Up to 2 retries on empty/issues |

### Phase 0.1 (This Session)
| # | Feature | Description |
|---|---------|-------------|
| 1 | **Cert skip** | Skip cert grants/denials BEFORE Pass 1 (saves cost) |
| 2 | **Quote truncation** | Truncate+telemetry instead of hard fail |
| 3 | **Party repair** | Expands "petitioner" → "the petitioner (Smith)" from case caption |
| 4 | **Opener fixer** | Deterministic rewrite of "In a..." → varied openers (no LLM call) |

## Validation Results

### Before All Fixes
- Pass rate: ~30% (quote issues, cert confusion, repetitive openers)
- "In a..." openers: 67%
- Generic parties: common

### After All Fixes
- Pass rate: **100%** (3/3 in latest batch)
- "In a..." openers: **0%** (deterministically fixed)
- Generic parties: **0%** (deterministically expanded)

## Example Opener Transformations

| Before | After |
|--------|-------|
| "In a move that has effectively reversed..." | "Your rights to a fair hearing just took a hit." |
| "In a decision that was, unsurprisingly..." | "The Court's unanimous ruling affirms that..." |
| "In a stunning act of judicial overreach..." | "The Court affirmed that when a plaintiff..." |

## Files Changed

- `scripts/scotus/enrich-scotus.js`
  - Cert detection (`detectCertCase`)
  - Party repair (`splitCaseCaption`, `repairGenericParty`, `applyPartyRepair`)
  - Opener fixer (`rewriteInAOpener`)
  - Quote telemetry in publish gate
- `scripts/enrichment/scotus-fact-extraction.js`
  - Quote truncation (mutate + telemetry)

## Next Steps

1. Run 10-20 case batch to verify quality at scale
2. Review published cases on test site
3. If passing, move ADO-303 to Ready for Prod

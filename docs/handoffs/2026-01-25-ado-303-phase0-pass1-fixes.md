# 2026-01-25: ADO-303 Phase 0 Pass 1 Fixes

**ADO-303** in Testing. Phase 0.1 improvements deployed.

## Commits
```
08e34ca feat(ado-303): implement Phase 0 Pass 1 fixes
[pending] feat(ado-303): cert skip + quote truncation
```

## What Was Implemented

### Phase 0 (Original)
| Feature | Description |
|---------|-------------|
| Model config | gpt-4o-mini only (removed gpt-5-mini fallback) |
| Quote lint | Max 2 quotes, max 25 words each |
| Generic party lint | Bans standalone "petitioner"/"respondent" |
| Publish gate | Rule-based checks before publishing |
| Retry logic | Up to 2 retries on empty/issues |

### Phase 0.1 (This Session)
| Feature | Description |
|---------|-------------|
| Cert skip | Skip cert grants/denials BEFORE Pass 1 (saves cost) |
| Quote truncation | Truncate+telemetry instead of hard fail |

## Validation Results

### Before Phase 0.1
- Pass rate: ~45% (quote issues blocked 50% of cases)
- Cost: Cert cases went through full pipeline

### After Phase 0.1
- Pass rate: **86%** (6/7 in test batch)
- Auto-published: 4
- Needs review: 2 (soft drift)
- Cert cases: Skipped early, no GPT cost

## Files Changed

- `scripts/scotus/enrich-scotus.js` - Cert detection, quote telemetry
- `scripts/enrichment/scotus-fact-extraction.js` - Quote truncation

## Next Steps

1. Commit and push to test
2. Run 20-case batch to verify quality
3. If passing, move ADO-303 to Ready for Prod

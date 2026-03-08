# ADO-438: SCOTUS Unified Agent Plan

## Architecture: API Facts + GPT Editorial

```
Oyez/CourtListener API  →  Structured facts (FREE, deterministic)
SCOTUSblog scraper       →  Expert analysis context (FREE, already working)
GPT-4o Batch API         →  Editorial content only + self-verification (~$0.025/case)
Severity bounds          →  Deterministic rules on API facts (proven)
```

### Why This Approach
Stop asking GPT to extract facts that databases already solved. Use GPT only for editorial writing (what it's good at). Use APIs for facts (what they're good at).

### What Gets Deleted (~1,700 lines)
- `scotus-drift-validation.js` (265 lines)
- `scotus-qa-validators.js` (337 lines)
- `scotus-qa-layer-b.js` (954 lines)
- `qa-issue-types.js` (121 lines)
- ~400 lines QA retry loop / drift handling from `enrich-scotus.js`

### What Gets Kept
- `computeSeverityBounds()` — deterministic guardrail
- SCOTUSblog scraper — unchanged
- DB helpers, source text, style/variation pools
- Level-to-label mapping
- `backfill-dissents.js` — fallback when API data unavailable

### Implementation Sessions
1. Oyez API integration + unified prompt builder
2. Gold set validation (10 cases) + Josh review
3. Cutover + run 108 unenriched + delete old validators

### Cost
- Current: ~$0.05/case
- Proposed: ~$0.015/case (70% savings)

### Reusability
- Pardons: DOJ data + Perplexity + GPT editorial (same pattern)
- News: Not suitable (volume too high, current approach is cost-appropriate)

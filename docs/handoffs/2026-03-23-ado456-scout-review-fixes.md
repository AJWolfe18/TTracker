# ADO-456: Scout Dry Run — Review Fixes Merged (Mar 23)

Merged Scout branch (`claude/build-scotus-scout-av4kg`) into test, ran code review, fixed all findings, pushed. Branch deleted. 86/86 unit tests pass. ADO board cleaned up (10 items closed, 3 Scout cards created under Feature 455).

## Next Session: Finish ADO-456 Dry Run

Run the Scout against real cases with Perplexity API key. Estimated cost: ~$0.15 total.

```bash
# Step 1: 6 known-bad cases (~$0.03)
node scripts/enrichment/scotus-scout.js --dry-run --ids=51,64,137,285,224,131

# Step 2: Full gold set (~$0.13)
node scripts/enrichment/scotus-scout.js --dry-run --gold-set --output-json=scout-gold-results.json
```

### AC checklist (from ADO-456):
- [ ] 100% correct disposition on 6 known-bad cases
- [ ] >=95% JSON parse success on 25-case batch
- [ ] 0 invalid enum writes
- [ ] 0 writes when status != ok
- [ ] 100% source capture on every response
- [ ] Dry-run cost < $0.15
- [ ] perplexity-research.js pardon path verified (DONE - imports clean)
- [ ] All code review findings addressed (DONE - committed 84a2667)

### If dry run passes:
1. ADO-456 -> Testing
2. Start ADO-457 (Scout Live Run — field comparison + live writes)
3. After 457: deploy 429+438+446+455 together to PROD
4. Then ADO-440 bulk enrichment (108 unenriched cases)

## ADO Changes This Session
- **Closed (10):** 306, 324, 350, 285, 316, 323, 390, 310, 313, 326
- **Created:** 455 (Scout Feature), 456 (Dry Run, Active), 457 (Live Run, New)
- **Reparented:** 325 (Gold Set) moved under 392

## Key Files
- `scripts/enrichment/scotus-scout.js` — main CLI (budget guard, caching, cost warning added)
- `scripts/scotus/scout-parser.js` — JSON parse + normalization
- `scripts/scotus/scout-validator.js` — deterministic validation
- `scripts/scotus/scout-prompt.js` — Perplexity prompt builder
- `scripts/enrichment/perplexity-client.js` — shared API client
- `tests/scotus-scout-unit.test.js` — 86 unit tests

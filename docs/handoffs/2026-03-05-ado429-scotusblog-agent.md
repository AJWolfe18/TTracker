# 2026-03-05 — ADO-429: SCOTUSblog Grounding Agent (Testing)

## What Happened
ADO-429 implemented and pushed to test. Built SCOTUSblog scraper that searches WP REST API for case pages and opinion analysis posts. Enrichment pipeline now injects SCOTUSblog context into Pass 2 prompt and uses GPT-4o (instead of mini) when grounding is available.

Gold set scraper test: 9/10 case pages found, 8/10 with structured data (vote/author), 6/10 with analysis text.

Also fixed who_wins/who_loses validation regex (standalone "limits" no longer triggers false positive).

## Files Changed
- **New:** `scripts/scotus/scotusblog-scraper.js` — SCOTUSblog WP API search + scrape
- **Modified:** `scripts/enrichment/scotus-gpt-prompt.js` — context injection, v6-ado429 prompt version, regex fix
- **Modified:** `scripts/scotus/enrich-scotus.js` — SCOTUSblog fetch, GPT-4o model, cost calc, telemetry

## Code Review Findings (fix before PROD)
1. **JSDOM memory leak** — `fetchCaseFilePage` and `fetchAnalysisPost` need try/finally around DOM ops (partially started, not committed)
2. **Misleading comment** on PASS2_MODEL line 141 of enrich-scotus.js — says "falls back to mini if env var set" but logic is opposite
3. **Layer B cost calc** (pre-existing) — line 1241 doesn't pass model param, undercounts if Layer B uses gpt-4o

## Next Session
1. Fix the 2 code review items (JSDOM try/finally, comment) — quick commit
2. Update ADO-429 to Testing (was interrupted)
3. Run `node scripts/scotus/enrich-scotus.js --force-gold --case-ids=286,51,192,4,64,120,133,68,63,109` to enrich gold cases with new agent
4. Run eval, pull gold case output for Josh review
5. If gold set passes: ADO-429 → Ready for Prod

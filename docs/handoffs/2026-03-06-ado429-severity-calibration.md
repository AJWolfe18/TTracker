# 2026-03-06 — ADO-429: Severity Calibration Attempt

## What Happened
Fixed 2 code review items (JSDOM try/finally, PASS2_MODEL comment) and pushed to test. Ran gold case enrichment with v6 prompt — SCOTUSblog grounding works (7/9 found), but severity is still wrong on 4/10 cases. Attempted dynamic severity ceiling in user prompt (v7) — hard caps worked for people-win/procedural cases but **regressed TikTok** (correct 4 → wrong 3) and clamp system overrode Lackey ceiling. Reverted v7 changes.

## Gold Set Eval Summary (v6 prompt, current on test)

| Case | Expected | Got | Status |
|------|----------|-----|--------|
| Barrett (#286) | 0-1 | 3 | FAIL (too high, also ungrounded) |
| Kirtz (#51) | 0-1 | 1 | PASS |
| Soto (#192) | 0-1 | 1 | PASS |
| Connelly (#4) | 2-3 | 3 | PASS |
| Royal Canin (#64) | 1-2 | 3 | FAIL (too high, ungrounded) |
| Bufkin (#120) | 3-4 | FAILED | FAIL (validation error) |
| Miller (#133) | 3-4 | 3 | PASS |
| TikTok (#68) | 4-5 | 4 | PASS |
| Trump (#63) | 4-5 | 3 | FAIL (too low) |
| Lackey (#109) | 2-3 | 4 | FAIL (model gave 3, clamp overrode to 4) |

**Score: 5/10 pass, 4 wrong level, 1 failed enrichment**

## Why Simple Fixes Don't Work
Three systems are fighting each other on severity:
1. **Prompt rules** (system prompt) — model ignores them when buried in long context
2. **User prompt ceiling** (attempted) — hard caps work but soft guidance causes regressions
3. **Clamp system** (post-enrichment) — overrides model decisions, fought the ceiling on Lackey

Josh wants a **holistic, dedicated session** to sort this out (possibly ADO-428 reopened or new card). Need to understand the full clamp → ceiling → prompt → validation pipeline end-to-end before making changes.

## Next Session
1. Read this handoff + `scripts/scotus/gold-set.json`
2. Map the full severity pipeline: prompt rules → model output → clamp → validation → write
3. Identify which system should "own" severity decisions
4. Fix holistically — don't patch one system without understanding the others
5. Re-run gold set, verify 10/10 pass

## Files on Test (committed + pushed)
- `scripts/scotus/scotusblog-scraper.js` — JSDOM try/finally fix
- `scripts/scotus/enrich-scotus.js` — PASS2_MODEL comment fix

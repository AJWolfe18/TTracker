# 2026-03-03 — ADO-394: Gold Set Review Prepared, Awaiting Josh's Decisions

## What Happened
No code changes. Pulled full enrichment output for all 10 gold cases and prepared a structured review for Josh showing: the severity scale definitions, factual case summaries, what GPT wrote, and where GPT is wrong. Josh needs to make 7 decisions before code work can continue.

## Josh's 7 Decisions Needed

1. **Barrett (286):** Expected [0-1], GPT said 3. 9-0 people-win. Keep [0-1] or widen?
2. **Kirtz (51):** Expected [0-1], GPT said 4. 9-0 people-win labeled "Tyranny" (backwards). Keep [0-1]?
3. **Connelly (4):** Expected [2-3], GPT said 4. GPT got winner/loser factually wrong (says corps won, IRS actually won). Keep [2-3]?
4. **Royal Canin (64):** Expected [1-2], GPT said 3. Procedural jurisdiction remand. Keep [1-2]? Issue_area: corporate_liability or other?
5. **Lackey (109):** Expected [3-4], GPT said 5. Real harm to civil rights fee-shifting, but not a constitutional crisis. Keep [3-4]?
6. **Bufkin (120):** Severity passes [3-4]=3. Issue_area: civil_rights or healthcare?
7. **Soto (192) + Miller (133):** Confirm these pass as-is?

## Code Fixes Ready to Go (independent of Josh's decisions)
- **Case 63 (Trump v. Anderson):** Phantom dissent — enrichment fails because GPT generates dissent_highlights for a no-dissent case. Fix: stronger prompt constraint + validator fallback.
- **Case 68 (TikTok v. Garland):** Pass 1 flagged "low confidence" — per curiam opinion confuses anchor check. Fix: investigate anchor token strictness.

## After Josh Decides
1. Update `scripts/scotus/gold-set.json` with corrected expectations
2. Fix case 63 + 68 (code)
3. Re-enrich: `node scripts/scotus/enrich-scotus.js --case-ids=63,68 --skip-consensus --force-gold`
4. Re-run eval: `node scripts/evals/run-eval.js --type=scotus`
5. Export CSV: `node scripts/evals/export-gold-review.js`
6. Verify exit criteria: 0 fabricated dissent, 0 backwards who_wins/who_loses across all 10 gold cases
7. Fetch ADO-394 AC via `/ado`, verify every bullet MET/NOT MET before state change

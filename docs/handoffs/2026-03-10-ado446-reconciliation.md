# ADO-446: Reconciliation Step — Handoff (Mar 10)

ADO-446 moved to Testing. All 4 original fixes + disposition auto-correct implemented and pushed to test. Pilot batch verified (9/10 enriched, 1 pre-existing Pass 1 failure). Gold set re-enriched — blocking errors are Pass 1 disposition accuracy issues, which the new disposition auto-correct addresses.

## Next Session TODO

1. **Re-run gold set eval** to verify disposition auto-correct improved scores:
   ```
   node scripts/scotus/enrich-scotus.js --case-ids=4,51,63,64,68,109,120,133,192,286 --force-gold --skip-consensus
   node scripts/evals/run-eval.js --type=scotus
   ```
   Compare against previous: 8/10 blocking, 70% contradiction rate. Should improve.

2. **If eval passes (blocking < 5/10)**: Move ADO-446 to Ready for Prod, unblock ADO-440 bulk run.

3. **ADO-440 bulk run** (108 unenriched cases):
   ```
   node scripts/scotus/enrich-scotus.js --limit=108 --skip-consensus
   ```
   After: query `SELECT count(*) FROM scotus_cases WHERE needs_manual_review = true` for flagged cases.

4. **Gold set expansion** (separate session): Add 15-20 more gold cases across disposition types. Current 10 is too thin a sample for meaningful eval.

5. **Option D (Claude Code reviewer)**: After bulk run, Josh triggers manual review of flagged cases. Pattern: "review flagged SCOTUS cases" → I query DB, read source text, fix errors directly.

## Enrichment Quality Strategy — Discuss Tomorrow

The eval exposed a systemic problem: GPT-4o-mini gets disposition wrong ~15-20% of the time
(says "reversed" when Court actually "affirmed"). Reconciliation fixes this for cases where
SCOTUSblog data exists (~80%), but we discussed a broader strategy.

### Option B: SCOTUSblog as automated ground truth (IMPLEMENTED)
- Already built into the pipeline — runs on every enrichment automatically
- Auto-corrects disposition, vote_split, dissent, case_type from SCOTUSblog
- Zero extra cost (SCOTUSblog is scraped, not an API)
- Covers ~80% of cases. Remaining ~20% where SCOTUSblog not found get GPT as-is
- **Status: Code complete, needs eval verification**

### Option D: Claude Code as on-demand reviewer ($0 extra)
- After bulk/daily runs, Josh says "review flagged SCOTUS cases"
- Claude reads full opinion text (no windowing), SCOTUSblog data, enrichment output
- Corrects errors directly in DB via MCP, Josh sees every change
- Handles the ~20% where SCOTUSblog isn't found
- Also handles nuanced errors no regex/model catches
- **Status: No code needed — just a workflow pattern. Discuss when to use.**

### Scaling pattern: external ground truth > GPT extraction
- Same reconciliation framework works for any content type (EOs, pardons, stories)
- When a reliable structured external source exists, plug it in as the "winner"
- SCOTUSblog for SCOTUS is the first instance of this pattern
- **Discuss: what other content types have reliable external sources?**

### Gold set expansion (separate session)
- Current: 10 gold cases — too thin for meaningful eval
- Need: 25-30 cases across disposition types (affirmed, reversed, vacated, unanimous, split)
- Josh and Claude review cases together, confirm correct answers
- Makes future evals actually useful as a quality gate

## Key Files
- `docs/features/scotus-enrichment/reconciliation-rules.md` — full reference
- `scripts/scotus/enrich-scotus.js` — `reconcileWithScotusblog()` at ~line 733
- Migration 086 applied to TEST DB

## Cost
- Pilot (10 cases): $0.49
- Gold re-enrichment (10 cases): $0.40
- Eval runs: ~$0.01
- Total session: ~$0.90

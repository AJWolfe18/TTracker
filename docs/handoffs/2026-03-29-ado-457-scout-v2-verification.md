# Handoff: ADO-457 - Scout v2 Dry-Run Verification

**Date:** 2026-03-29
**Ticket:** ADO-457 (Testing)
**Branch:** `test`
**Git SHA:** 9964802

---

## What Was Done

Ran the full Scout v2 dry-run verification sequence (3 steps) against the approved plan. No code changes — verification only.

### Results Summary

| Step | Cases | Result |
|------|-------|--------|
| Step 1: Known problem cases | 7 | 5/5 non-merits correct, 2/2 merits correct (Connelly ok, Trump ok/uncertain depending on run) |
| Step 2: Gold set | 24 | 22/22 definite-merits ok, 0 false non-merits |
| Step 3: 25-case batch | 25 | 19/20 merits ok (95%), 5 non-merits triaged, case set matched locked IDs |

**Pass/fail: 7/8 hard criteria PASS, 1 partial (Trump source-tier intermittent — pre-existing v1 issue).**

### Verification Artifacts
- `v2-step1-triage-9964802.json` — 7 known problem cases
- `v2-step2-gold-9964802.json` — 24 gold set cases
- `v2-step3-batch-9964802.json` — 25 batch cases
- `v2-verification-meta.txt` — run metadata (date, SHA, node version)

### Key Findings

1. **Bowe clarified:** ID 57 (In re Bowe, 22-7871) is non-merits (original petition). ID 285 (Bowe v US, 24-5438) is the real merits case. Perplexity triage is inconsistent on ID 57 between runs — safe-direction default (merits) prevents false suppression.

2. **Trump source-tier:** Facts always correct (gold MATCH every run), but validator sometimes marks uncertain because Perplexity only cites Wikipedia. Not a v2 issue — pre-existing v1 validator conservatism.

3. **Soto author gap:** ID 192 (Soto) — gold says majority_author=Thomas, Scout returns null. Status is still ok. One field mismatch in 22 gold merits cases.

4. **Silent skip gap discovered:** During review, identified 12 places across the codebase where work is skipped with only console.log (no DB record). Created ADO-466 for admin dashboard visibility card.

---

## What's NOT Done

- **Live-write test** — need `--confirm` run on small batch to verify: rollback capture, budget tracking writes, field-level write accuracy
- **ADO-457 state** — stays in Testing until live-write AC items verified
- **ADO-466** — silent skip visibility (separate ticket, New state)

---

## Next Session

1. **Check ADO-457 AC** — live-write items remain:
   - Rollback data exists for every write
   - Budget tracked in budgets table
   - Cost < $1.50 for full run
2. **Run live-write test:** `node scripts/enrichment/scotus-scout.js --confirm --ids=4,9,51 --output-json=v2-live-test.json --write-fields=disposition,vote_split,majority_author,dissent_authors`
   - Small batch (3 known-good cases from gold set)
   - Verify rollback JSON contains pre-write values
   - Verify budgets table updated
   - Verify written fields match Scout output
3. **If live-write passes:** Advance ADO-457 to Ready for Prod
4. **Separate:** ADO-466 (silent skip visibility) is a new ticket, not blocking v2

---

## Decisions Made

- **Bowe (ID 57) is non-merits** — confirmed by checking docket type (original petition, 22-7871 range), absence of syllabus, and comparison with ID 285 (the real merits case)
- **Trump source-tier: do nothing now** — it's a v1 validator behavior, not a v2 regression. Facts are always correct; source quality varies by run. Track separately if it becomes a production issue.
- **Silent skip pattern = systemic gap** — Josh flagged that uncertain cases being silently skipped is a visibility problem. Audit found 12 instances across codebase. ADO-466 created.

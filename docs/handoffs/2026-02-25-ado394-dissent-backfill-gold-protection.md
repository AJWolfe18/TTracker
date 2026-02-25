# 2026-02-25 — ADO-394: Dissent Backfill + Gold Set Protection

## What Happened
Resolved the dissent_authors data gap that blocked 4/10 gold cases. Wrote `scripts/scotus/backfill-dissent-authors.js` to parse dissent info from raw SCOTUS opinion text (handles hyphenated line breaks like `JACK-\nSON`). Updated 68 cases on TEST DB. Re-enriched gold set: 8/10 pass, 2 persistently fail (63 Trump v. Anderson = phantom dissent from Colorado state court refs, 68 TikTok = Pass 1 anchor confidence). Implemented gold set protection: `is_gold_set` DB flag + `--force-gold` enrichment override. CSV + JSON snapshot exported for Josh's review.

## Key Files
- `scripts/scotus/backfill-dissent-authors.js` — one-time backfill (test-only-paths tracked)
- `scripts/evals/export-gold-review.js` — CSV + JSON export for gold review
- `scripts/scotus/enrich-scotus.js` — `--force-gold` flag + gold protection
- `migrations/085_scotus_gold_set_flag.sql` — `is_gold_set` column

## Gold Review CSV
At `logs/evals/gold-set-review-2026-02-25.csv` (gitignored, local only). JSON snapshot at `logs/evals/gold-set-snapshot-2026-02-25.json`.

## Waiting On
Josh to review CSV and provide corrections. Then: lock gold expectations, implement remaining hard-block validators.

## Exit Criteria Status
- D9 dissent integrity: PASSING all 6 evaluated gold cases (backfill fixed it)
- who_wins/who_loses gates: working (blocked case 109 on first attempt, passed on retry)
- 2 persistently failing cases need prompt-level fixes (future session)

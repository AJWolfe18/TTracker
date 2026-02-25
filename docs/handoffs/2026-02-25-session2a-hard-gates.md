# 2026-02-25 — Session 2A: Hard Gates for Factual Integrity (ADO-394)

## What Happened
Added 3 hard-gate validators to `validateEnrichmentResponse` in `scotus-gpt-prompt.js`: (1) dissent integrity — blocks if dissent_highlights present when dissent_exists=false, (2) who_wins/who_loses consistency — blocks contradictory language (winning words in loses field, losing words in wins field), (3) prompt constraints for dissent/quotes/winner-loser added to PASS2_SYSTEM_PROMPT. Also: gold set review CSV exported to `logs/evals/gold-set-review-2026-02-25.csv` (gitignored — local only), CLAUDE.md token usage rule removed, Session 1 eval harness committed.

## Key Results
- **Gates working:** 4/10 gold cases correctly BLOCKED (120 Bufkin, 133 Miller, 63 Trump, 109 Lackey)
- **5/10 passed enrichment** (286, 51, 192, 4, 64) — severity still inflated but no fabricated dissent
- **1/10 flagged** (68 TikTok — pre-existing Pass 1 anchor issue)
- **Root cause of blocks:** CourtListener metadata has `dissent_exists=false` and `dissent_authors=[]` for cases that DO have real dissents (Jackson in 109/120, Gorsuch in 120/133). GPT correctly detects dissent from source text but the validator blocks because DB metadata is wrong.

## Blocker: dissent_authors Backfill
The 4 blocked cases will KEEP failing until `dissent_authors` and `dissent_exists` are backfilled from opinion text. This is NOT a prompt fix — it's a data fix. Options:
1. Script to parse `=== DISSENT (Justice Name) ===` headers from `scotus_opinions.opinion_full_text` and update `scotus_cases.dissent_authors`/`dissent_exists`
2. Manual fix for the 4 gold cases only
3. Add fallback in validator: if dissent text IS present in source, allow dissent_highlights even if DB says no

**Recommendation:** Option 1 (script) for correctness, then re-enrich gold set.

## Still TODO for ADO-394
- [ ] Backfill dissent_authors from opinion text (blocker for 4 gold cases)
- [ ] Re-enrich gold set after backfill
- [ ] Verify exit criteria: 0 fabricated dissent, 0 backwards who_wins/who_loses
- [ ] Gold set protection: is_gold_set flag + raw snapshot per run
- [ ] AC verification before state transition

## Files Changed
- `scripts/enrichment/scotus-gpt-prompt.js` — prompt constraints 7/8/9 + validators in validateEnrichmentResponse
- `scripts/enrichment/scotus-fact-extraction.js` — issue_area in FACT_FIELDS, normalizeDissent(), PASS2_PROMPT_VERSION constant
- `scripts/scotus/enrich-scotus.js` — passes scotusCase to validateEnrichmentResponse opts
- `CLAUDE.md` — removed token usage rule

# 2026-03-07 — ADO-429 broader validation + ADO-438 Unified Agent plan

## What Happened
Re-enriched 20 non-gold cases with v8 severity bounds. Found root cause of severity miscalibration: CourtListener was missing `dissent_authors` for 13 cases (e.g., Vanderstok was 7-2 but treated as 9-0 → level 1 instead of 4). Built `backfill-dissents.js` to parse dissent info from opinion attribution blocks. Also fixed drift quarantine — added disposition synonym matching so "struck down" counts as "reversed". After fixes, Vanderstok correctly went from level 1 → level 4.

Still hitting whack-a-mole: 2 cases fail on who_wins/who_loses word-matching validators, case_type=unclear blocks 2 merits cases, speculative language flags catch legitimate summaries. Decision: stop patching validators and build a unified agent (ADO-438) that uses Oyez/CourtListener APIs for deterministic facts + GPT-4o for editorial only. Deletes ~1,700 lines of validator code, cuts cost 70%.

## Changes This Session
- `scripts/enrichment/scotus-drift-validation.js` — Added disposition synonym matching (reversed→struck down, etc.)
- `scripts/scotus/backfill-dissents.js` — NEW: Parses dissent authors from opinion attribution blocks
- 13 cases updated with correct dissent_authors in TEST DB
- 20+ cases re-enriched with v8 + drift fix + corrected dissents

## Next Session
- Pick up ADO-438 (New): Build unified agent with Oyez API integration
- Plan doc: `docs/features/scotus-enrichment/ado-438-unified-agent-plan.md`
- ADO-429 stays in Testing — severity calibration validated on 20+ cases, but full pipeline replacement (438) supersedes remaining 429 edge cases
- ADO-390 (unenriched cases) will be resolved by 438's cutover run on all 108 cases

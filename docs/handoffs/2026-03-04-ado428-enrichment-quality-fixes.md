# 2026-03-04 — ADO-428: Enrichment Quality Fixes (CLOSED)

## What Happened
ADO-428 closed. Three enrichment pipeline fixes from gold set review:
1. **Per curiam anchor**: `extractAnchorQuoteFromSource` now has full-text fallback for unsigned opinions. Both TikTok (68) and Trump (63) now enrich successfully — were previously failed/flagged.
2. **Phantom dissent**: `enforceEditorialConstraints` null-coerces `dissent_highlights` when `dissent_exists=false`. D9 dissent_integrity OK on all gold cases.
3. **Severity calibration**: Added constraint #6 to Pass 2 prompt. Partial success — Soto and Connelly within range, but Kirtz/Royal Canin/Lackey still over-inflated. GPT-4o-mini doesn't reliably follow prompt-only severity guidance — ADO-429 (GPT-4o agent) is the real fix.

Prompt version bumped to `v5-ado428-calibration`. Gold case snapshot saved to `docs/evals/gold-cases-snapshot-2026-03-04.csv`.

## Re-enrichment Results (10 gold cases)
- **7 enriched**, 3 failed (Barrett 286, Bufkin 120, Miller 133 — who_wins/who_loses validation regex too strict, not ADO-428 related)
- Eval: 60% contradiction rate on gold set (D6 factual accuracy — GPT-4o-mini quality, ADO-429 scope)

## Remaining Issues (not ADO-428)
- who_wins/who_loses validation regex catches contextually correct words ("limits", "setbacks") — needs loosening
- Severity over-inflation on 3/10 gold cases — prompt guidance alone insufficient for GPT-4o-mini
- 3 gold cases stuck in `failed` status — re-run after validation fix

## Next Session: ADO-429
Start ADO-429: Real SCOTUS enrichment agent with GPT-4o + SCOTUSblog grounding. This replaces blind GPT-4o-mini enrichment with fact-grounded summaries.

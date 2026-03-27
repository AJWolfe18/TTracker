# ADO-456: Scout Cross-Check Layers (Mar 26)

Built three-layer cross-check system for Scout. Targeted validation: Bondi, Riley, Barrett all MATCH. Pushed to test (a13a2cb). ADO-456 still Active — needs clean full gold-set run before moving to Testing.

## What Changed
- **Syllabus extractor**: Deterministic disposition from SCOTUS opinion text in DB. Fixes Bondi + Barrett (reversed→reversed_and_remanded).
- **Dissenter detection**: Enhanced GPT prompt for partial joiners + regex post-check anchored to dissent blocks. Fixes Riley (captures Gorsuch).
- **Oyez client**: Corroboration from structured `decisions.votes` data (older cases only — 2024/2025 term returns null).
- **Gold set**: Removed Abbott (shadow docket, not merits). 25→24 cases. Documented inclusion rule.
- **Observability**: Full counters for overrides, guardrail blocks, disagreements per cross-check layer.
- **Fixture tests**: 20 tests covering extraction, adversarial inputs, edge cases.

## Full Dry Run Status
Full gold-set run hit 19/24 — but 3 of the 5 mismatches are NOT code issues:
- **Connelly**: Perplexity returned wrong author (non-deterministic, was correct in v4)
- **SF v EPA + Horn**: OpenAI API 429 quota error — GPT dissenter cross-check couldn't run
- **Bondi + Barrett**: Were failing in v5 run due to syllabus boundary bug, now FIXED (confirmed in targeted rerun)

## Blocker
OpenAI API key hit quota limit (429 error). GPT cross-check for dissenters can't run until quota resets or billing is topped up. Check: https://platform.openai.com/usage

## Next Session
1. Check OpenAI quota — top up if needed
2. Run clean full gold-set dry run: `node scripts/enrichment/scotus-scout.js --dry-run --gold-set --skip-oyez --output-json=scout-gold-results-v6.json`
3. Verify 24/24 (or investigate any remaining mismatches)
4. If clean → ADO-456 → Testing, start ADO-457 (live run)

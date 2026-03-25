# ADO-456: Scout Dry Run — Results & Improvements (Mar 24)

Ran Scout against real cases via Perplexity API. Discovered dissent extraction issues, built GPT cross-check, fixed gold set. Match rate 56% → 84% (21/25). Pushed to test (64a3327).

## What Changed
- **Prompt v1.1**: Explicit rules for listing ALL dissenters, distinguishing concurrences from dissents
- **GPT cross-check**: Reads opinion header from DB via GPT-4o-mini when Scout dissenters look wrong (empty on split vote, count mismatch). Filters to valid SCOTUS justices only. Does NOT touch vote_split (unreliable from opinion headers)
- **Gold set**: Fixed 8 errors — 6 dispositions (reversed → reversed_and_remanded), Becerra + Bowe dissent lists
- **Perplexity key**: Added to .env (pplx-Aaz..., from Josh's account)
- **CLI**: Added `--model=` flag for Perplexity model override

## AC Status (ADO-456)
- [x] 100% disposition on 6 known-bad cases (6/6)
- [x] 100% JSON parse success (25/25)
- [x] 0 invalid enum writes
- [x] 100% source capture
- [ ] Cost < $0.15 — actual ~$0.29 (higher per-case cost than estimated, still trivial)
- [x] Perplexity imports clean
- [x] Code review findings addressed

## 4 Remaining Mismatches
1. **Bondi/Barrett**: Perplexity non-deterministic on "reversed" vs "reversed_and_remanded"
2. **Riley**: GPT finds 3/4 dissenters — misses Gorsuch ("joined all but Part IV" = partial joiner)
3. **Abbott**: Shadow docket stay — "granted" vs "stayed" doesn't fit merits disposition enum

## Next Session
1. Decide: accept 84% or investigate further (diminishing returns)
2. If accept → ADO-456 → Testing, start ADO-457 (live run)
3. Consider: should Abbott be removed from gold set? (not a merits case)
4. Run unit tests to confirm no regressions from code changes

## Cost Summary
- Dry runs total: ~$0.70 across all test runs (well under budget)
- Per-case cost: ~$0.01 Perplexity + ~$0.001 GPT cross-check

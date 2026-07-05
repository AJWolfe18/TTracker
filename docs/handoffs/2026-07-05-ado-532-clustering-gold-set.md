# Handoff: ADO-532 — Clustering Eval Harness + Gold Set

**Date:** 2026-07-05
**Ticket:** ADO-532 (Active → Testing; Josh spot-check is the closure gate)
**Branch:** test, commit `aed01aa` (+ this handoff)
**Plan of record:** `docs/features/clustering-quality/plan.md` Part 2 · **Eval details:** `docs/features/ai-evals/plan.md` § Clustering Eval

## What was built

1. **Eval harness restored + extended.** The `scripts/evals/` harness referenced by the plan had been *deleted* in commit `2c7572f` (April 2026, legacy-GPT retirement) — the plan's "extend, don't rebuild" note was stale. The generic skeleton (`run-eval.js`, `eval-types.js`) was restored from git history; `run-eval.js` now has an eval-type registry, and eval types declare their own client needs (the clustering eval needs none — fully offline).
2. **Gold set:** `scripts/evals/clustering-gold-set.json` — **208 labeled pairs** (110 same_event / 98 different_event, 135 hard, 198 article↔story + 10 story↔story July-4th pairs). Sources: PROD near-miss logs from 67 runs (118), 100+ day generic-phrasing collisions (40), live Tier A/B attaches (40), July 4th fragmentation cluster (10). The labeling principle and provenance are in the file's `meta` block; one undecidable pair was excluded rather than guessed (fireworks-show ambiguity).
3. **Runner:** `scripts/evals/clustering-eval.js` replays `calculateHybridScore` + guardrail + the Tier A/B cross-run cascade offline per pair. Similarities are decision-time values from the logs, stored in the gold-set file — **the eval never fetches embeddings** (rule #11). `hybrid-clustering.js` gained only 3 `export` keywords (no logic change).
4. **Builder:** `scripts/evals/build-clustering-gold-set.js` regenerates an unlabeled draft from log extracts; the raw extracts are retained at `scripts/evals/clustering-log-extracts-2026-07-05.txt.gz`. PROD access is read-only anon PostgREST, credentials parsed from `public/supabase-browser-config.js` at runtime (no hardcoded PROD refs → lint-prod-refs safe).
5. **Drift tripwire:** `npm run qa:clustering-eval` (now part of `qa:smoke`) asserts 100% replay-vs-live agreement with `TIERB_BYPASS=off` — if ADO-534 edits the live cascade without syncing the eval's transcription, CI fails instead of the baseline silently degrading.

## Baseline (the headline numbers)

| Config | Precision | Recall | F1 | Replay-vs-live |
|---|---|---|---|---|
| Tier B bypass OFF (log-window config) | **100%** (0 FP) | 40.0% | 57.1% | **100%** — exact reproduction of all 198 live decisions |
| Tier B bypass ON (current PROD) | 98.1% (1 FP) | 53.0% | 68.8% | 92.9% (delta = the flag itself) |

Interpretation: the deterministic system is precision-heavy by design — false merges ≈ 0, but it misses ~half of true same-event pairs. The ADO-529 Tier B bypass buys +13pp recall for one false merge (gs-086: generic "agenda summer stall" piece → Iran-deal story via title-token corroboration — a real observed Tier B weakness, kept in the set deliberately). The 47 missed merges concentrate in the near-miss band — that is exactly the ADO-533 Judge's repair target, now quantified.

## Code review (two-pass)

- **Pass 1 (pattern/bugs):** clean — cascade transcription verified line-by-line against live code; baselines independently reproduced; egress rule #11 compliance verified programmatically (no embedding/content key anywhere in the gold set); eval-types.js confirmed byte-identical to the pre-deletion version modulo CRLF.
- **Pass 2 (production readiness):** ship-ready with 2 Important items, both fixed: (1) first-pass-label caveat now on the published baselines (docs + `meta.verification_status`) with Josh spot-check as the closure gate; (2) `meta.schema_note` documents that story_story pairs are story-shaped on both sides so the ADO-533 consumer doesn't crash on `a.title`/`embed_sim`. Minor items also done: fidelity test in qa:smoke, raw extracts retained.

## What Josh needs to do (closure gate)

Review the spot-check page: **https://claude.ai/code/artifact/8b8c7f30-4505-407a-9a45-e408f7e767a7**
Section 1 (48 disagreement pairs) matters most — those labels directly set the baseline. Report disagreements as "gs-NNN should be same/different"; labels live in `clustering-gold-set.json`, and `node scripts/evals/run-eval.js --type=clustering` re-runs in seconds. Then ADO-532 can close.

## Gotchas for the next session (ADO-533)

- The Tier A/B cascade is **transcribed** in clustering-eval.js (KEEP IN SYNC comment at top). ADO-534 should extract a shared pure function — gated on this gold set.
- story_story pairs: both sides story-shaped, `replay.centroid_sim_*` not `embed_sim` (see `meta.schema_note`).
- Near-miss story features are current-state snapshots, not decision-time (only the similarity is decision-time). The 100% bypass-off agreement shows this doesn't distort the replay in practice.
- The gold set's "judgment call" notes (e.g., same-day indictment+halt = same event, filing→ruling days apart = different) are effectively the first draft of the Judge prompt's merge criteria — reuse them in prompt-v1.md.

## Verification steps

```bash
npm run qa:smoke                                        # includes qa:clustering-eval tripwire
node scripts/evals/run-eval.js --type=clustering        # baseline (bypass ON)
TIERB_BYPASS=off node scripts/evals/run-eval.js --type=clustering   # 100% live agreement
node scripts/evals/run-eval.js --type=clustering --disagreements-only
```

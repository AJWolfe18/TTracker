# 2026-07-05 — Clustering Quality v2: Architecture Plan + ADO Restructure

## What Happened

Strategy session with Josh (no code changes — docs + ADO only). Reviewed the ADO-529 diagnostic, the full clustering code (`scoring.js`, `candidate-generation.js`, `hybrid-clustering.js` decision paths), the parked events-tracker design, and prior eval/merge history. Produced the **Clustering Quality v2 plan of record**: `docs/features/clustering-quality/plan.md` **Part 2** (Part 1 = the closed 529 diagnostic, kept as evidence).

## The v2 Architecture (one paragraph)

Three layers: (1) inline clustering stays deterministic and conservative at ~72h — correct window for "story = one event," do NOT widen; (2) a new **Clustering Judge** Claude cloud agent (Sonnet, 3x/day, same skeleton as SCOTUS/EO/Pardons/Stories) merges same-event fragments from the last ~7 days with default-DENY LLM judgment, plus an **inline** GPT-4o-mini adjudication call in the ambiguous band that prevents fragments from being created (so we never enrich them); (3) the narrative/saga layer (Epstein, Iran) = **ADO-530, which is the same feature as `docs/features/events-tracker/design.md`** — reconcile, don't invent a third concept.

## Josh's Decisions (locked, 2026-07-05)

1. Judge cadence: **3x/day**
2. **Auto-merge** (no per-merge approval) — quality tracked via new `clustering_judge_log` table + admin "Judge" tab; merges reversible (tombstones, never delete)
3. Model: **Sonnet** for Judge agent, GPT-4o-mini for inline call
4. Judge **inline AND after-the-fact** (inline saves enrichment spend)
5. Cost: <$1/month new spend (inline calls); Judge rides existing Claude agent infra

## Where We'd Gone Wrong (the honest diagnosis driving v2)

- ~20 tuning tickets (TTRC-230→357) with **no durable ground truth** — clustering never had a repeatable gold set (only one-off CSV labeling + shadow logs); the enrichment eval harness (`scripts/evals/`) exists and gets extended, not rebuilt
- Greedy attach-or-create with **no repair** — fragmentation permanent (July 4th = 5 stories); guardrails rationally bias toward create → fragmentation is the guaranteed failure mode
- Deterministic gates doing a **semantic job** in exactly the 0.85-0.92 band where they're weakest; misleading titles need an LLM
- A merge pass existed once (TTRC-231, `scripts/archive/merge-split/`) — deterministic, tied to retired job-queue worker; the Judge is that idea done right

## ADO Changes (all under Epic #13 "Story Clustering System")

- **Created:** #532 (eval harness + gold set) → #533 (Judge agent) → #535 (inline adjudication) → #534 (scoring rework); 532 is predecessor of 533/534; 535 blocked on 532+533
- **Commented:** #530 (= events-tracker feature, reconcile), #531 (also blocked on #533's merge machinery), #533 (Josh's decisions), #532 (gold set validates both judges)
- **Re-parented under #13:** #529, #530, #531
- **Closed as superseded:** #70, #71, #72, #73, #76 (each with a comment mapping to its v2 replacement)
- **Left open deliberately:** #69 (relevance filtering at ingestion — NOT superseded, different problem)
- **Flagged, untouched:** #74/#75 (security items misfiled under Epic 13)

## Docs Changed This Session

- `docs/features/clustering-quality/plan.md` — restructured into Part 1 (529 evidence) + Part 2 (v2 plan: architecture, Judge design sketch, inline adjudication, eval spec, scoring rework, decisions, sequencing, **implementation notes** with DDL sketches / RPC shapes / file locations / gotchas — deep enough for cold start, deliberately NOT full code since tunables must come from gold-set data)
- `docs/decisions/0002-llm-adjudication-over-gate-tuning.md` — new ADR for the architecture decision
- This handoff

## Next Session — Starting Prompt (copy/paste)

> **Start ADO-532: Clustering eval harness + gold set.**
>
> Read `docs/features/clustering-quality/plan.md` first — Part 2 is the plan of record, and its "Implementation notes for executing sessions → ADO-532" section is your build spec (entry schema, file locations, seed data sources). Part 1's appendix has the raw evidence: 8 hand-verified Tier A merges, the July 4th 5-story fragmentation cluster, and reproducible near-miss log extraction commands (mind the JSON.parse gotcha documented there).
>
> This session:
> 1. Extend the **existing** eval harness at `scripts/evals/` (structure in `docs/features/ai-evals/plan.md`) — add `clustering-eval.js` + `clustering-gold-set.json`. Do not build a new harness.
> 2. Build the gold set: ~150-200 labeled pairs (same_event / different_event, easy/hard) seeded from the Part 1 appendix + near-miss logs pulled from PROD run logs. Include misleading-title cases and 100+ day generic-phrasing collisions (labeled different_event). LLM-assisted first labeling pass, then hand-verify hard cases with Josh spot-checking a sample.
> 3. Runner: replay `calculateHybridScore` + guardrail offline per pair and report precision/recall/F1 for the current deterministic system (the baseline). Store precomputed similarities in the gold-set file at build time — never refetch embeddings (egress rule #11).
> 4. Update ADO-532 as milestones complete; `/end-work` when done.
>
> Constraints: `test` branch, Node only (no Python), PostgREST reads with minimal `select=` + `limit`, never fetch embedding/content fields.

**Model allocation (Josh-approved):** run #532's labeling with Fable (judgment is the product — mislabeled gold set silently corrupts everything downstream); #533/#535/#534 are fine as Opus/Sonnet sessions once the gold set exists to gate their output.

## Gotchas for Future Sessions

- Near-miss log lines extracted via `grep -o '"type":"X".*'` need ONLY a prepended `{` before `JSON.parse` (closing brace is already included) — documented in plan.md Part 1
- `clustering_judge_log` will need an anon GRANT if the admin tab reads it (migration-046 pattern), and any new SECURITY DEFINER RPC needs REVOKE FROM PUBLIC (095/096 pattern)
- `merge_stories` RPC must tombstone (new `merged_into_story_id` column), never delete — and `stories-active` edge function must exclude merged-state stories
- `ENABLE_INLINE_CLUSTER_JUDGE` ships default **OFF** (opposite of the TIERB flag default)

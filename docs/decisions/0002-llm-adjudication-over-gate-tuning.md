# ADR 0002: LLM Adjudication + Merge-Repair Layers Over Continued Deterministic Gate Tuning

**Date:** 2026-07-05
**Status:** Accepted (Josh, architecture session 2026-07-05)
**Related:** ADR 0001 (Claude agents over GPT pipelines) — same underlying lesson applied to clustering

## Context

Story clustering accumulated ~20 tuning tickets (TTRC-230→357) — weights, adaptive thresholds, tiered guardrails, same-run and two-tier cross-run overrides, margin bypasses — without a durable labeled eval set to measure any of it. The ADO-529 diagnostic showed the mechanism is not buggy (8/8 hand-verified merges correct, ~39% weekly attach rate), but two structural limits remained: (1) greedy attach-or-create decisions are permanent, so same-event fragmentation (e.g., one July 4th speech split across 5 stories) can never be repaired, which forces every safety gate to bias toward creating new stories; (2) "is this the same real-world event?" is a semantic judgment that slug tokens / entity Jaccard / title overlap approximate worst in exactly the 0.85-0.92 embedding band where all hard political-news decisions live (everything-Trump is embedding-similar to everything-else-Trump; headlines routinely mislead).

## Decision

Stop tuning deterministic gates as the path to clustering quality. Instead:

1. **Gold set first:** a durable labeled pair set (~150-200) in the existing `scripts/evals/` harness gates ALL future scoring/threshold/gate changes (ADO-532).
2. **LLM judgment where judgment is the job:** a Clustering Judge Claude cloud agent (Sonnet, 3x/day, default-DENY, capped auto-merge, every verdict logged to `clustering_judge_log`) repairs same-event fragmentation after the fact (ADO-533), plus an inline GPT-4o-mini adjudication call in the ambiguous band prevents fragments at creation so they are never enriched (ADO-535). Merges tombstone, never delete — reversible.
3. **Inline clustering stays deterministic, conservative, and 72h-windowed** — with a repair layer behind it, "when unsure, create a new story" becomes the correct cheap default (merging later is easy; splitting is hard).
4. **Multi-week narratives are a separate layer**, not a wider clustering window: ADO-530 = the events-tracker feature (sagas/one-shots), with LLM-based story→thread assignment.

## Consequences

- **Positive:** fragmentation becomes repairable and cheap instead of permanent; false merges stay rare (default-DENY + reversibility); tuning becomes measurable (gold-set precision/recall in every PR); gate epicycles (Tier B bypass lattice) can be deleted once the Judge proves out; merge machinery built once serves the historical backfill (ADO-531).
- **Negative/accepted:** new moving parts (one more cloud agent, one inline API dependency with a hard fallback to current behavior); <$1/month new OpenAI spend; auto-merge means an occasional wrong merge ships before review catches it in the admin Judge tab — accepted because tombstoning makes it reversible in minutes.
- **Rejected alternatives:** widening the 72h/48h windows (evidence: 100+ day near-misses are generic-phrasing collisions — would merge unrelated events); more deterministic gate tuning (eight months of it produced diminishing returns and unmeasurable risk); human approval per story merge (daily ops burden for low-stakes, reversible actions — human review is reserved for the user-facing events layer).

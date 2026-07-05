# Clustering Quality Audit — Findings & Recommendation (ADO-529)

**Goal:** Diagnose why PROD story clustering only merges ~1.4 articles/story (12,088 stories vs 17,210 articles lifetime), determine root cause, and recommend (not redesign) a fix.

## Global Constraints

- Budget: <$50/month hard limit (`CLAUDE.md`). This fix has **zero cost impact** — clustering already computes embeddings/entities for every article; the change only affects which existing candidate gets selected, no new AI calls.
- Work on `test` branch; PROD via cherry-pick + PR only; never push `origin main` directly.
- No Python — Node.js/JavaScript only.

---

## Diagnostic Summary (AC1)

Reviewed the clustering pipeline (`scripts/rss/hybrid-clustering.js`, `scripts/rss/scoring.js`, `scripts/rss/candidate-generation.js`) — this is not a naive/first-pass system. It already carries ~20 tickets of prior tuning (TTRC-230 through TTRC-357): hybrid scoring across 6 signals, adaptive thresholds, a tiered guardrail, same-run overrides, and a 2-tier cross-run override system.

Pulled and analyzed real PROD clustering logs (near-miss diagnostics, which log by default) across a 7-day sample (19 of ~57 runs) plus hand-verified real merges:

- **92 `CROSS_RUN_NEAR_MISS` events** sampled. Of the 85 within the Tier B bypass's eligible window, only **2 (2.4%)** had `tierb_margin_bypass_would_fire: true`.
- **Denominator:** 133 stories created vs 86 attached across the same sample (~39% attach rate this week) — a materially higher rate than the 1.4 lifetime ratio implies, suggesting recent tuning already works reasonably well on a like-for-like basis.
- **8/8 hand-verified live Tier A merges were correct** (same real-world event on both sides, including a subtle SCOTUS-ruling carve-out case) — the corroboration mechanism itself (slug/entity/title-token overlap resolving near-tied embedding scores) is trustworthy.
- Most near-misses beyond the bypass window are separated by **100+ days** (up to ~160 days) with high embedding similarity from generic recurring political phrasing (e.g., "Trump [X] again") — these are very likely correctly-rejected non-matches (different real events), not missed merges.

## Root Cause (AC2)

Two distinct, independent findings — not one:

1. **A small, real, already-built gap:** `ENABLE_TIERB_MARGIN_BYPASS` (the flag that lets corroboration — shared entity/slug/title-token — resolve near-tied embedding candidates within a 48h window) defaults to `false` in code and was never set in either RSS workflow. It has been computing and logging what it *would* do (shadow mode) with no live effect. Tier A runs the identical logic unconditionally today with a clean track record.
2. **The actual explanation for the low lifetime ratio is structural, not a clustering bug.** Article-to-story clustering operates on a rolling 72-hour window per story. That's a deliberate, correct guard against merging unrelated events that happen to share generic phrasing months apart — loosening it broadly would trade rare missed merges for real false-merge risk. But it also means **the architecture has no way to represent one ongoing narrative thread spanning weeks or months** (Epstein, ICE-style coverage) — which has nothing to do with scoring quality and can't be fixed by tuning clustering. That's a different capability entirely (a "thread" layer grouping multiple already-correct stories together over time), which is prerequisite work for the future Important Stories Tracker concept, not something to build here.

## Recommendation (AC3)

**Enable `ENABLE_TIERB_MARGIN_BYPASS=true`** in both `rss-tracker-prod.yml` and `rss-tracker-test.yml`. Low effort (one-line config change per workflow, already made in this change), zero cost, correctness-verified via the Tier A analog. Expected impact: **~6 additional article attaches/week (~2% volume increase)** — a real, worthwhile, but modest win. It does **not** materially move the 1.4 lifetime ratio, and should not be sold internally as "the clustering fix."

**Do not** widen the 72h/48h time windows or loosen the guardrail broadly — the evidence (100+ day near-misses that look like generic-phrasing collisions) shows this would introduce false merges of unrelated events, not just approve legitimate ones.

**No standalone historical backfill using this fix.** A pure re-run of the corrected logic against the existing 12,088 stories would yield the same ~2-3% order-of-magnitude improvement — not worth a dedicated project on its own. See "Deferred Work" below.

## Change Made This Session

- `.github/workflows/rss-tracker-prod.yml`: added `ENABLE_TIERB_MARGIN_BYPASS: 'true'`
- `.github/workflows/rss-tracker-test.yml`: added `ENABLE_TIERB_MARGIN_BYPASS: 'true'` (parity, TEST is manually triggered so no schedule risk)
- No code changes to `hybrid-clustering.js` itself — the bypass logic already exists and is tested via months of shadow-mode logging.

### Rollout / Monitoring

- Piggybacks on the existing ADO-528 3-day PROD monitoring window (Stories Claude Agent cutover) — no separate monitoring job needed.
- Watch `CLUSTERING_SUMMARY` log lines for `attached_324_tier_b > 0` (currently 0 in every sampled run) to confirm the flag is taking effect.
- Spot-check a few Tier B attaches the same way Tier A was verified (pull `article_id`/`story_id` pairs from `CROSS_RUN_OVERRIDE` logs with `tier:"B"`, compare real headlines) after a few days of live data.

### Rollback

Set `ENABLE_TIERB_MARGIN_BYPASS` back to `'false'` (or remove the line) in both workflow files. No data migration, no state to unwind — it only affects the decision at clustering time for new articles going forward.

---

## Deferred Work (AC4 — two separate future tickets, not scoped here)

1. **Narrative/thread tracking layer.** Design a mechanism to group multiple already-correctly-clustered stories into one ongoing narrative thread across weeks/months (e.g., Epstein, ICE). This is the actual prerequisite for a future "Important Stories Tracker" feature (surfacing/tracking only major ongoing threads instead of treating every story equally) — not scoped in this doc, needs its own discovery + plan.
2. **Historical backfill / re-cluster of legacy stories.** Re-evaluate existing stories against each other with whatever improved method exists at the time. Recommend **not** doing this as a standalone project against just the Tier B bypass fix (too low-yield per the analysis above) — bundle it with the thread-tracking work once that's scoped, since building the thread-merge machinery once and running one backfill pass is more efficient than backfilling twice.

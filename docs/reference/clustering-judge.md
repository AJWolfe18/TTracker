# Clustering Judge Agent — Reference

**Status:** Live on PROD (2026-07-07) · **ADO:** 533 · **Voice/output:** none (structural only — it does not write editorial content)

One-page reference for how the Clustering Judge decides what to work on and what it does. Written for
quick human review, not as the source of truth — the authoritative details live in the files linked at
the bottom.

---

## What it is

A Claude Sonnet cloud agent that finds separate story records that actually cover the **same real-world
event** and merges the fragments into one story. It is the **repair pass** on top of the deterministic
inline clustering: political-news clustering is deliberately conservative (when the pipeline is unsure it
creates a *new* story), so one event — e.g. the July 4th "Salute to America 250" speech — routinely
fragments into several stories. The Judge stitches those back together.

- **Cadence:** 3×/day — 05:00, 13:00, 21:00 UTC (offset from the RSS pipeline's :30)
- **Model:** claude-sonnet-5 · **Cron trigger:** `trig_01DDXZkpC9PkgTzU8wDdL9QM`
- **It does NOT** write summaries, alarm levels, categories, or `is_public`. It only decides
  merge / keep / uncertain, executes merges, and logs every verdict.

## What it decides / produces

For each candidate pair it emits exactly one verdict:

- **merge** — clearly the same discrete occurrence → the fragments are combined into one story.
- **keep** — clearly different developments (even within the same saga or same day) → left separate.
- **uncertain** — cannot tell → flagged, never merged. Default here on any doubt.

Every verdict is written to the **`clustering_judge_log`** table (the audit trail behind the admin
**Judge tab**). `uncertain` verdicts also fire a non-blocking **Discord alert** so a human can review the
only verdict that needs one.

## How it selects what to judge

Each run a database function (`get_clustering_judge_candidates`) builds the candidate list fresh. The
pool it considers:

- stories that are **`active`** (not closed/archived),
- **not already merged away** (`merged_into_story_id IS NULL` — tombstones are excluded),
- that **have a centroid embedding**, and
- **first seen in the last 7 days** (rolling window).

It forms every pair within that pool and keeps pairs whose **centroid embeddings are ≥ 0.83 cosine
similar** (semantic closeness). Pairs that *also* share a concrete entity or topic slug are ranked first,
then by similarity; the **top 30 pairs** go to the LLM. Shared entities/slugs are *context for ranking
and judgment, not a hard filter* (recall-first) — and generic ones (US-TRUMP, ORG-SENATE, LOC-WASHINGTON,
etc.) are treated as **stopwords** so they don't count as concrete signal. The LLM makes the final call
with a **default-DENY** bias.

**Embeddings never leave the database** — all similarity math runs in SQL (egress rule #11).

### Merge policy (Josh's binding ruling)

- **merge** = the same discrete occurrence: one ruling, one speech, one announcement, one disclosure —
  **including** same-cycle reactions/commentary on it and the circumstances of it (e.g. a pre-speech storm
  evacuation + the speech are one occasion).
- **keep** = separate developments, *even within one saga and even the same day*: filing vs ruling,
  indictment vs the same-day action, an event vs a later comment about it, two votes/hearings in a series,
  coverage months apart (that's narrative-thread material for the future events layer, not one event).

Source of truth for the policy: `scripts/evals/clustering-gold-set.json` → `meta.verification_status`.

## Key numbers & the cap behavior

| Knob | Value | Meaning |
|------|-------|---------|
| `p_min_sim` | **0.83** | centroid cosine threshold to be a candidate |
| `p_days` | **7** | rolling recency window (on `first_seen_at`) |
| `p_max_pairs` | **30** | candidate pairs *evaluated* per run |
| merge cap | **10** | merges *executed* per run (prompt-capped **and** DB-enforced) |

**The 30 and the 10 are different limits.** 30 = pairs judged; 10 = merges actually performed. If a run
wants to merge more than 10, the extras are logged with `merged=false` / rationale `"cap_reached"` and
**deferred, not dropped** — their stories stay active and re-surface as candidates next run. Capacity is
**3 runs/day × 10 = 30 merges/day**, so normal spillover clears within hours.

**Cross-run behavior:** the candidate list is rebuilt from scratch every run, so survivors of earlier
merges are re-paired against everything still in the window (only tombstoned losers drop out). This is how
**merge-chaining** completes a multi-fragment cluster across runs, and how deferred pairs eventually merge.

**The one edge case:** the 7-day window is a soft deadline — a pair deferred by the cap *every run for 7
straight days* would age out and never merge inline. That requires a sustained backlog of >30
merge-worthy new pairs/day for a week, which only happens during a **bulk backfill** (ADO-531), not live
operation. Backfill gets its own pacing/guardrails for exactly this reason.

## Safety & reversibility

- **Dry-run vs live** is controlled entirely by the `JUDGE_DRY_RUN` env var: unset or anything other than
  the string `false` → dry-run (logs verdicts, merges nothing); `=false` → live (executes merges).
  Fail-safe: a missing/ambiguous value is dry-run.
- **Merges are reversible.** The loser is **tombstoned, never deleted** (`status='merged_into'`,
  `merged_into_story_id` → survivor); `story_merge_audit` snapshots the loser's article IDs before the
  repoint. A wrong merge is unwound, not lost. The frontend `stories-detail` endpoint redirects a
  tombstone to its survivor.
- **Survivor is the older story** (smaller `first_seen_at`, tie-break smaller id), so the original story's
  URL/id stays stable; its centroid is recomputed as the average of the combined member articles.
- **Security:** the candidate + merge RPCs are `service_role`-only; the Judge tab reads the log via a
  `service_role` edge function (`admin-judge-log`), so nothing is exposed to anonymous users.

## Cost

Sonnet, ~30 short candidate pairs/run, 3×/day. Effectively **~$0** — single-digit dollars/month at most.
No OpenAI calls. Already inside the $50/mo budget.

## Where it lives

- **Prompt (workflow):** `docs/features/clustering-judge/prompt-v1.md`
- **Architecture & decisions:** `docs/features/clustering-judge/plan.md` (Part 2) ·
  `docs/features/clustering-quality/plan.md`
- **Database:** `migrations/100_clustering_judge.sql` (log table, tombstone columns, `merge_stories`,
  `get_clustering_judge_candidates`), `101_clustering_judge_hardening.sql` (run cap, `story_merge_audit`,
  tombstone exclusions), `102_merge_stories_concurrency.sql` (locking + atomic cap + `p_run_id`)
- **Admin surface:** Judge tab → `admin-judge-log` edge function → `clustering_judge_log`
- **PROD artifacts tally:** `docs/features/clustering-judge/prod-deployment-manifest.md`
- **Gold set / eval:** `scripts/evals/clustering-gold-set.json`, `scripts/evals/clustering-eval.js`

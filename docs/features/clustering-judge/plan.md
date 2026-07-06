# Clustering Judge Agent — Implementation Plan (ADO-533)

**Status:** Session 1 (build + dry-run) shipped on `test`. Session 2 (live cron + auto-merge) deferred.
**Master design of record:** `docs/features/clustering-quality/plan.md` Part 2 (the v2 architecture session
with Josh, 2026-07-05). This doc is the ADO-533-specific implementation record; it does not restate the
"why" — read Part 2 for that.
**Binding merge ruling:** `scripts/evals/clustering-gold-set.json` → `meta.verification_status` (Josh,
2026-07-05). Encoded verbatim in `prompt-v1.md` Section 4. Do not re-litigate.

---

## What this is

Layer 2 of the 3-layer clustering architecture: a Claude cloud agent (Sonnet) that runs 3x/day, finds
story pairs covering the **same real-world event**, and merges the fragments — the repair pass that makes
inline clustering's conservative "when unsure, create a new story" bias safe (the July 4th "Salute to
America 250" speech fragmented into 5 stories; Part 1 appendix). Default-DENY judgment; auto-merge with a
per-run cap; every verdict logged for audit + review.

Same skeleton as SCOTUS/EO/Pardons/Stories agents (env bootstrap, PostgREST-via-curl, gold-set
validation, `prompt-vN.md` in repo, RemoteTrigger cron).

---

## Cost impact

- **Session 1 (this session): $0.** Build + an **offline** dry-run validator (`scripts/evals/`) that
  runs the judge decision rules over the gold set — no live model calls, no live merges.
- **Session 2 (live):** the Judge on Sonnet at 3x/day judging ≤30 pairs/run is a small fraction of the
  Stories agent's existing 12 runs/day. Rides existing Claude cloud-agent infra — **no new OpenAI
  spend, no new secrets.** Already approved by Josh (2026-07-05). The separate future inline
  adjudication (ADO-535) is the only piece that adds per-call cost, and it's <$1/mo — out of scope here.

---

## Session 1 deliverables (this session)

1. **Migration `100_clustering_judge.sql`** (applied to TEST via SQL Editor):
   - `clustering_judge_log` table — one row per verdict (pair ids + headline snapshots, verdict,
     confidence, rationale, `centroid_sim`, `merged`, `dry_run`, `run_id`); heartbeat rows on empty
     runs; RLS on, no anon grant (admin reads via a service_role edge function).
   - Re-adds `stories.merged_into_story_id` + `status='merged_into'` — these existed under the retired
     TTRC-231 merge system (migrations 025/027) but were dropped by migration 055 and are absent on
     TEST. Re-declared with the exact original DDL so TEST/PROD converge without drift.
   - `merge_stories(p_loser_id, p_survivor_id)` — atomic, idempotent, never deletes: repoint
     `article_story` → survivor, recompute survivor `centroid_embedding_v1` / `entity_counter` /
     `top_entities` **server-side** (AVG over member article embeddings — reuses the
     `recompute_story_centroids` recipe scoped to the survivor), recount `source_count`, widen the
     survivor's time span, tombstone the loser (`status='merged_into'` + `merged_into_story_id`).
   - `get_clustering_judge_candidates(p_min_sim, p_days, p_max_pairs)` — last-N-day active story pairs
     with centroid cosine ≥ threshold, capped. **Recall-first** (see deviation below).
   - Both RPCs `SECURITY DEFINER` + locked `search_path`, EXECUTE revoked from PUBLIC/anon/authenticated
     and granted only to `service_role` (migration 095/096 pattern; advisor-clean).

2. **Merged-state exclusion** across the read surface:
   - `stories-active` edge fn: already gated on `status='active'`; added explicit
     `merged_into_story_id IS NULL` defense-in-depth guard.
   - `stories-search` edge fn: unconditional `status != 'merged_into'` (the status filter is
     user-supplied and may be null).
   - `stories-detail` edge fn: follows a tombstone **once** to the survivor so old links resolve
     (returns `redirected_from`). `merge_stories` refuses to merge into a tombstone, so single-hop is
     loop-safe.
   - Public frontend list already excludes merged via its `status=eq.active` base filter
     (`src/lib/filters.ts`) — no change needed.

3. **Docs:** this `plan.md` + `prompt-v1.md` (mirrors `stories-claude-agent/` structure).

4. **Dry-run validation** (`scripts/evals/`): the judge decision rules run over the gold set's 10
   `story_story` pairs (July 4th cluster, gs-199..208, all same_event) + a sample of `article_story`
   pairs, reporting verdict accuracy vs labels. Verdicts logged, `merged=false` forced.

5. **Admin "Judge" tab** (`public/admin.html`): a `JudgeTab` React component mirroring the Skips tab,
   backed by a new `admin-judge-log` edge function (service_role, password-gated) — verdicts with
   headline A vs B side-by-side, filterable by verdict + source.

---

## Key decisions & deviations (for reviewers)

**D1 — Candidate query is recall-first, NOT "AND shared non-stopword entity."** Part 2's sketch said
"centroid sim ≥ 0.85 AND ≥1 shared non-stopword entity." But the flagship July 4th fragments
(gs-199..208) share only `US-TRUMP` (an `ENTITY_STOPWORD`) / `LOC-DC` and have **no overlapping topic
slugs** — an AND-entity gate would exclude the exact case this feature exists to catch. So the RPC gates
on **centroid cosine ≥ threshold within a 7-day window** and returns shared entities/slugs as *context*
(and ordering boost), not a hard filter. The 7-day window removes the 100+-day generic-collision noise
(Part 1); the LLM's default-DENY judgment carries precision; the cap bounds cost. Threshold default
**0.83 raw cosine**: 9 of the 10 July 4th pairs are ≥ 0.83; the one below (gs-204 at 0.8227) needn't
surface directly because both its stories pair above 0.83 with anchor story 12118, so all 5 fragments
still collapse into one survivor via merge-chaining. **Confirm before session 2 goes live** (consider
lowering to ~0.82 if the live recall check wants the direct pair too).

**D2 — Admin tab via edge function, not direct anon PostgREST.** Part 2 mentioned "PostgREST with
select= + limit" and a conditional anon GRANT. The *actual* Skips tab (the exemplar) uses a
password-gated `admin-pipeline-skips` **edge function** on `service_role`. Followed that pattern
(`admin-judge-log`) — so **no anon GRANT** on `clustering_judge_log`, consistent with the migration-046
security posture (don't expose new tables to anon).

**D3 — Reuse of TTRC-231 tombstone shape.** `merged_into_story_id` + `status='merged_into'` reuse the
migration 025/027 column/status names (not a new invention), so the schema is consistent with the repo's
history and any PROD remnants.

**D4 — Survivor = older story.** Deterministic survivor selection (older `first_seen_at`, tie-break
smaller id) keeps the original story's id/URL stable across a merge.

---

## Safety rails

- **Dry-run first** (`JUDGE_DRY_RUN` defaults to true; only the literal `false` enables merges) —
  validated against the gold set before any live merge.
- **Per-run merge cap: 10.**
- **Reversible:** losers are tombstoned, never deleted; a bad merge spotted in the admin tab is
  undoable.
- **Kill switch (session 2):** disable the RemoteTrigger cron.
- **3-day monitoring window** at live rollout (ADO-528 playbook).
- **Egress:** no embeddings ever leave the DB — centroid similarity + recompute are entirely in SQL
  (rule #11).

---

## Deferred to Session 2 (with the two code reviews' gates folded in)

- RemoteTrigger cron (Sonnet, 3x/day, offset from RSS runs, e.g. `0 5,13,21 * * *`) — all
  RemoteTrigger/bootstrap gotchas are in the `claude-agent-patterns` memory entity + `cloud-agent-runbook.md`.
- Flip `JUDGE_DRY_RUN=false` to enable live auto-merge (cap 10/run).
- 3-day PROD monitoring window before closing.
- **Live recall check of `get_clustering_judge_candidates` BEFORE flipping dry-run off** (review gate):
  session-1 validation exercised the *prompt's* decision quality against the gold set but never ran the
  candidate RPC on live data (TEST has no stories in the 7-day window; the gold-set story ids are PROD).
  Confirm the RPC actually surfaces real same-event fragments at the chosen threshold on live PROD data
  before enabling merges — the whole recall-first bet (D1) rides on it.
- **Hard merge cap** (defense-in-depth): the per-run cap of 10 is prompt-enforced only (LLM-honored).
  Fine while dry-run, but add a code/DB guard before live auto-merge runs at volume.
- **`merge_stories` does NOT recompute `topic_slugs` / `search_vector`** on the survivor (only
  centroid/entity_counter/top_entities/source_count/time-span). By design — those facets are editorial,
  owned by the enrichment agent — so the survivor's topics won't reflect the loser's articles until it
  re-enriches (bounded ≤12h via the existing `last_enriched_at` staleness path). Note for session 2.

## Deployment ordering (PROD promotion — review gate)

The three story edge functions depend on migration 100's `merged_into_story_id` column
(`stories-active`/`stories-detail` reference it; `stories-search` only touches `status`). **Migration
must be applied before the edge functions deploy**, or `stories-active` (the main public page) errors with
"column does not exist." Make this an explicit ordered step in the PROD PR.

> **Note (2026-07-06):** migration 100 was applied to **PROD** early (manually, ahead of TEST). This is
> harmless — it is dormant additive infra (empty table, all-NULL column, widened constraint, two RPCs
> nothing calls; RPCs locked to service_role). No PROD behavior changes without the session-2 cron. Still
> apply it to TEST for session-1 parity; the PROD promotion PR then need not re-run it (idempotent if it does).

## Downstream (separate tickets)

- **ADO-535** inline ambiguous-band adjudication — ships *after* Judge verdicts prove out live.
- **ADO-531** historical backfill — reuses `merge_stories`; blocked on this work.
- **ADO-534** scoring rework — gated on the gold set.

---

## Verification (session 1 exit)

- Migration 100 applied to TEST; 3 verification queries pass (objects exist; RPC grants anon=f/auth=f/
  service_role=t; candidate generator returns ≤30 rows).
- Dry-run validator: judge rules correctly MERGE all 10 July 4th `story_story` pairs and correctly
  KEEP the chain-of-events `article_story` sample pairs.
- Edge functions redeployed to TEST (depend on migration 100's `merged_into_story_id`).
- Admin Judge tab renders against `clustering_judge_log` (seeded with dry-run rows).
- Two-pass code review clean; `npm run qa:smoke` passes.

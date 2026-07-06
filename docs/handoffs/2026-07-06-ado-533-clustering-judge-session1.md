# Handoff — ADO-533 Clustering Judge, session 1 (build + dry-run)

**Date:** 2026-07-06
**Branch:** `ado-533-clustering-judge` → **PR #106** (base `test`, awaiting `@codex review`)
**ADO:** 533 → **Review** state (AC verification comment posted)
**Prior context:** ADO-532 (gold set) shipped; clustering-quality plan Part 2 is the design of record.

## What shipped this session

Layer-2 **Clustering Judge** infrastructure — the LLM repair pass that merges same-event story
fragments (the July 4th "Salute to America 250" speech fragmented into 5 stories). **Build + dry-run
only. No live merges, nothing scheduled.** Session 2 does the cron + live auto-merge.

1. **`migrations/100_clustering_judge.sql`**
   - `clustering_judge_log` (verdict audit table + admin tab source; RLS on, no anon grant).
   - Re-adds `stories.merged_into_story_id` + `status='merged_into'` (orig migrations 025/027, which
     migration **055** had dropped — so they were absent on TEST; re-declared with the exact old DDL).
   - `merge_stories(p_loser_id, p_survivor_id)` — atomic, idempotent, never deletes: repoint
     `article_story` → survivor, recompute survivor centroid/entity_counter/top_entities **server-side**
     (reuses the `recompute_story_centroids` AVG recipe from migration 022_1, scoped to the survivor),
     recount `source_count`, widen time span, tombstone loser.
   - `get_clustering_judge_candidates(p_min_sim=0.83, p_days=7, p_max_pairs=30)` — recall-first
     candidate generator.
   - Both RPCs `SECURITY DEFINER` + locked `search_path` + EXECUTE revoked from PUBLIC/anon/authenticated,
     granted only to `service_role` (migration 095 pattern).
2. **Edge functions** exclude merged-state stories: `stories-active`/`-search` guards; `stories-detail`
   **multi-hop** tombstone redirect to the terminal survivor (loop + cycle guard — a code-review fix).
   `stories-search` also narrowed off `select('*')` (dropped the ~6KB centroid vector, egress rule #11).
3. **`docs/features/clustering-judge/{plan.md, prompt-v1.md}`** — prompt encodes Josh's binding merge
   ruling (same-cycle reactions/commentary ⇒ merge; chain-of-events beats ⇒ keep; default DENY), fetches
   member ARTICLE titles not just `primary_headline`, and is dry-run-safe (`JUDGE_DRY_RUN` default true).
4. **`scripts/evals/judge-dryrun.js`** — offline verdict scorer vs the gold set. **30/30** agreement
   (July 4th `story_story` cluster 10/10 merged; chain-of-events `article_story` pairs incl. gs-168,
   gs-189 kept separate). `--insert` seeds `clustering_judge_log` on TEST once the migration is applied.
5. **Admin "Judge" tab** — `admin.html` `JudgeTab` + `admin-judge-log` edge function (service_role,
   password-gated, mirrors the Skips tab). Headlines A vs B side-by-side, filter by verdict + source.

## Verification done
- Two-pass code review (feature-dev + production-readiness). All findings applied or documented.
- `npm run qa:smoke` green (incl. clustering-eval-fidelity drift tripwire).
- Dry-run 30/30 vs gold set.

## Decisions / deviations (for reviewer awareness)
- **D1 — candidate RPC is recall-first** (centroid-only gate; entity/slug are context, not a hard `AND`):
  the plan's literal "AND ≥1 shared non-stopword entity" would exclude the flagship July 4th cluster,
  which shares only the `US-TRUMP` stopword / `LOC-DC` and has no overlapping topic slugs. At 0.83, 9 of
  10 pairs surface directly; the 10th (gs-204, 0.8227) still collapses via merge-chaining through anchor
  story 12118. **Confirm / possibly lower to ~0.82 before session 2 live.**
- **D2 — admin tab via edge function** (not direct anon PostgREST): matches the Skips-tab exemplar +
  migration-046 posture; no anon grant on `clustering_judge_log`.
- **D4 — survivor = older story** (deterministic; keeps the original id/URL stable).

## ⚠️ Gotchas hit this session (reusable)
1. **Supabase SQL Editor "Enable RLS" helper mangles functions with `%ROWTYPE` vars.** It mis-detected
   `v_loser stories%ROWTYPE` / `v_surv stories%ROWTYPE` DECLARE variables as *new tables* and injected
   `ALTER TABLE v_loser ENABLE ROW LEVEL SECURITY;` **into the middle of the function body**, breaking the
   `$$` dollar-quote (`unterminated dollar-quoted string`). Fix: use scalar variables, not `%ROWTYPE`, in
   functions you'll paste into the dashboard. And decline the dashboard's "Enable RLS" suggestion when the
   migration already handles RLS.
2. **`x <> ALL((SELECT arr FROM t))` fails** with `operator does not exist: text <> text[]` — the subquery
   is read as a set of rows (each `text[]`). Fix: `CROSS JOIN t` and use the array-column form
   `x <> ALL(t.col)`.
3. **Migration 100 was applied to PROD by mistake** (meant for TEST). Harmless — dormant additive infra,
   RPCs service_role-locked, nothing calls them. PROD is now slightly ahead; the eventual promotion PR
   need not re-run it (idempotent if it does).

## NEXT (remaining to close session 1)
1. **Apply `migrations/100_clustering_judge.sql` to TEST** (Supabase SQL Editor; decline any "Enable RLS"
   prompt). Run the 3 verification queries at the bottom of the file.
2. **Also on PROD: run verification query #2** to confirm the two RPCs came out `service_role`-only.
3. **Deploy 4 edge functions to TEST** (after the TEST migration):
   `npx supabase functions deploy stories-active stories-detail stories-search admin-judge-log --project-ref wnrjrywpcadwutfykflu`
   (deploy them one per command per the CLI). Migration MUST precede this or `stories-active` errors on
   the missing column.
4. **Seed the Judge tab:** `node scripts/evals/judge-dryrun.js --insert` (local .env → TEST), then check
   the admin Judge tab renders the 30 dry-run rows.
5. **Codex review PR #106**, apply feedback, merge to `test` (`gh pr merge --squash`).

## Session 2 (separate ticket-work, deferred)
RemoteTrigger cron (Sonnet, 3x/day, `0 5,13,21 * * *`); flip `JUDGE_DRY_RUN=false` for live auto-merge
(cap 10/run); live candidate-recall check before enabling; hard merge cap (defense-in-depth); 3-day
monitoring window. All RemoteTrigger/bootstrap gotchas are in the `claude-agent-patterns` memory entity +
`docs/reference/cloud-agent-runbook.md`.

---

## Session 2 starting prompt (paste into `/start-work`)

```
Continue ADO-533: Clustering Judge agent — SESSION 2 (finish session-1 leftovers, then go live).
Read docs/handoffs/2026-07-06-ado-533-clustering-judge-session1.md and
docs/features/clustering-judge/{plan.md,prompt-v1.md} first. Session 1 (build + dry-run) shipped in
PR #106 (Codex-clean); migration 100 is already on PROD. The Judge's merge criteria are DECIDED —
scripts/evals/clustering-gold-set.json meta.verification_status (same-cycle reactions/commentary =>
merge; chain-of-events beats => keep; default DENY). Do not re-litigate.

Phase A — finish session 1 (TEST parity + merge):
1. Apply migrations/100_clustering_judge.sql to TEST via Supabase SQL Editor. DECLINE the dashboard's
   "Enable RLS" suggestion (the migration handles RLS). Run the 3 verification queries at the file
   bottom; confirm RPC grants are anon=f/authenticated=f/service_role=t.
2. Deploy the 4 edge functions to TEST (migration MUST be applied first):
   npx supabase functions deploy stories-active   --project-ref wnrjrywpcadwutfykflu
   npx supabase functions deploy stories-detail    --project-ref wnrjrywpcadwutfykflu
   npx supabase functions deploy stories-search     --project-ref wnrjrywpcadwutfykflu
   npx supabase functions deploy admin-judge-log    --project-ref wnrjrywpcadwutfykflu
3. Seed + verify the admin Judge tab: node scripts/evals/judge-dryrun.js --insert (local .env => TEST),
   then load admin.html Judge tab and confirm the 30 dry-run rows render (headlines A/B, verdicts).
4. Merge PR #106 to test (gh pr merge --squash — merge commits are blocked on this repo).

Phase B — go live (the actual session-2 work):
5. LIVE RECALL CHECK (gate, review-flagged): run get_clustering_judge_candidates() against live PROD
   data (read-only) and confirm it surfaces real same-event fragments at 0.83. If recall is weak,
   lower p_min_sim default to ~0.82 (CREATE OR REPLACE the function; re-apply to TEST+PROD).
6. Add a HARD merge cap (defense-in-depth) — a code/DB guard so a run can't exceed 10 executed merges
   even if the LLM ignores the prompt cap.
7. RemoteTrigger cron: Sonnet, 3x/day, 0 5,13,21 * * * (offset from RSS runs). Bootstrap MUST
   git fetch origin main && git reset --hard origin/main (repo is cached). Set JUDGE_DRY_RUN=false ONLY
   after the dry-run rows + recall check look right. All RemoteTrigger request-shape / bootstrap gotchas
   are in the claude-agent-patterns memory entity + docs/reference/cloud-agent-runbook.md.
8. 3-day PROD monitoring window (ADO-528 playbook) — watch clustering_judge_log via the admin Judge tab
   for wrong merges (reversible via tombstone) before declaring done. Update ADO-533; /end-work.

Cost: Judge on Sonnet 3x/day already approved (fraction of Stories agent's 12 runs/day). State any new
AI-call cost. Constraints: test branch, Node only (no Python), PostgREST minimal select= + limit, never
fetch embedding/content client-side (centroid math stays in SQL).
```

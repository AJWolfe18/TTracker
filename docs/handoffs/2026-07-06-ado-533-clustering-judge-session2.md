# Handoff — ADO-533 Clustering Judge, session 2 (hardening + PROD prep, dry-run cron pending)

**Date:** 2026-07-06
**ADO:** 533 → **Active** (go-live not complete: dry-run cron not yet created; 3-day monitoring not started)
**Branches:** `ado-533-clustering-judge` → **PR #106 MERGED to `test`** (squash `a80e8e7`).
`deploy/ado-533-clustering-judge` → **PR #107 OPEN to `main`** (awaiting AI review + Josh merge).
**Prior:** session 1 = build + dry-run (handoff `2026-07-06-ado-533-clustering-judge-session1.md`).

---

## TL;DR — where we stopped

Everything is **verified on TEST and PROD at the DB + edge-function layer.** The only things left are:
merge PR #107, create the dry-run cron, watch one dry-run, then flip to live + 3-day monitoring.
**Nothing auto-merges a PROD story yet** — the Judge cron does not exist yet, and even once created it
runs in dry-run (logs verdicts, never merges) until `JUDGE_DRY_RUN=false` is set in the PROD environment.

## The premise correction that shaped this session

The session-1 handoff said "PR #106 is Codex-clean; apply migration 100 to TEST." Both were wrong:
- **Migration 100 was already on TEST** (someone applied it between sessions). Verified via MCP.
- **PR #106 was NOT Codex-clean** — it had an unaddressed **P1** and **P2**. Fixing those (and everything
  Codex found on the fixes) became the bulk of session 2.

## What shipped (all merged to `test` in #106, staged for PROD in #107)

**Migration `101_clustering_judge_hardening.sql`** (applied + verified TEST **and** PROD):
- P1: `find_similar_stories` re-created with `AND merged_into_story_id IS NULL` (kept the current 048
  11-col signature + 052 search_path + grants — DROP+CREATE, because the first draft wrongly copied the
  stale 026 body; caught in review).
- P2: `merge_stories` recomputes survivor `latest_article_published_at` + unions loser `topic_slugs`.
- Hard cap: `judge_run_merge_count` table.
- Reversibility: `story_merge_audit` table (snapshots loser article ids pre-repoint).

**Migration `102_merge_stories_concurrency.sql`** (applied + verified TEST **and** PROD) — `CREATE OR
REPLACE merge_stories` (3-arg, same sig):
- `FOR UPDATE` row locks (ascending id order) — closes a lost-update race on the tombstone pointer.
- Atomic per-run cap reservation (`INSERT … ON CONFLICT … WHERE merge_count < cap RETURNING`).
- **`p_run_id` REQUIRED** — returns `missing_run_id` (no mutation) if null, so the cap can't be bypassed.
- *(102 was edited twice as Codex found the run_id bypass; each edit was re-applied to TEST. The file in
  git is final. It is idempotent — safe to re-run.)*

**JS (RSS pipeline, to `main` via #107):**
- `candidate-generation.js` — `.is('merged_into_story_id', null)` on time/entity/slug blocks.
- `hybrid-clustering.js` — the story_hash-collision recovery now follows the tombstone chain to the live
  survivor (was a P1: `merge_stories` never clears the loser's `story_hash`, so a new article could attach
  to a tombstone). Minimal-column walk (no centroid egress).

**Edge functions (deployed to TEST + PROD):** `stories-active`/`-search` (merged-state exclusion),
`stories-detail` (multi-hop tombstone redirect, no fixed hop cap, 404s a broken/cyclic chain),
`admin-judge-log` (service_role, admin Judge tab backend).

**Prompt `prompt-v1.md`:** `merge_stories` call passes `p_run_id`; invariants/metadata updated.

## Verification done (evidence, not assertion)

- **Two internal reviews** (feature-dev + production-readiness) + **5 rounds of Codex**, all resolved.
  Codex trend: real bugs → concurrency → egress → cap-bypass → deep-chain edge → **clean**.
- **`npm run qa:smoke` green** (incl. `clustering-eval-fidelity` drift tripwire — matters, JS changed).
- **End-to-end smoke test on TEST** (real merge, story 16998 → 16981, Colorado primary — a *correct* merge,
  left in place): verified article repoint, centroid/entity recompute, P2 recency+slug, source_count,
  tombstone, `story_merge_audit` snapshot, `judge_run_merge_count` cap counter, idempotency (`skipped`),
  candidate-RPC exclusion, and `stories-detail/16998` → redirects to 16981. Also verified `missing_run_id`
  guard rejects a no-run_id call with no mutation.
- **PROD DB verified** (Josh ran the queries): all 3 tables exist; `merge_stories` pronargs=3 with
  lock+atomic-cap+runid-guard, `anon=f/service_role=t`; `find_similar_stories` excludes tombstones.
- **PROD recall check PASSED** at 0.83 — Fed/Lisa-Cook firing (~4 fragments), birthright SCOTUS (~6),
  Colorado primary, Carroll payout, NATO, Anthropic-limits, Roosevelt library, etc. **Keep p_min_sim=0.83.**
- **4 edge fns live + healthy on PROD** (`stories-active/detail` 200, `admin-judge-log` 401 auth-gated).

## NEXT SESSION — pick up here (go-live, gated)

1. **Merge PR #107 → main** once its AI review is green (`gh pr checks 107`). Puts `prompt-v1.md`, the gold
   set, and the RSS JS on `main` — required before the cron (bootstrap reads `main`).
2. **Create the Judge cron** (config below), then **fire it once** (`RemoteTrigger action=run`) for an
   immediate PROD dry-run.
3. **Eyeball that run's verdicts** in the admin Judge tab (PROD) — needs the admin password.
4. **Flip live:** set `JUDGE_DRY_RUN=false` in the **PROD environment `env_018AS3Shj6wkH624v1nkssG9`**
   (claude.ai → Settings → Environments). Until then, unset = safe dry-run.
5. **3-day PROD monitoring** (ADO-528 playbook) watching `clustering_judge_log` via the Judge tab for wrong
   merges (reversible: tombstone + `story_merge_audit` snapshot). Then close AC + `/end-work`.

### Judge cron config (create via `RemoteTrigger action=create`, modeled on the Stories PROD trigger)

- **name:** `Clustering Judge Agent (PROD)` · **cron_expression:** `0 5,13,21 * * *` (offset from RSS `:30`)
- **model:** `claude-sonnet-5` · **persist_session:** false · **mcp_connections:** `[]`
- **environment_id:** `env_018AS3Shj6wkH624v1nkssG9` (PROD; provides SUPABASE_URL + SERVICE_ROLE_KEY)
- **session_context:** allowed_tools `["Bash","Read","Grep","Glob","Write","Edit"]`, cwd `/home/user/TTracker`,
  sources git_repository `https://github.com/AJWolfe18/TTracker`
- **events[].data.message.content (uuid `clustering-judge-prod-v1`):** Steps A–D bootstrap — `git fetch
  origin main && git checkout main && git reset --hard origin/main` → `ls -la
  docs/features/clustering-judge/prompt-v1.md` → Read it → follow Sections 0–7. Note in the message that
  SUPABASE_URL/SERVICE_ROLE_KEY are set and `JUDGE_DRY_RUN` is intentionally unset (fail-safe dry-run).

## Gotchas / decisions worth keeping

- **Append-only migrations, mostly:** 101 created new objects; 102 owns the `merge_stories` body. When
  Codex found the run_id bypass, I **edited 102 (not a 103)** because a third full transcription of that big
  function is itself an error risk, and 102 wasn't on PROD yet — but that meant **re-applying 102 to TEST**.
  Lesson: once a same-session migration is only on TEST and not merged, editing + re-applying beats stacking
  another full-function copy; once it's on PROD, it's immutable → new migration.
- **`stories-detail` takes the id as a PATH segment** (`/stories-detail/16998`), not `?id=`. `?id=` returns
  "Story not found" (it reads `pathParts[last]` first). Cost me a false-alarm debugging detour.
- **Live-story gating is inconsistent** (candidate-gen filters `lifecycle_state`; enrichment/edge filter
  `status`) — the P1 tombstone bug came from that split. Follow-up ticket suggested: a canonical
  `stories_live` predicate/view (`lifecycle_state IN (...) AND merged_into_story_id IS NULL`). Do NOT try to
  fix it by mutating a tombstone's `lifecycle_state` — the lifecycle recompute job would churn it back.
- **Dry-run needs no env config** (prompt fail-safe = unset → dry-run); the live flip is one env var.
- Running tally of every PROD artifact: `docs/features/clustering-judge/prod-deployment-manifest.md`.

## Cost
$0 spent this session (no live model calls; the smoke test was a SQL RPC). Live cron = Sonnet 3×/day,
already approved 2026-07-05. No new secrets.

---

## Session 3 starting prompt (paste into `/start-work`)

```
Continue ADO-533: Clustering Judge — SESSION 3 (go live). Read
docs/handoffs/2026-07-06-ado-533-clustering-judge-session2.md first (esp. "NEXT SESSION — pick up here"
+ the Judge cron config). Everything is verified on TEST + PROD at the DB/edge-fn layer; migrations
100/101/102 are on both, PROD recall passed at 0.83, PR #106 is merged to test. Do NOT re-litigate the
merge criteria or re-review the migrations — they're done. Nothing auto-merges a PROD story until step 4.

1. Merge PR #107 → main once its AI review is green (gh pr checks 107; gh pr merge 107 --squash — merge
   commits are blocked on this repo). Puts prompt-v1.md + gold set + RSS JS (candidate-generation.js,
   hybrid-clustering.js) on main — required before the cron bootstraps from main.
2. Create the Judge cron via RemoteTrigger action=create using the config in the handoff (name
   "Clustering Judge Agent (PROD)", cron 0 5,13,21 * * *, model claude-sonnet-5, environment_id
   env_018AS3Shj6wkH624v1nkssG9, bootstrap reads docs/features/clustering-judge/prompt-v1.md from main).
   Then RemoteTrigger action=run for one immediate PROD dry-run (JUDGE_DRY_RUN unset = dry-run: logs
   verdicts, never merges).
3. Eyeball that run's verdicts in the admin Judge tab (PROD) — needs the admin password. Confirm
   same-event => merge, chain-of-events => keep before going live.
4. GO LIVE (Josh sign-off): set JUDGE_DRY_RUN=false in the PROD environment env_018AS3Shj6wkH624v1nkssG9
   (claude.ai -> Settings -> Environments). Only change that enables real merges.
5. 3-day PROD monitoring (ADO-528 playbook) watching clustering_judge_log via the Judge tab for wrong
   merges (reversible via tombstone + story_merge_audit). Verify ADO-533 AC, then close + /end-work.

Constraints: test branch for code; Node only; PostgREST minimal select= + limit; never fetch
embedding/content client-side. Cost: Sonnet 3x/day already approved, $0 otherwise.
```

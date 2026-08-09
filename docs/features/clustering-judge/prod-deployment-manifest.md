# Clustering Judge — PROD Deployment Manifest (ADO-533)

**Purpose:** the single running tally of *everything* that must reach PROD for the Clustering Judge to go
live safely, and the order to do it in. This feature spans SQL + backend JS + edge functions + frontend +
an agent prompt + a cron — easy to half-deploy and corrupt clusters. Keep this checklist current as items
land. **Status of each item lives here; overall story status lives in ADO-533.**

**Hard ordering gate (from production review, 2026-07-06):** apply the SQL, land the JS on `main`, deploy
the edge functions, and land the agent prompt on `main` — **all before enabling the Judge cron.** The cron
is the *last* thing turned on. Then run the cron once in **dry-run against PROD**, confirm log rows in the
admin Judge tab, and only then flip `JUDGE_DRY_RUN=false`. Nothing auto-merges a PROD story until that flip.

**Cost:** $0 new infra/API spend to deploy. Live cron = Claude Sonnet 3x/day (already approved 2026-07-05),
rides existing cloud-agent infra, no new secrets.

---

## 1. Database (Josh runs in PROD Supabase SQL Editor — I cannot run raw SQL on TTracker)

| # | Artifact | PROD status | Action |
|---|----------|-------------|--------|
| 1.1 | `migrations/100_clustering_judge.sql` | ✅ **Already on PROD** (applied early by mistake; dormant, service_role-locked) | None — idempotent if re-run. Do NOT worry it's "ahead." |
| 1.2 | `migrations/101_clustering_judge_hardening.sql` | ✅ TEST · ✅ **PROD verified applied** (ADO-537 Task 7 Step 0, 2026-08-04: `story_merge_audit` + `judge_run_merge_count` exist, `merge_stories` is 3-arg) | None. |
| 1.3 | `migrations/102_merge_stories_concurrency.sql` | ✅ TEST · ✅ **PROD verified applied** (same check: `has_102 = true`, FOR UPDATE present) | None. |
| 1.4 | `migrations/104_manual_merge_source.sql` | ✅ TEST · ✅ **PROD applied 2026-08-05** (source CHECK verified: `inline/judge-agent/manual`) | None. |
| 1.5 | `migrations/105_unmerge_story.sql` | ✅ TEST · ✅ **PROD applied 2026-08-05** (`unmerged_at` column, verdict CHECK gains `unmerge`, RPC grants anon=f/auth=f/service_role=t, lock fix present) | None. |
| 1.6 | `migrations/106_judge_verdict_memory.sql` (ADO-539) | TEST has the PRE-Codex version (no `evidence_as_of`) — **re-apply the current file on TEST** · ❌ PROD | Apply on both. Verify: `idx_judge_log_pair_live` exists, `clustering_judge_log.evidence_as_of` column exists, `get_clustering_judge_candidates` is still 1 row. Re-run security advisor (SECURITY DEFINER house rule) + `EXPLAIN ANALYZE` the RPC on PROD (LATERAL hoist unmeasured there). |
| 1.7 | `migrations/107_unmerge_logs_atomically.sql` (ADO-539, Codex PR #113 P1) | ❌ TEST · ❌ PROD | Apply on both, **before** redeploying `admin-judge-merge` (see §3). `unmerge_story` now writes its own `'unmerge'` judge-log row in-transaction — that row is verdict memory; losing it let the Judge re-merge a human unmerge. |

**⚠️ ADO-539 LOAD-BEARING ORDER: apply 106 (current file) + 107 on PROD BEFORE merging PR #113 to
`main`.** The Judge cron is LIVE off `main` (rows 6.x) and its bootstrap hard-resets to `origin/main` —
the first run after the merge uses prompt v1.1, which sends `evidence_as_of` in every Step 6 pair row.
If PROD lacks the column, PostgREST rejects the WHOLE row (PGRST204): executed merges go unlogged
(invariant 1 broken), no verdict memory is written, and the Step 7 Discord digest re-reads an empty run.
Migrations-first is safe in the other direction — old prompt rows simply leave `evidence_as_of` NULL.
Same on TEST: re-apply current 106 (+107) before any manual TEST Judge run. If migrations can't be
applied promptly, pause the Judge cron trigger instead.

**101 changes (why it's required before go-live):**
- `find_similar_stories` RPC + `merge_stories` RPC replaced; new tables `judge_run_merge_count`,
  `story_merge_audit`.
- Fixes P1 (tombstones were visible to live clustering), P2 (survivor recency/slugs), adds the DB-side
  hard merge cap (10/run) and the loser-membership snapshot for reversibility.

**102 changes (Codex review of the 101 commit — apply before go-live):**
- `merge_stories` concurrency hardening: `FOR UPDATE` row locks (deterministic id order) to close a
  lost-update race on the tombstone pointer; atomic per-run cap reservation (`ON CONFLICT … WHERE
  merge_count < cap RETURNING`) so parallel same-run calls can't exceed the cap. Same 3-arg signature,
  so it's a `CREATE OR REPLACE` (no DROP, grants persist).
- Paired JS fix (`hybrid-clustering.js`, item 2.2): the tombstone-redirect walk now uses minimal columns
  (no centroid egress).

---

## 2. Backend JS (reaches PROD when merged to `main`; RSS workflows run from `main` every 2h)

| # | File | Change | Status |
|---|------|--------|--------|
| 2.1 | `scripts/rss/candidate-generation.js` | Exclude merged tombstones in time/entity/slug candidate blocks (P1) | ✅ On `main` |
| 2.2 | `scripts/rss/hybrid-clustering.js` | story_hash-collision recovery follows tombstone → survivor redirect (P1 sibling path) | ✅ On `main` |

These two MUST be on `main` before the cron flips live, or the P1 hole stays half-open (a new article
could re-attach to a tombstone via the ANN block or the hash-collision path).

---

## 3. Edge functions (deploy to PROD ref `osjbulmltfpcoldydexg`)

| # | Function | Change | TEST | PROD |
|---|----------|--------|------|------|
| 3.1 | `stories-active` | exclude merged-state stories | ✅ | ✅ deployed 2026-07-06 (v8, `functions list`) |
| 3.2 | `stories-detail` | multi-hop tombstone → survivor redirect | ✅ | ✅ deployed 2026-07-06 (v9) |
| 3.3 | `stories-search` | exclude `status='merged_into'`; narrowed select | ✅ | ✅ deployed 2026-07-06 (v8) |
| 3.4 | `admin-judge-log` | service_role backend for the admin Judge tab; ADO-537 adds `unmerge` verdict + `story_id` search | ✅ | ✅ deployed 2026-08-05 (v2) |
| 3.5 | `admin-judge-merge` | NEW (ADO-537) — manual merge + unmerge, password-gated | ✅ | ✅ deployed 2026-08-05 (v1) |
| 3.6 | `admin-judge-merge` (ADO-539 update) | Drops its best-effort unmerge log insert — `unmerge_story` logs atomically (migration 107). Deploy AFTER 107 on each env; between 107 and this deploy, unmerges double-log (harmless, cosmetic). | ❌ redeploy needed | ❌ redeploy needed |

Deploy: `npx supabase functions deploy <fn> --project-ref osjbulmltfpcoldydexg` (migration 100 must be
applied first — it is, on PROD). TEST ref is `wnrjrywpcadwutfykflu`.

**ADO-537 manual-merge PROD ordering (load-bearing, in this order):**
1. Apply migration **104** (adds `'manual'` to the `clustering_judge_log` source CHECK)
2. Deploy `admin-judge-merge` AND **redeploy `admin-judge-log`** (its `VALID_SOURCES` gained `'manual'`)
3. Ship `admin.html`
Violating 1→2: manual merges execute but their Judge-tab log row fails the CHECK (audit only in
`story_merge_audit`). Violating 2→3: the tab's `manual` source filter is silently ignored (returns all sources).

---

## 4. Frontend (Netlify — deploys on `main` merge)

| # | File | Change | Status |
|---|------|--------|--------|
| 4.1 | `public/admin.html` | Judge tab (headlines A/B, verdict/source filters); ADO-537 adds Manual Merge card, unmerge button, story-id search | ✅ On `main` (PR #109 squash `6868a06`, 2026-08-05; live on trumpytracker.com) |

---

## 5. Agent files read from `main` at cron runtime (bootstrap does `git reset --hard origin/main`)

| # | File | Why | Status |
|---|------|-----|--------|
| 5.1 | `docs/features/clustering-judge/prompt-v1.md` | The Judge prompt (now passes `p_run_id` to activate the hard cap) | ✅ On `main` |
| 5.2 | `scripts/evals/clustering-gold-set.json` | Binding merge ruling referenced by the prompt | ✅ already on `main` (ADO-532) — confirm |

`scripts/evals/judge-dryrun.js` is a TEST seeding/eval script — **not run on PROD**; no deployment concern.

---

## 6. Cron / infra — ENABLE LAST

| # | Item | Status |
|---|------|--------|
| 6.1 | RemoteTrigger cron: Sonnet, `0 5,13,21 * * *` (offset from RSS), bootstrap `git fetch origin main && git reset --hard origin/main` | ✅ live (`trig_01DDXZkpC9PkgTzU8wDdL9QM`) |
| 6.2 | Cron env: `SUPABASE_URL`=PROD, `SUPABASE_SERVICE_ROLE_KEY`=PROD, `JUDGE_DRY_RUN=true` first | ✅ |
| 6.3 | Verify one PROD dry-run's rows in admin Judge tab, then flip `JUDGE_DRY_RUN=false` | ✅ live-merging since 533 go-live |
| 6.4 | 3-day PROD monitoring window (ADO-528 playbook) watching `clustering_judge_log` for wrong merges | ✅ closed clean with ADO-533 |

**ADO-537 note (2026-08-05):** during the unmerge PROD proof both jobs were paused and re-enabled same
night (Judge cron + `ENABLE_PROD_SCHEDULES`). PROD round trip on pair 13324/13327: merge → unmerge
(snapshot 152 consumed, article restored) → re-merge (fresh snapshot 153); end state verified identical,
`source_count` matches actual membership on both survivors.

No new secrets. Kill switch = disable the cron.

---

## 7. Promotion PR notes

- This does **not** follow the clean "cherry-pick test→main" story because migration 100 is already on
  PROD. The promotion PR need not re-run 100 (idempotent if it does). 101 is new to PROD.
- `.claude/test-only-paths.md`: `judge-dryrun.js` and any TEST seed rows are test-only; the migration +
  RPC + JS + edge fns + admin.html + prompt are all PROD-bound.

---

## 8. Deferred / follow-up (not blocking go-live)

- **Canonical `stories_live` predicate/view** (`lifecycle_state IN (...) AND merged_into_story_id IS NULL`).
  The codebase gates "live" inconsistently — candidate-gen uses `lifecycle_state`, enrichment/edge use
  `status` — so future code filtering only on `lifecycle_state` could silently re-expose tombstones. New
  ticket. (Column-level exclusion in 101 is the correct fix for now; do NOT mutate `lifecycle_state` — the
  lifecycle recompute job would churn it back anyway.)
- **Retention** on `judge_run_merge_count` / `story_merge_audit` (prune old rows). Negligible volume; optional.
- `merge_stories` does not recompute `search_vector` on the survivor (editorial; the enrichment agent
  rebuilds it within ~12h). By design.

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
| 1.2 | `migrations/101_clustering_judge_hardening.sql` | ⬜ **Not applied** | Apply to PROD. Decline the dashboard "Enable RLS" suggestion (migration handles RLS). Then run the 4 verification queries at file bottom. |

**101 changes (why it's required before go-live):**
- `find_similar_stories` RPC + `merge_stories` RPC replaced; new tables `judge_run_merge_count`,
  `story_merge_audit`.
- Fixes P1 (tombstones were visible to live clustering), P2 (survivor recency/slugs), adds the DB-side
  hard merge cap (10/run) and the loser-membership snapshot for reversibility.

---

## 2. Backend JS (reaches PROD when merged to `main`; RSS workflows run from `main` every 2h)

| # | File | Change | Status |
|---|------|--------|--------|
| 2.1 | `scripts/rss/candidate-generation.js` | Exclude merged tombstones in time/entity/slug candidate blocks (P1) | ⬜ On `main` |
| 2.2 | `scripts/rss/hybrid-clustering.js` | story_hash-collision recovery follows tombstone → survivor redirect (P1 sibling path) | ⬜ On `main` |

These two MUST be on `main` before the cron flips live, or the P1 hole stays half-open (a new article
could re-attach to a tombstone via the ANN block or the hash-collision path).

---

## 3. Edge functions (deploy to PROD ref `osjbulmltfpcoldydexg`)

| # | Function | Change | TEST | PROD |
|---|----------|--------|------|------|
| 3.1 | `stories-active` | exclude merged-state stories | ⬜ | ⬜ |
| 3.2 | `stories-detail` | multi-hop tombstone → survivor redirect | ⬜ | ⬜ |
| 3.3 | `stories-search` | exclude `status='merged_into'`; narrowed select | ⬜ | ⬜ |
| 3.4 | `admin-judge-log` | NEW — service_role backend for the admin Judge tab | ⬜ | ⬜ |

Deploy: `npx supabase functions deploy <fn> --project-ref osjbulmltfpcoldydexg` (migration 100 must be
applied first — it is, on PROD). TEST ref is `wnrjrywpcadwutfykflu`.

---

## 4. Frontend (Netlify — deploys on `main` merge)

| # | File | Change | Status |
|---|------|--------|--------|
| 4.1 | `public/admin.html` | Judge tab (headlines A/B, verdict/source filters) | ⬜ On `main` |

---

## 5. Agent files read from `main` at cron runtime (bootstrap does `git reset --hard origin/main`)

| # | File | Why | Status |
|---|------|-----|--------|
| 5.1 | `docs/features/clustering-judge/prompt-v1.md` | The Judge prompt (now passes `p_run_id` to activate the hard cap) | ⬜ On `main` |
| 5.2 | `scripts/evals/clustering-gold-set.json` | Binding merge ruling referenced by the prompt | ✅ already on `main` (ADO-532) — confirm |

`scripts/evals/judge-dryrun.js` is a TEST seeding/eval script — **not run on PROD**; no deployment concern.

---

## 6. Cron / infra — ENABLE LAST

| # | Item | Status |
|---|------|--------|
| 6.1 | RemoteTrigger cron: Sonnet, `0 5,13,21 * * *` (offset from RSS), bootstrap `git fetch origin main && git reset --hard origin/main` | ⬜ |
| 6.2 | Cron env: `SUPABASE_URL`=PROD, `SUPABASE_SERVICE_ROLE_KEY`=PROD, `JUDGE_DRY_RUN=true` first | ⬜ |
| 6.3 | Verify one PROD dry-run's rows in admin Judge tab, then flip `JUDGE_DRY_RUN=false` | ⬜ |
| 6.4 | 3-day PROD monitoring window (ADO-528 playbook) watching `clustering_judge_log` for wrong merges | ⬜ |

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

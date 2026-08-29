# Handoff: ADO-570 — Homepage cold-load fix (precomputed Tracker main line + tally)

**Date:** August 29, 2026 · **Branch:** test · **Commits:** `9da2ae5` (type labels), `4cb1d74`/`5f98918` (plan), `78d0329` (build) · **ADO:** 570 → Testing (child of Epic 543)

## Why this session existed

Josh: the homepage still took 10s+ on his first visit of the day, after ADO-568 had already cut first paint to 0.9s. Systematic debugging (no fixes before root cause) found:

| Boot request (PROD) | Cold | Warm |
|---|---|---|
| `v_tracker_stories?main_line=is.true&limit=60` (spine) | **2.2s** | 0.22s |
| `HEAD v_tracker_stories count=exact` ("Developments logged") | **2.1s** | 0.23s |
| everything else (HTML, SCOTUS, EOs, pardons, pins) | 0.1–0.3s | 0.1s |

- `main_line` was a CASE + window function inside the migration-112 view, evaluated across all **14,206** active PROD stories on every page load, three times per visit. Not indexable.
- PROD has 0 closed stories (the 72h closer died with the legacy job-queue worker) — but closing is NOT the fix: the Tracker is a full-term record and the view filters `status='active'`.
- A 20-minute probe proved the cold path is the **normal** state on PROD's nano instance: `0.36, 0.22, 2.69, 1.55, 1.79s` with no pipeline run in between. Cache evicts on its own.
- The "Developments logged" tile was built from 9 HEAD requests and only rendered when all four totals resolved — Josh's "it was gone a second ago" was exactly that.

## What shipped (all on `test`, migration applied on TEST)

**One rule, one place, one refresh** — plan: `docs/features/events-tracker/plan-tracker-precompute.md`

1. **Migration 113** (`migrations/113_tracker_precompute.sql`, manual SQL editor):
   - `stories.main_line` stored flag + partial index with INCLUDE → index-only scan
   - `tracker_stats` one-row tally table (anon SELECT, explicit grant + RLS)
   - `v_tracker_main_line_rule` = the ONLY definition of rule v1.1 (explicit publish gate, because the refresh bypasses RLS)
   - `refresh_tracker_derived()` = dumb applier (changed rows only) + tally upsert
   - `v_tracker_stories` rewritten: same name/columns the frontend uses, reads the stored flag, plain front join
2. **`scripts/maintenance/refresh-tracker.js`** — one shared refresh, wired as the `if: always()` last step of all five pipeline workflows (RSS prod/test, SCOTUS, pardons, EO). Never fails the run; writes `pipeline_skips` (`TRACKER_REFRESH` / `REFRESH_FAILED`) on error.
3. **`fetchTrackerTally`** — one GET on `tracker_stats` instead of 9 HEADs; 3 unit tests.
4. Fronts seed SQL calls the refresh; ADO-547 carries the "call the RPC after pin/front writes" note.
5. Also: entry type labels (Story / EO / Decision / Pardon) in every spine row's date line (`9da2ae5`) — Josh's ask, awaiting his reaction; "Decision" vs "Ruling" open.

## Verification done on TEST

- Anon parity: 209/209 main-line ids identical before/after; first 180 spine rows byte-identical.
- Tally: 1,015 = 675 + 30 + 217 + 93 via the old 9-request method; open_fronts 7.
- Anon gets 401 on the rule view and on the RPC.
- EXPLAIN (as anon): **Index Only Scan, 60 rows, no Sort node, 0.28ms** — vs full scan + top-N sort before.
- `node scripts/maintenance/refresh-tracker.js` → `rows_changed=0 took_ms=12`.
- tsc clean, vitest 177/177, `npm run qa:smoke` exit 0.

## Gotchas learned (also in memory `supabase-sql-gotchas`)

- First TEST apply failed atomically: plpgsql variable `term` collided with a table column (42702 at runtime). Vars are now `v_`-prefixed. Use the committed file verbatim on PROD.
- **Index predicate must be `main_line IS TRUE`**, not bare `main_line` — PostgREST emits `IS TRUE` and the planner never chose the index otherwise (confirmed with `enable_seqscan=off`).
- No SQL-exec RPC on TEST/PROD; DDL goes through the dashboard SQL editor (drove it via Chrome: `monaco.editor.getModels()[0].setValue(sql)` + Run + confirm dialog). The claude.ai Supabase MCP only sees WhiskeyPal. A Chrome tab (`704243986`) was left open in the MCP group when close timed out — harmless.
- Review: no review agents were spawned (Josh's token rule) — inline two-pass self-review instead; findings folded into the plan before building.

## Next session

1. Josh eyeballs the TEST homepage: tally on first paint, type labels wording.
2. **PROD deploy, in this order** (AC 8): apply migration 113 between pipeline runs → `SELECT * FROM refresh_tracker_derived(); ANALYZE public.stories;` → cherry-pick `9da2ae5` + `78d0329` (+ docs commits) to a deployment branch → PR → verify AC 3 (median of 5 curl samples within 2 min of a PROD run, both requests < 300ms) → Josh confirms first-of-day load → Close 570.
3. Then per memory: ADO-566 social planning (needs Josh's D1–D6), alerts discussion, 561 → 562. ADO-564 due September 7, 2026.

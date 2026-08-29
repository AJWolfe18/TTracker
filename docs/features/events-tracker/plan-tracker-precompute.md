# Plan: Precompute the Tracker main line + tally (homepage cold-load fix)

**Status lives in ADO** (card linked below). This doc holds the implementation design only.
**Card:** ADO-570 · **Parent:** Epic 543 (Events Tracker) · **Related:** ADO-568 (first paint, Closed), ADO-554 (main line rule)

## 1. Problem (evidence, August 29, 2026)

The homepage (The Tracker) computes "is this story on the main line?" for **every active story on every page load**, three times per visit:

| Request at boot | What it does on PROD | Cold | Warm |
|---|---|---|---|
| `v_tracker_stories?main_line=is.true&limit=60` | window fn + lateral join over all 14,206 active stories, filter to 1,387, sort, return 60 | **2.2s** | 0.22s |
| `HEAD v_tracker_stories count=exact` (Developments logged) | same full computation, no limit | **2.1s** | 0.23s |
| `HEAD v_tracker_stories ... alarm 5, last 30d count=exact` | same view | 0.15s | 0.14s |
| every other boot request (HTML, SCOTUS, EOs, pardons, pins) | indexed reads | 0.1–0.3s | 0.1s |

- `main_line` is a CASE expression inside `v_tracker_stories` (migration 112). Postgres cannot index it, so the 60-row page costs a full scan of the view.
- PROD has **0 closed stories** (the 72h closer died with the legacy `job-queue-worker.js`). Closing is NOT the fix: the Tracker is a full-term record and the view filters `status='active'`.
- PROD is a nano instance (~0.5GB RAM). Each RSS/enrichment run evicts the stories pages, so the first visitor after a run pays disk-read cost on all three requests. Josh reports 10s+ first loads; lab measures 2s per request cold, worse under I/O contention during a run.
- The "Developments logged" tile is built from **9 HEAD count requests** and only renders when all 4 per-source totals resolve. One slow/failed count = tile missing until reload (the "it was gone a second ago" symptom).

## 2. Design principle (long-term maintainability)

**One rule, one place, one refresh.** The main-line rule moves out of the read path into a single SQL function. Everything the homepage reads is either a stored column with an index or a one-row stats table. Nothing on the request path scales with table size.

Non-goals: no new services, no cron, no caching layer, no frontend rule logic. $0.

## 3. Changes

### Migration 113 — `113_tracker_precompute.sql` (manual SQL editor, TEST then PROD)

1. `ALTER TABLE stories ADD COLUMN main_line BOOLEAN NOT NULL DEFAULT false` (+ `COMMENT` pointing here).
2. Partial index for the spine page: `(first_seen_at DESC, id DESC) WHERE main_line AND status='active' AND summary_neutral IS NOT NULL`.
3. `tracker_stats` single-row table: `id smallint PK CHECK (id=1)`, `developments int`, `alarm5_last30 int`, `open_fronts int`, `refreshed_at timestamptz`. Anon SELECT; service_role write.
4. `refresh_tracker_derived()` SQL function (SECURITY DEFINER, service_role-only EXECUTE):
   - Computes the rule v1.1 exactly as the 112 CASE (pins override → loose end alarm 5 → front opening / alarm 5 / new peak ≥4) into a temp result, then `UPDATE stories SET main_line = x WHERE main_line IS DISTINCT FROM x` (touches only changed rows → cheap, no bloat).
   - Upserts `tracker_stats` from the same per-source counts `fetchTrackerTally` does today (4 totals + 4 alarm-5-last-30d + open fronts).
   - Returns `(rows_changed int, took_ms int)` for logging.
5. `v_tracker_stories` rewritten: same name and columns, but `main_line` = `s.main_line` and front name/slug via a plain `story_event → events` join (no window function). Spine frontend needs **no change** — `main_line=is.true` now hits the partial index.
6. Keep the old CASE as `v_tracker_main_line_rule` (view, service_role only) so the parity check in §5 and future rule edits have one canonical definition the function reads from. The function and the rule view are the only two places the rule exists.

### Pipeline — `scripts/rss-tracker-supabase.js`

- Last step of every run (after enrichment): `await supabase.rpc('refresh_tracker_derived')`, log `rows_changed`/`took_ms`. Wrap in try/catch: a refresh failure must not fail the run (stale-but-present beats missing). Record a `pipeline_skips` row on failure (ADO-466 rule).

### Admin / seed paths

- `scripts/maintenance/2026-08-24-ado-554-prod-fronts-seed.sql`: append `SELECT refresh_tracker_derived();` at the end.
- ADO-547 pin/front editor: call the RPC after any pin or assignment write (note on that card).

### Frontend — `src/lib/timeline.ts`

- `fetchTrackerTally` → one `GET tracker_stats?select=developments,alarm5_last30,open_fronts&id=eq.1` (replaces 9 HEAD requests). Keep the return shape; keep null-tolerance so a missing row hides tiles rather than crashing.
- `fetchTrackerPage` unchanged.

## 4. Accepted trade-offs (state these on the card)

- Freshness: a story becomes main-line / counted at the end of the run that ingested it (seconds later, same run), not the instant its row exists. Admin front/pin edits need the RPC call (one line) or wait for the next run.
- Storage: one boolean column + one tiny table. Egress unchanged (spine response is the same 14KB; tally goes from 9 headers to one ~80-byte body).

## 5. Verification (TEST, then PROD after migration)

1. Parity, before switching the view: `SELECT count(*) FROM v_tracker_main_line_rule r JOIN stories s USING (id) WHERE r.main_line IS DISTINCT FROM s.main_line` must be 0 after one `refresh_tracker_derived()`.
2. Spine order/content identical to pre-change for the first 3 pages on the `main` view (diff the 180 ids).
3. `curl -w %{time_starttransfer}` on the three requests in §1: each < 300ms cold (run right after a pipeline run).
4. Tally tile renders on first paint together with the spine; single network request.
5. `npx vitest run` green; `npm run qa:smoke` green.
6. Pipeline run log shows `refresh_tracker_derived rows_changed=N took_ms=M` with M < 2000 on PROD.

## 6. PROD deploy order (same shape as 112)

1. Apply migration 113 on PROD (SQL editor). Old frontend keeps working: view name/columns unchanged, `main_line` column defaults false → **run `SELECT refresh_tracker_derived();` immediately after** or the spine is empty until the next pipeline run.
2. Cherry-pick pipeline + frontend commits to the deployment branch → PR → merge.
3. Verify §5.3–5.4 on trumpytracker.com.

## 7. Rollback

Re-run the migration-112 `CREATE OR REPLACE VIEW v_tracker_stories` block (restores the computed CASE). Column and stats table can stay; frontend tally change reverts with the commit.

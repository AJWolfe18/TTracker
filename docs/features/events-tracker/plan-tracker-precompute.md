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
2. Partial index for the spine page: `(first_seen_at DESC, id DESC) INCLUDE (primary_headline, alarm_level, severity) WHERE main_line AND status='active' AND summary_neutral IS NOT NULL`. **Predicate must be `main_line IS TRUE`**, not bare `main_line`: PostgREST's `is.true` emits `IS TRUE` and the planner would not prove that against a bare-boolean partial predicate (verified on TEST: index never chosen even with `enable_seqscan=off`; with `IS TRUE` → Index Only Scan, 60 rows, no sort, 0.28ms). INCLUDE makes the 60-row page an **index-only scan**: without it every row still costs a random heap read, which on a cold nano instance is the failure mode being fixed. Front name/slug are 60 PK lookups on the 2K-row `story_event`/`events` tables.
3. `tracker_stats` single-row table: `id smallint PK CHECK (id=1)`, `developments int`, `alarm5_last30 int`, `open_fronts int`, `refreshed_at timestamptz`. RLS on + anon SELECT policy + **explicit `GRANT SELECT TO anon`** (migration 046 auto-revokes anon on new tables); service_role write only. `alarm5_last30` is "as of refreshed_at" - acceptable at several runs/day.
4. `v_tracker_main_line_rule` view = **the only place the rule exists** (rule v1.1 moved verbatim from the 112 CASE: pins override → loose end alarm 5 → front opening / alarm 5 / new peak ≥4). service_role-only SELECT.
   - **RLS requirement:** the refresh runs as SECURITY DEFINER and therefore bypasses the migration-111 publish gates that anon reads inherit today. The rule view MUST filter `events.publish_state = 'published'` explicitly (as the 112 CTE does) so draft-front members stay loose ends. Never rely on RLS inside this view.
5. `refresh_tracker_derived()` SQL function (SECURITY DEFINER, service_role-only EXECUTE) - a dumb applier, no rule logic of its own:
   - `UPDATE stories s SET main_line = r.main_line FROM v_tracker_main_line_rule r WHERE r.id = s.id AND s.main_line IS DISTINCT FROM r.main_line` (touches only changed rows → cheap, no bloat) + flips `main_line=false` on rows that left the rule's scope (closed/unenriched).
   - Upserts `tracker_stats` from the same per-source predicates `fetchTrackerTally` uses today (4 totals + 4 alarm-5-last-30d + open fronts). Predicates are duplicated between this SQL and TS `SPECS` (still used by the spine) - document the mapping in the migration comment; stats are computed in SQL only.
   - Returns `(rows_changed int, took_ms int)` for logging.
6. `v_tracker_stories` rewritten: same name and columns, but `main_line` = `s.main_line` and front name/slug via a plain `story_event → events` join (no window function). Spine frontend needs **no change** — `main_line=is.true` now hits the partial index.
7. First run on PROD is a one-time ~14K-row UPDATE + index build (seconds on nano, brief write lock on `stories`) - apply between pipeline runs, not during one.

### Pipeline — `scripts/rss-tracker-supabase.js`

- Last step of every run (after enrichment): `await supabase.rpc('refresh_tracker_derived')`, log `rows_changed`/`took_ms`. Wrap in try/catch: a refresh failure must not fail the run (stale-but-present beats missing). Record a `pipeline_skips` row on failure via new constants `PIPELINES.TRACKER_REFRESH` / `REASONS.REFRESH_FAILED` in `scripts/lib/skip-reasons.js` (ADO-466 rule, no inline strings).
- Same one-line call at the end of `scotus-tracker.yml`, `pardons-tracker.yml` and the EO fetch scripts - otherwise a new ruling/pardon/EO is missing from "Developments logged" until the next RSS run (hours). Put the call in a shared helper `scripts/lib/refresh-tracker.js` so it is one function, four call sites.

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

1. Parity **as anon, not from the SQL editor** (RLS finding above): snapshot the ids from `v_tracker_stories?main_line=is.true` via PostgREST with the anon key BEFORE applying 113, apply 113 + one refresh, re-fetch the same way; the two id sets must be identical. A service_role-side `count(*) ... IS DISTINCT FROM` check is a useful extra but is not the gate.
2. Spine order/content identical to pre-change for the first 3 pages on the `main` view (diff the 180 ids).
3. `curl -w %{time_starttransfer}` on the spine request and the tally request, 5 samples each taken within 2 minutes after a PROD pipeline run completes (`gh run list --workflow rss-tracker-prod.yml`): median < 300ms for each. Also confirm index-only scan on TEST via `EXPLAIN (ANALYZE, BUFFERS)` (Heap Fetches ≈ 0 after VACUUM).
4. Tally tile renders on first paint together with the spine; single network request.
5. `npx vitest run` green; `npm run qa:smoke` green.
6. Pipeline run log shows `refresh_tracker_derived rows_changed=N took_ms=M` with M < 2000 on PROD.

## 6. PROD deploy order (same shape as 112)

1. Apply migration 113 on PROD (SQL editor), then `SELECT * FROM refresh_tracker_derived(); ANALYZE public.stories;` (new column has no planner stats until ANALYZE; on TEST the migration's own trailing refresh call covers the first refresh). Old frontend keeps working: view name/columns unchanged, `main_line` column defaults false → **run `SELECT refresh_tracker_derived();` immediately after** or the spine is empty until the next pipeline run.
2. Cherry-pick pipeline + frontend commits to the deployment branch → PR → merge.
3. Verify §5.3–5.4 on trumpytracker.com.

## 6a. TEST apply record

Applied on TEST August 29, 2026 via SQL editor. First attempt failed atomically (`42702: column reference "term" is ambiguous` — plpgsql vars now `v_`-prefixed). Verified: anon parity 209/209 ids identical, first 180 spine rows byte-identical, tally 1015 = 675+30+217+93 (old method), open_fronts 7, anon gets 401 on rule view and RPC, `refresh-tracker.js` → `rows_changed=0 took_ms=12`.

## 7. Rollback

Re-run the migration-112 `CREATE OR REPLACE VIEW v_tracker_stories` block (restores the computed CASE). Column and stats table can stay; frontend tally change reverts with the commit.

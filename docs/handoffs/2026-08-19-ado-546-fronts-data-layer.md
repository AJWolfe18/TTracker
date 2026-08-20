# 2026-08-19 — ADO-546: Fronts data layer (migration 111)

**Session type:** Fully autonomous overnight build (Fable), per the plan Fable wrote post-545:
`docs/features/events-tracker/plan-546-fronts-data-layer.md` — executed, not re-designed.
**Deliverable:** PR #119 → test (`ado-546-fronts-data-layer`), @codex review requested.
**ADO:** 546 → Review. AC4/AC6 explicitly open on the card until Josh applies the migration.

## What shipped

1. **`migrations/111_fronts_data_layer.sql` — FILE ONLY, deliberately not executed anywhere.**
   Josh applies it manually in the Supabase SQL Editor on TEST. Contents:
   - `events` / `event_updates` / `story_event` exactly per PRD §6; `story_event.story_id`
     is the sole PK (one front per story — Josh's locked 2026-08-17 decision).
   - CHECK constraints for every §6.6 controlled vocabulary; TIMESTAMPTZ everywhere;
     idempotent (IF NOT EXISTS / drop-then-create / CREATE OR REPLACE — safe to re-run whole).
   - RLS editorial gates mirroring migration 056 (pardons): anon sees published fronts,
     approved updates on published fronts, memberships of published fronts. Writes are
     service_role only. GRANT SELECT TO anon on all three tables + view (the 046 gotcha).
   - `v_event_stats` (security_invoker) — story_count, source_count, update_count,
     last_activity_at, peak_alarm, days_since_update. No stored counters anywhere.
   - `updated_at` triggers reuse `set_updated_at()` (migration 001); `NOTIFY pgrst` at the
     end so the REST schema cache reloads before the anon verification.
2. **`scripts/lib/skip-reasons.js`** — `FRONT_ASSIGNMENT` + `FRONT_UPDATE_DRAFT` pipeline
   constants (Wave 2 agent/drafter will use them; `pipeline_skips.pipeline` is free-form
   TEXT so no DB change was needed).

## Decisions (full log with reversals in the PR #119 body)

The PRD locked the schema; the judgment calls were view semantics and unspecified
nullability/defaults. Highlights: update_count/days_since_update count **approved** updates
only (dormancy rule + §7.3 stale-fronts are defined on approved); last_activity_at =
max member story `last_updated_at` (news-side signal complementing editorial staleness);
source_count = article_story row count across members (house convention from merge_stories);
peak_alarm = COALESCE(alarm_level, migration-064 severity map, 2).

**Two flagged ambiguities Josh should glance at** (PR body "Flagged ambiguities"):
- A1: `reassigned_from_event_id` implemented as FK ON DELETE SET NULL though the PRD listed
  bare BIGINT — one-line reversal if a pure provenance value is preferred.
- A2: `merge_stories` doesn't repoint `story_event`; a member story merged away leaves the
  front counting a tombstone while its articles move to the survivor. Out of this ticket's
  scope (would touch existing RPCs) — needs a Wave 2 call.

## Review + validation

- Inline two-pass review (subagents banned): pattern pass caught the missing migration-001
  dependency note and the PostgREST schema-cache reload; both folded in. Production pass
  verified AC1-3/5 column-by-column against PRD §6, RLS/grant interaction for anon through
  the security_invoker view, and no `events` name collision on TEST (PGRST205 probe).
- `npm run lint` clean · `npm run test:ui` 138/138 · `npm run qa:smoke` full chain green
  (judge-dryrun 122/122 at the end of the && chain proves every earlier suite passed).

## What Josh does next (also in PR body "Josh applies")

1. Apply `migrations/111_fronts_data_layer.sql` in SQL Editor on **TEST** (decline any
   SQL-editor "Enable RLS" suggestions — the file handles RLS). Re-run safe.
2. Anon-read verification: 4 curls in the PR body (events, event_updates, story_event,
   v_event_stats) each returning `[]` — or ask the next session to run them via the
   supabase-test MCP. That closes AC4 + AC6.
3. Optional: security advisor on TEST — expect no new findings.
4. Squash-merge PR #119 → ticket to Testing.

## Next session

- After 111 is applied: add events/event_updates/story_event/v_event_stats to
  `docs/database/database-schema.md` (deliberately not done pre-apply — that doc describes
  live state).
- Then ADO-547 (admin UI for fronts) unblocks; A1/A2 above may generate follow-ups.
- Working-tree note: unrelated uncommitted edits to `index.html` + `src/styles/base.css`
  existed before this session and were left untouched on `test`.

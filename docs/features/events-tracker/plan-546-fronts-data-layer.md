# ADO-546 Execution Plan — Fronts Data Layer (Opus handoff)

**Written by:** Fable session 2026-08-19 (post ADO-545 merge) · **For:** an Opus implementation session
**Rule of the plan: execute, don't re-design.** Every schema decision is already made in the PRD. If something here contradicts the PRD or the card, stop and flag it in the PR body instead of choosing.

## Context (read these, in order, nothing else needed)

1. ADO-546 card (description + 6 ACs) — the contract
2. `docs/features/events-tracker/prd.md` **§6 only** (tables, columns, §6.6 controlled vocabularies) — the schema source of truth
3. This file

Key locked decisions you must not revisit: `story_event.story_id` is the **sole PK** (one front per story, Josh 2026-08-17); **no stored counters** — `v_event_stats` derives everything; "front" is the public word, tables keep the neutral `events` naming.

## Deliverables (one PR to test, branch `ado-546-fronts-data-layer`)

1. **`migrations/111_fronts_data_layer.sql`** — file only. **DO NOT execute DDL anywhere; Josh applies it manually in the Supabase SQL Editor on TEST.** The supabase-test MCP cannot run DDL anyway; do not try workarounds.
2. **`scripts/lib/skip-reasons.js`** — add `FRONT_ASSIGNMENT` and `FRONT_UPDATE_DRAFT` pipeline constants (follow the existing constant style in that file; read it first).
3. Migration verification checklist in the PR body (see below).

## Migration file requirements (from the card + house rules)

- Tables per PRD §6: `events`, `event_updates`, `story_event`; view `v_event_stats` (story_count, source_count, update_count, last_activity_at, peak_alarm, days_since_update).
- `IF NOT EXISTS` on every CREATE (idempotency is an AC).
- `TIMESTAMPTZ` only — never bare `timestamp`.
- CHECK constraints for every §6.6 controlled vocabulary.
- Explicit `ON DELETE` behavior on every FK (PRD §6 specifies; if it doesn't for one, RESTRICT and flag it).
- **`GRANT SELECT TO anon`** on all three tables + the view — migration 046 auto-revokes on new tables; without this the frontend sees nothing (this exact miss blocked SCOTUS/Pardons once). AC4 verifies via anon-key PostgREST read.
- If you create any function (you likely won't): SECURITY DEFINER needs the idempotent `REVOKE ... FROM PUBLIC` DO-block pattern from migrations 095/096; no `%ROWTYPE` variables (SQL-editor paste hazard).
- No data seeding in the migration. Seed fronts (Epstein, Iran, etc.) are Josh's call post-apply, likely via the ADO-547 admin UI.

## What NOT to do

- No frontend work (that's ADO-548). No admin UI (ADO-547). No agent/auto-assignment (Wave 2).
- No subagents (banned in this repo). No Python. No `select=*` anywhere.
- Don't touch PROD anything. Don't run `apply-migrations.js` (it only handles migration 009).
- Don't renumber: 111 is next (110 is the current max).

## Validation before PR

- `node -c`-style sanity isn't enough for SQL — instead paste-review the file against each AC and each bullet above, then run `npm run lint && npm run test:ui && npm run qa:smoke` (should be untouched/green; this change is SQL + one JS constants file).
- skip-reasons.js change: verify constants export/lookup style matches existing entries (typos must fail JS lookup, per CLAUDE.md).

## PR + wrap-up

- PR to `test` (never push direct), body includes: the AC checklist, and a **"Josh applies"** section: apply 111 in SQL Editor on TEST → then run the anon-read verification (one curl per table with the anon key expecting `[]` not a 401/42501).
- Comment `@codex review` on the PR.
- ADO-546 → Review (only after ACs 1-3+5 verified in-file; AC4/AC6 stay open until Josh applies — say so on the card).
- `/end-work`: memory + handoff per policy.

## Escalate (stop and write it in the PR body) if

- PRD §6 is ambiguous about a column type/constraint
- v_event_stats needs anything not derivable from the three tables
- Anything requires touching existing tables' schemas

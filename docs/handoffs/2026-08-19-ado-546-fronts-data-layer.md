# 2026-08-19 — ADO-546: Fronts data layer (migration 111)

**Session type:** Fully autonomous overnight build (Fable), per the plan Fable wrote post-545:
`docs/features/events-tracker/plan-546-fronts-data-layer.md` — executed, not re-designed.
**Deliverable:** PR #119 → test (`ado-546-fronts-data-layer`), @codex review requested.
**ADO:** 546 → Review. **UPDATE (same night): all 6 ACs are MET** — Josh applied migration 111
(including the Codex P1/P2 PART H constraints) in the SQL Editor on TEST and every gate was
verified live: anon reads return `[]` on all four relations, the RLS publish gate hides drafts
and shows published, vocabulary + timestamp CHECKs reject bad writes, the same-front composite
FK rejects cross-front update links, and cascade delete cleans up. QA fixtures deleted.

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

## What Josh does next

~~Apply + verify migration 111~~ — **DONE same night** (applied twice: original file, then the
amended file with PART H; both verified live, see the ADO-546 comments for the full evidence).
The only remaining step was squash-merging PR #119. Optional leftover: run the Supabase
security advisor on TEST — expect no new findings.

## Next session

- ~~Add the new relations to database-schema.md~~ — DONE later this session.
- ADO-547 (admin fronts UI) is next; its card was rewritten as a full product card
  (KPIs, scope, two added gaps: manual update-writing + tracker_pin/migration 112).
- Working-tree note: unrelated uncommitted edits (`. claude/test-only-paths.md`,
  `supabase/.temp/cli-latest`, untracked `.agents/`, `scripts/maintenance/`) pre-existed
  and were left untouched on `test`.

## Session continuation (same night, Josh interactive)

The session kept going after the 546 build. In order:

1. **Codex P1/P2 on PR #119** — both accepted; fixed as guarded ALTERs (PART H of 111):
   same-front composite FK (additive, keeps single-column FK for ON DELETE SET NULL —
   avoids PG15-only syntax) + state/timestamp CHECKs (published⇒published_at,
   resolved⇒resolved_at, decided⇔decided_at+decided_by). Josh re-applied on TEST;
   every constraint verified live with real rejected writes. P3 (stale handoff) fixed.
2. **PR #119 squash-merged** → ADO-546 **Ready for Prod** (all 6 ACs verified).
3. **PR #120** — site-wide month-day-year dates ("Aug 19, 2026"), Josh's live-review ask:
   fmtDate, fmtMetaDate, Footer, Scorecard + test expectations. Merged. Codex skipped
   per trivial-change rule.
4. **ADO-550 pardons fix deployed to PROD** — PR #121 cherry-pick (aaf43a6 → main,
   AI review pass), Track Pardons run triggered: **25 inserted, 0 errors**, backlog
   recovered, tripwire live. **Closed.** Watch: 2 Perplexity validation errors
   (receipts_timeline date null) — card it if the enrichment agent doesn't clear them.
   New pardons render grey until the daily agent enriches (corruption_level null).
5. **ADO cards 543-549 + 552 reformatted** — reader-standpoint titles, What/Where/
   Technical descriptions, month-day-year dates. 547 upgraded to a full product card
   (problem, KPIs from PRD §4.2, out-of-scope, and two scope gaps folded in: manual
   update-writing for Wave 1 + tracker_pin overrides with a future migration 112).
6. **544 + 545 → Ready for Prod** (Josh's live check passed). With 546, the whole
   Tracker stack awaits one PROD deploy: cherry-picks to main + Josh applies 111 in
   the PROD SQL Editor + rap_sheet flag flip after verify. Josh hasn't pulled the
   trigger yet.
7. **database-schema.md** gained the four fronts relations (this docs PR).

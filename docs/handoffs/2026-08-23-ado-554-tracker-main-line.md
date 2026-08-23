# Handoff — ADO-554: The Tracker main line (curation layer)

**Date:** August 23, 2026
**Ticket:** ADO-554 (new this session, sibling of 547 under epic 543) — Active → Testing
**PR:** #127 `feature/ado-554-tracker-main-line` → `test`
**Also this session:** ADO-544/545/546 closed as deployed-flag-off (Josh's standing instruction); ADO-547 AC6 re-scoped to the pin *editor* only, with a comment explaining the split.

## Why this exists

Josh's verdict on the PROD flag-off preview (August 23): the spine at alarm 4+ reads as **everything**, not the major-items main line. `rap_sheet` stays OFF on PROD until this ships — the flag flips once, debuting the curated Tracker. He asked for GENERALIZED anchor logic: rules decide the main line; he *can* hand-curate via `tracker_pin` but never *has* to.

## The rule (v1) and where it came from

Ground truth = Josh's 57 per-entry anchor flags in the rev-6 mockup (`.superpowers/brainstorm/events-homepage-v2/rap-sheet-w12-expand.html`, the `[date, alarm, headline, front, anchor]` rows). Analysis findings, so nobody re-derives them:

- **Front openings:** all 7 fronts' first entries flagged 1 → mechanical rule, 7/7.
- **Loose ends** (incl. every SCOTUS/EO/pardon row): flagged 1 iff alarm ≥ 4 → 18/19 (sole miss: "pardons a donor mid-trial", a4 flagged 0 — a routine recurrence; exactly what force_hide is for).
- **Escalations:** NO mechanical rule reproduces them perfectly — "Gang of Eight skipped" (a5, flagged 0) vs "Fires the AG" (a5, flagged 1) are structurally identical; the difference is editorial. Best mechanical default: **alarm 5 OR new front peak at 4+** → 6/7 escalations, 5 over-inclusions all at alarm 5 (errs toward showing the worst — the safe direction; the alternatives would MISS "the Epstein files are released").
- Net: **50/57 (88%) with zero curation.** Wave 2's drafter (`event_updates.significance='major'`) is the designed path to close the judgment gap; pins fix single rows meanwhile.

```
main_line(entry) =
  force_show → in · force_hide → out
  no published front → alarm_eff >= 4
  front member → opening (earliest member) OR alarm_eff = 5
                 OR (alarm_eff >= 4 AND > front prior peak)
```

## What shipped

1. **Migration 112** (`migrations/112_tracker_main_line.sql`) — APPLIED on TEST (twice: idempotency proven):
   - `tracker_pin` (PK source+entity_id; entity_id TEXT for the EO id drift). **Column-level anon grant on source/entity_id/pin only — `note` is admin-private** (AI-review blocker fix).
   - `v_tracker_stories` (security_invoker): bakes in active+enriched, exposes front fields + `alarm_eff` + server-computed `main_line`. **Codex P1 fix: the opening/prior-peak window joins stories with the same active+enriched predicates** — merge tombstones in `story_event` can't hold the opening slot or suppress escalations.
2. **`src/lib/timeline.ts`** — `TrackerView` ('main' | 0 | 3 | 5); stories read the view; `fetchTrackerPins` / `forceShowIdsBySource`; main mode drops force_hidden non-stories rows every page and injects force_shown rows (below the alarm-4 stream, first page only, no duplicates); `openFronts` tally.
3. **`src/components/TrackerSpine.tsx`** — default segment **Main line**; front name renders as a row tag (nav lands with ADO-548); Open fronts tile; main-mode client alarm floor is 0 (server decided).
4. **Seed data on TEST** (via supabase-test MCP, service_role): 7 published fronts (events ids 7–13: epstein-files, iran, trump-crypto, qatar-jet, selling-the-white-house, the-courts, kushners-deals — Kushner's has no members, no matching TEST stories), 27 story assignments, 2 demo pins (force_hide stories/14830 explainer; force_show eos/5 alarm-3 401(k) EO).
5. **Docs:** database-schema.md Fronts section extended (tracker_pin + v_tracker_stories + the rule).

## Verification done

- vitest 146/146 (5 new pin/injection/main-mode tests), `tsc --noEmit` clean, vite build clean, `qa:smoke` exit 0.
- Anon PostgREST: view + pins readable; `select=note` correctly 42501; main line = 414 story rows; open fronts = 7.
- Live on localhost:3000 (TEST DB, chrome): Main line default with 7-fronts tally; Qatar's alarm-3 opening ON the line with front tag; Iran's 6 routine assigned a3/a4 rows OFF while its a5s stay tagged IRAN; unassigned Iran loose ends at 4+ still show (correct — not filed yet, that's 547's admin); force_shown EO appears at its Aug 2025 position; force_hidden explainer absent. Zero console errors.

## Gotchas for next sessions

- **PROD deploy order:** apply migration 112 BEFORE cherry-picking the code (stories fetch targets the view; missing view = no stories on the Tracker). Then seed PROD fronts + assignments, then flip `rap_sheet`.
- Unassigned stories at alarm ≥ 4 stay on the main line as loose ends BY DESIGN — assignment coverage (ADO-547 admin / Wave 2 agent) is what makes fronts absorb their routine developments.
- An unpublished front's members count as loose ends for anon (RLS hides membership) — a draft front can't change the public main line.
- Applied DDL via claude-in-chrome → SQL Editor (Josh's session), fetching the SQL from raw.githubusercontent inside the page — the migration-111 pattern, worked again.

## Open items

- Josh eyeballs the TEST site (AC7) → then Ready for Prod.
- ADO-547 (admin UI incl. pin editor) is the next build; 548 front pages give the front tags their navigation.
- ADO-553 cohort verify is a separate queue item (6 pardons in needs_review — Josh works those in admin).

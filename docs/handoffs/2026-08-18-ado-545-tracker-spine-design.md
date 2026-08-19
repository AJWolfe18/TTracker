# Session Handoff — 2026-08-18: The Tracker spine design locked, ADO-545 rescoped

## What happened

Design session, no production code. Started by resolving the PRD §12 open questions, then
iterated a local mockup through 6 revisions with Josh live. The session ended with the whole
main-surface design locked and ADO-545 rescoped to build it.

## Decisions locked (all recorded in PRD §12 + ADO comments)

1. **Naming: Fronts** (over Files). Tier labels become Primary / Active / Watch.
2. **No domain-page timelines for MVP** — homepage only.
3. **Wave 1 KPIs are baseline-only** — the 25% front-open-rate guess is dropped as a commitment.
4. **The main surface is "The Tracker": a vertical center-spine timeline** — the bar is the
   timeline, dates alternate left/right, newest first, type size + dot size = alarm level,
   month markers on the bar, tally row of big numbers above. Replaces the W1.1 horizontal
   strip AND the planned full-screen expand + separate running log (the spine absorbs both).
   Josh: "1000% better."
5. **Main-line inclusion = alarm ≥ 4 default filter** (All / 3+ / 4+ / Only 5 segmented
   control), NOT an editorial anchors/everything toggle. "Anchor" is admin-only vocabulary —
   it never appears in public UI.
6. **Manual curation is a hard requirement** (added to ADO-547): per-entry
   `tracker_pin: force_show | force_hide | null` across all four sources, overriding the
   alarm auto-filter — promote a big EO/SCOTUS ruling the filter missed, hide noise.
7. **Front click = navigation, not inline expansion** (added to ADO-548): a front page is the
   same spine visual filtered to that front, complete record by default, own shareable URL,
   back link.
8. **Every Tracker control gets a GA4 event** (added to ADO-549) — Josh explicitly wants data
   on whether the alarm filter earns its place; if unused, it comes out.
9. **Homepage question (§12 Q7)**: keep the blend for Wave 1; the spine build effectively
   makes the homepage the tracker. Formal call deferred to data.

## Mockup

`.superpowers/brainstorm/events-homepage-v2/rap-sheet-w12-expand.html` — **gitignored,
local-only** (rev 6). Uses real app tokens (midnight theme dark+light, Newsreader/JetBrains
Mono, alarmPalette restrained colors) so it previews the shipped look. All data, front
assignments, and anchor picks are fabricated sample data. Revisions 1-5 explored: stacked
rows (too busy), month bands + minimap (mixed axes confused), horizontal source swimlanes
(better), then the spine (winner).

## ADO state

- **ADO-545** → Active, **rescoped + retitled**: "W1.2 The Tracker — spine timeline, filters,
  search". Description + 6 ACs rewritten to match rev 6. The W1.1 fetch layer
  (`src/lib/timeline.ts`), `useFeatureFlag`, flag `rap_sheet`, and tests all carry over —
  only the strip component gets swapped.
- **ADO-543** (epic): 3 comments — §12 resolutions, anchor principle, rev-5/6 refinements.
- **ADO-547**: comment — manual curation scope (tracker_pin).
- **ADO-548**: comment — front page = spine visual, own URL.
- **ADO-549**: comment — Tracker control instrumentation list.
- **ADO-544**: still Testing. Its strip component is being superseded by the spine, so Josh's
  pending UX pass only matters for data plumbing (fetch works, links route correctly).

## Gotchas discovered

- The TEST site URL in old docs (`test-trumpytracker.netlify.app`) is stale — the real one is
  **https://test--taupe-capybara-0ff2ed.netlify.app** (now in memory repo-map).
- ADO Markdown description fields eat content after a literal `<` (parsed as HTML tag) —
  the first ADO-545 description write truncated at "<760px"; rewrote with "below 760px".

## Next session (in order)

1. **Execute ADO-545** — design is locked, don't re-design. Build the spine component
   (replace `RapSheetTimeline` strip in `src/pages/Home.tsx`), alarm filter default 4+,
   source chips, live search, cursor "load earlier", entries navigate to existing detail
   routes, alarmPalette styling both modes, mobile single-column. Reuse
   `src/lib/timeline.ts` fetch + adapters; extend tests.
2. Then the front layer: ADO-546 (migrations) → 547 (admin registry + tracker_pin) →
   548 (front spine pages) → 549 (GA4).
3. Open product threads: alarm label wording (iterate live on real UI); §12 Q7 formal call.

Cost: everything designed this session is $0 — same table reads, no new AI calls.

## Addendum: late-night PROD diagnostics (same session, after the wrap)

Josh flagged three things; all diagnosed read-only (anon-key PostgREST, tight selects):

1. **"All stories grey on PROD"** — not a bug. The restrained palette colors only alarm 4–5 by
   design, and current enrichment scores honestly: of the 100 newest PROD stories, 89 are alarm
   0–3, 9 are alarm 4, zero are 5. (All-time, 9,331 of ~13K sit at 4+ — that's legacy-GPT alarm
   inflation, the thing the agent migrations fixed.) Optional product lever if more color is
   wanted: color level 3, or full-intensity palette. No ticket filed.
2. **"No new pardons"** → **ADO-550 (Bug)**. DOJ scraper runs green daily but parses only the old
   page markup: 116 found / 116 duplicates / 0 inserted every run since Feb 5, while the live DOJ
   page has grants through Jul 6, 2026 (Feb 12, Jun 4, Jul 3, Jul 6). Fix scope + a staleness
   tripwire are on the card.
3. **"SCOTUS dispositions need normalizing"** → **ADO-551 (Story, Active)**. Full audit already
   done and posted as the ticket's newest comment — `case_type` already disambiguates
   granted/denied; only data fix is `GVR`→`gvr` (2 rows) + TEST's stray `vacated`; the visible
   bug is `src/lib/adapter.ts:350` rendering raw snake_case; 10 null rows are Jan-2020 backfill
   artifacts left for Josh's hide/delete call.

**Queue set by Josh: 551 → 550 → 545.** The overnight-autonomous session prompt (paste into a
fresh session in auto-accept mode) is in the 551 workflow: work both tickets, recommended options
only, DECISIONS LOG at the end, DDL to migration files, never touch PROD data.

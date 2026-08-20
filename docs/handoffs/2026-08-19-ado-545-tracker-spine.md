# 2026-08-19 — ADO-545: The Tracker center-spine timeline (autonomous overnight session)

**Ticket:** ADO-545 (now **Review**) · **PR:** [#117](https://github.com/AJWolfe18/TTracker/pull/117) to `test`, @codex review requested · **Branch:** `ado-545-tracker-spine` · **Commit:** 47f69b6

## What shipped

"The Tracker" vertical center-spine timeline (locked mockup rev 6, `.superpowers/brainstorm/events-homepage-v2/rap-sheet-w12-expand.html`) as the primary homepage rap sheet surface on the stories tab, **replacing the W1.1 horizontal strip**. Same `rap_sheet` flag (ON test / OFF prod). No DDL, no migration.

| File | Change |
|------|--------|
| `src/lib/timeline.ts` | Extended ADO-544 fetch layer: per-source keyset cursor paging, server-side alarm predicates, coverage frontier, tally HEAD counts. Adapters/routes/labels unchanged. `fetchTimelineEntries` (strip-only) removed. |
| `src/components/TrackerSpine.tsx` | New spine component (tally, controls, spine, load-earlier). |
| `src/components/RapSheetTimeline.tsx` | **Deleted** (W1.1 strip, superseded). |
| `src/pages/Home.tsx` | Swapped strip for spine. |
| `src/__tests__/timeline.test.ts` | +13 tests (predicates, keyset paths, frontier, combined filters, paging state machine incl. per-source error degradation via stubbed fetch/window). |

## Architecture worth knowing

- **Keyset paging:** each source pages independently by `(dateCol desc, id desc)`; next page = `date < D OR (date = D AND id < I)`, values quoted + URL-encoded (timestamps with `+`/`:` survive; EO varchar ids on PROD work).
- **Server-side alarm predicates** (so default 4+ never bulk-fetches): story nulls fall back to `severity in (...)`; EO/SCOTUS nulls count as alarm 3 (included at 3+, excluded at 4+ — 77% of TEST EOs have null alarm_level); pardon nulls count as 2. Changing the alarm filter resets cursors and refetches page 1 (cursor streams are predicate-specific).
- **Coverage frontier:** entries older than the max cursor date among non-exhausted sources are buffered, not rendered — 25 EOs reach back months while 60 stories reach back days, and rendering them together would fake gaps. "Load earlier" advances all non-exhausted sources and releases the buffer.
- **Error degradation:** a failing source is marked exhausted+errored and skipped; the surface hides only if ALL sources errored with nothing loaded (strip's "additive, never break the homepage" rule preserved).
- **Tally:** HEAD + `Prefer: count=exact` (total in Content-Range, zero body egress). 8 HEAD requests per homepage load when the flag is on. "Open fronts" tile omitted until the front layer exists (ADO-546).

## Verification (all green)

`npm run lint` · `test:ui` 136 passed · `build` · `qa:smoke` (all 9 suites) · live check on localhost vs TEST: default 4+ view, All/Only 5 switching, search+chips combined, load-earlier 60→120→183 with SCOTUS emerging past the frontier, click-through to `/detail/16970`, dark+light screenshots, single-column layout verified at 396px viewport (iframe technique — resize_window was flaky), zero console errors.

Two-pass inline review (subagents banned) found and fixed: (1) `loadingMore` stuck true if the alarm filter changed mid-"load earlier" (finally now unconditional + reset in the fetch effect); (2) chip order matched to mockup (Stories/SCOTUS/EOs/Pardons).

## DECISIONS LOG (autonomous calls, all reversible)

1. **No migration.** Pure frontend; nothing needed `tracker_pin` etc. (ADO-547's problem). Reverse: n/a.
2. **Server-side alarm filtering with cursor reset on filter change** instead of mockup's pure client-side filtering. Why: at PROD volumes (~12k stories) a client-side-only filter means bulk-fetching rows the 4+ default never shows (egress rule #11) and terrible time coverage per page. Cost: filter switch does one refetch (4 small queries). Reverse: drop the `alarm()` fragments from SPECS and filter client-side only.
3. **Coverage frontier clamp** (buffer entries below the least-covered date). Why: without it, sparse sources render months back while stories cover days, faking "nothing else happened" gaps. Trade-off: on TEST (stale EO/SCOTUS/pardon data, newest Nov 2025–Jan 2026) the spine top is stories-only until you page back — on PROD daily pipelines make the top interleave. Reverse: render `entries` without the frontier filter in `visibleEntries`.
4. **Null-alarm semantics mirror the ADO-544 adapters** (EO/SCOTUS null→3, pardons null→2, stories null→severity). Why: server filter and client display must agree or rows flicker in/out across pages. Reverse: change SPECS `alarm()` + adapters together.
5. **Error → exhausted+errored** (a failed source stops paging for the session instead of retry-blocking the frontier). Why: a persistently-down source would otherwise pin the frontier and freeze the whole timeline. Reverse: keep cursor and retry on next load-earlier.
6. **Tally = 3 tiles** (days into term, developments logged, alarm-5 last 30d); "Open fronts" omitted until ADO-546; kept the days tile despite Scorecard's small "Day" figure (mockup shows it big). Reverse: edit `tallyTiles`.
7. **Scorecard untouched.** Ticket scope says only the strip is swapped; two number rows coexist on the stories tab. If it reads as duplication, hiding Scorecard on stories-tab-with-flag is a 2-line change in Home.tsx.
8. **Empty-filter state renders the section with a hint** ("try All") instead of the strip's return-null. Why: default 4+ could legitimately be empty while data exists — hiding the surface would strand the user with no way to switch filters. Full hide only when every source errored and nothing loaded.
9. **Spine content capped at 1080px** inside the 1400px main column (mockup wrap width) — a center spine at 1400px reads stretched.
10. **Subcap copy adjusted** (no fronts yet): "Every major development since inauguration, newest first · type size = alarm level · the complete record is one filter away". No em dashes per Josh's rule.
11. **Page sizes kept at W1.1's 60/25/25/25 per click.** On PROD, 4+ stories density may make "load earlier" advance only days per click — page size is one constant per source in SPECS if it needs tuning after PROD data is visible. (Tried a read-only PROD density check; permission classifier blocked non-TEST curl — respected, TEST-only session.)
12. **Stories tag = "Loose end", other sources tagged by name** (per ticket: source/loose-end tags only until fronts land with ADO-546/548).

## Follow-up same session: spine-only homepage (PR #118, Josh's morning call)

Josh confirmed the rev-6 agreement was **the Tracker IS the homepage** (PRD §12 Q7 now RESOLVED: yes), delivered as a separate stacked PR per his selection:

- `/` renders **TrackerHome** (tally + spine only, no Scorecard — the tally is that page's number row) when `rap_sheet` is on; classic story feed when off (PROD unchanged).
- Story feed (Scorecard/hero/filters/cards) moved to a new **News** nav tab (`/news`; renamed from Stories/`/stories` during live review); nav item is flag-gated so PROD nav is unchanged; the spine no longer renders inside the stories feed page.
- New `useFlagsReady()` hook gates the `/` route on the flag file loading, so the flag-off surface never flashes first.
- `TrackerSpine` gained a `standalone` prop: total fetch failure renders ErrorState instead of silently removing the section (which would have left a blank homepage).

Verified live: `/` = mockup rev 6 exactly; `/news` = classic feed with News highlighted; `?ff_rap_sheet=false` = classic homepage with no News nav item; click-through from the spine homepage works; zero console errors; lint/test:ui/build/qa:smoke green.

**Merge order:** #117 first, then #118 (its PR diff shrinks to just the homepage promotion once #117 lands).

## Open items / next session

- **Josh:** review PR #117 + Codex findings, then merge (squash) → Netlify test deploy → UX pass on the test site (real mobile per usual).
- ADO-544 sits in Testing with its strip now deleted on this branch — when #117 merges, 544's remaining value is the fetch layer (already covered here). Consider closing 544 as superseded-into-545 or noting it on the card.
- Fronts/front pages (546/548), tracker_pin admin overrides (547), GA4 events (549) are the next spine layers.
- PROD deploy later needs: cherry-pick, flag stays OFF, verify with `?ff_rap_sheet=true`, and sanity-check "load earlier" pace at PROD story density.

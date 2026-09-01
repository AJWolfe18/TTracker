# Handoff: Tracker to PROD, FB share verified, SCOTUS clobber bug (August 31, 2026)

Huge multi-thread evening session. Four PRs to main, one PROD migration, one production data-loss bug found and fixed, 12 buried SCOTUS cases restored.

## Shipped to PROD (four PRs, all squash-merged)

| PR | What | Ticket |
|----|------|--------|
| #137 | Facebook Share Dialog instead of sharer.php | ADO-575 (Ready for Prod) |
| #138 | Tracker precompute (migration 113) + spine UX (type labels, month chips on the spine, mobile ticks, Developments tile hidden, Loose end tag removed) | ADO-570 (**Closed**) |
| #139 | SCOTUS fetcher: re-fetch no longer clobbers enrichment | bug, no card |
| #140 | Review fixes for #139 (docket normalization in fetchOwned, cluster-id dedupe fallback) | — |

**Migration 113 applied on PROD** via SQL editor (browser), then `refresh_tracker_derived()` (~1,400 rows) + `ANALYZE`. Homepage verified: tally on first paint from one `tracker_stats` GET, six REST calls, sub-second. Josh confirmed "it's fast."

## ADO-575: root cause was profile, not settings
The "User opted out of platform" error = the browser was switched into the **TrumpyTracker Page profile**; Page profiles are hard-opted-out of platform apps. No account setting was ever needed. Verified working from the personal profile on TEST, deployed via #137.
**Gotcha:** desktop Share Dialog no longer offers "share to a Page you manage." Josh's as-Page workflow: **copy link → switch into Page profile → paste in composer** (OG card renders). ADO-573 API poster is the real fix.
**To Close 575:** Josh posts one PROD story to the Page + screenshot on the card; optional Sharing Debugger re-scrape (AC 3).

## The SCOTUS clobber bug (the big find)
Josh asked "weren't there SCOTUS rulings today?" and pulled the thread:
1. Fetch + enrichment agents were **never off** — ran all summer (the disabled things were local laptop skills, cosmetic).
2. `fetch-cases.js` wrote its full payload (incl. `is_public: false`, `vote_split: null`, CL author guesses) on every re-upsert. CourtListener keeps clusters in the window for days → **every enriched case that got re-fetched was un-published and had its vote split nulled**. Trump v. California: published Aug 26 16:07 UTC, buried by the 19:29 fetch same day.
3. Damage: **12 enriched cases hidden** — the entire June 29–30 term finale (birthright citizenship, Humphrey's Executor overruled, Fed governor firing, NRSC campaign finance, WV v. B.P.J., geofence 4A, plus cert denials) + Trump v. California. Site had shown nothing after June 24 all summer.
4. Fix (#139/#140): existing rows get **only fetch-owned refreshes** (names/dates/syllabus/excerpt/urls — which is also how text-less cases get their text later); authors + `is_public:false` are first-insert-only. Pardons scraper checked: insert-with-dedupe, not affected.
5. Repair: republished all 12, reset to pending, fired the enrichment routine → all 12 re-enriched (18 min run, log id 120).

## Rating semantics decision (Josh canon)
The re-run "downgraded" every case Trump **lost** to 0 — exposing that prompt-v1.md defines impact as *magnitude* in one table and *valence* in the tone table. **Josh ruled: alarm = VALENCE.** Birthright citizenship win = 0 ("Democracy Wins") even though landmark. Trump v. Slaughter (Humphrey's overruled) keeps its 5 and is on the main line.
**NOT DONE YET:** prompt-v1.md still carries the contradictory magnitude wording — edit + cherry-pick to main before the next scheduled run re-reads it (agent pulls main at 16:00 UTC weekdays).

## Also tonight
- CourtListener itself lags up to a week on shadow-docket orders (Aug 21/24 orders appeared in CL Aug 24/31). Day-of coverage = the RSS news layer (works); SCOTUS entry = the receipt when text lands.
- Ballroom case (2399, NPS v. National Trust, decided Aug 31) has **no text in CL yet**; agent marked it failed and will auto-enrich when text lands. It got auto-published as an empty shell (`is_public=true` is a prompt invariant even on failed patches) — Josh was told to run `UPDATE scotus_cases SET is_public=false WHERE id=2399;` **verify it happened**.
- Cards created: **ADO-576** (dead 72h story closer — reviving must not erase the Tracker record; supersedes 210), **577** (Discord pipeline alerts), **578** (Discord 👍/👎 merge approvals — needs bot token), **579** (EO ratings recalibration; gold-standard-childhood-care EO flagged; valence canon noted).
- Homepage UX (Josh live feedback): months bigger + on the spine, mobile connector ticks + line alignment, Developments tile commented out (may return), Loose end tag removed.

## Next session (in order)
1. **SCOTUS prompt valence fix** → cherry-pick to main (urgent-ish: next run is 16:00 UTC weekday)
2. Wins on the timeline: Josh wants big wins visible, "maybe even something green" — design pass; pin SQL for scotus/2108 offered
3. **Cron change never confirmed**: recommend `0 16,23 * * *` daily on trig_019eD3JTVeSajL4qTJJSC6tq — re-ask
4. `/scotus-review latest 12` — QA the re-run (2392 vote discrepancy: 7-2 Aug 26 vs 6-3 re-run; one is wrong)
5. Verify 2399 hidden; then back to the growth track (**ADO-572** draft queue)
6. ADO-564 north-star numbers due September 7

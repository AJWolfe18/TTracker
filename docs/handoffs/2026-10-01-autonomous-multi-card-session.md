# Autonomous multi-card session (October 1, 2026)

## Late update 3 (merges, October 1, 2026, about midnight CT)
- **Merged to `test` (squash):** #158, #163, #167, #157, #160, #164 (conflict in `.claude/test-only-paths.md` resolved by keeping both lists), #168. TEST `admin-undo` redeployed for #167 (via `npx supabase`, since the global CLI install has no binary).
- **Not merged: all 5 main PRs.** The permission guard blocks production merges from Claude, so Josh merges them. In order:
  1. **#162**: no steps first.
  2. **#159**: first click through the chips on TEST (#158 is live there).
  3. **#161**: its test twin #163 is merged. Afterwards, check that the first scheduled PROD runs are green.
  4. **#165**: first re-run migration 120 in the TEST SQL Editor (#168 is merged), then on PROD run the dash count, migration 120, and the verify query (must be 0).
  5. **#166**: first deploy `admin-undo` to PROD; afterwards run migrations 118 then 119.
- The SQL files from #157 and #164 are now on `test`: `scripts/maintenance/2026-10-01-ado-*.sql`.

## Late update 2 (Codex round 2, October 1, 2026, about 11:30 PM CT)
- **Every Codex round 2 finding is fixed (4 P1, 1 P2), and each changed PR was re-reviewed at `/code-review medium`.** Main twins match their test PR file for file.
  - **#158 / #159 (593):** a catch-up that stops at its 10-page cap now shows a marker where that source stops ("Stories before Jun 3, 2025 not loaded yet · load earlier"), and the count line says "catching up Stories", never "the complete record". The medium review found nothing at medium or above. Its one low (a retry loop if the `rap_sheet` flag turns off mid-session) is fixed too. **HOLD lifted.**
  - **#168 / #165 (migration 120):** URLs after `:` or `<` (`Source:https://x.gov/c–d`, `<https://x.gov/c–d>`) are now protected. A new self-test block (14 cases) runs before the triggers and the backfill, and a wrong answer rolls the whole file back. The rollback also drops `strip_dashes_plain`, and the full rollback is now at the bottom of the file. Tested on Postgres 17.5 (PGlite); the old version reproduced Codex's bug. Medium review: clean.
  - **#157 (26A124):** the row is locked (`FOR UPDATE`) before it is checked, and the UPDATE repeats the values it checked. Tested on 6 row states. Medium review: clean.
  - **#164 (Hegseth front):** part 3 is now a targeted sweep that files only Hegseth's stories, so deleting the front undoes everything the file did. The medium review found 3 doc issues, all fixed: the plan's PROD steps, the rollback wording, and the tier/alarm note. Nothing changed on TEST.
- **Your decisions did not come through.** The prompt had the template unfilled ("592: yes / changes", "title X"), so nothing was applied: events id 15 and the SQL header are unchanged. The questions are parked on ADO-592 (noted on 594 too). New input for the tier question: on TEST every major front is alarm 4 and every flagship is alarm 5. Hegseth is major at alarm 5, so choosing major also means `alarm_level = 4`.
- Cost: $0 (no AI calls, no bulk reads; PGlite runs locally).

## Late update (after Josh's local Codex review, October 1, 2026, about 10 PM CT)
- **Codex found 4 P1s; all fixed and re-reviewed at medium:** #157 (26A124 SQL now checks authors and highlights separately), #158/#159 (a failed later page shows "Try again", never "That's the whole record"), #165 + new test PR **#168** (migration 120 now covers `ruling_label` and `substantive_winner`, and leaves URLs alone, including inside prose). Migration 120 was fixed in place (PROD has not run it). **#168 is a new PR to test: after merging it, re-run migration 120 in the TEST SQL Editor.** Known trade-off: an en dash glued onto a URL with no space is kept, to protect URL slugs.
- **Josh decisions:** 493 keeps the 8 public 2020 cases (SQL default). 2392 goes to impact level 4: added to the 26A124 file in #157. 594 D1 to D8 all approved and recorded in the PRD (#160). 593 catch-up approved and built (#158/#159): within a view the list never cuts back, and "Load earlier" fills in sources that are behind first (button reads "Load earlier · catching up <Source>"). Needs a TEST click-through after #158 merges.
- **New front: "Hegseth's Pentagon"** (slug `hegseth-pentagon`), folded into ADO-592. Live on TEST (events id 15, 62 stories swept, 5 on the main line; Iran wins overlaps). PROD = paste `scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql` (in #164; it publishes on run unless `v_state` is set to 'draft').
- **Still open for Josh:** (1) "592 yes" on the three agent-pattern nets (Courts tight, keep Kushner Gulf terms, apply with the 592 build). (2) Hegseth front: title ("Hegseth's Pentagon" / "The Pentagon Purge" / "The Department of War"), tier (major now; flagship suggested), boat strikes stay inside (40 of 62 stories). Each is a one-line UPDATE in the file header.
- **Environment note:** `node_modules/.bin` was emptied by some process during the session and restored with `npm rebuild --ignore-scripts` (no tracked files changed).
- ~~**DO NOT MERGE #158 / #159 YET.**~~ (lifted in Late update 2) The HIGH from the catch-up review was fixed in 9de57d5 / f8dd09e. The next medium review found two more small issues, sent to Lane A at wrap-up: (1) TrackerSpine.tsx ~221: the saved frontier must reset on every successful first-page load, not only when the view name changes (main -> All -> main before All loads keeps the old deep frontier = fake gaps); (2) TrackerSpine.tsx ~594: hide the empty-list message only while actually loading, not whenever a source is behind. **Next session:** if the heads are still 9de57d5 / f8dd09e, apply those two fixes; either way run /code-review medium 158 until clean, then lift the HOLD on P5 in the merge table.

Plan: `docs/plans/2026-10-01-autonomous-multi-card-session.md` (rev 3). Nothing was merged. Cost: $0 cash (Claude plan usage only, no OpenAI calls, no bulk Supabase reads).

## Merge table (PRs to main)

No file appears in two main PRs (overlap check: 42 files across 5 PRs, 0 shared), so any order merges cleanly. Recommended order by risk is top to bottom.

| # | PR | Cards | Before merge (Josh) | After merge (Josh) | Rollback | Codex? |
|---|---|---|---|---|---|---|
| 1 | P2 [#162](https://github.com/AJWolfe18/TTracker/pull/162) site | 262, 315, 569 | None | GA4 Realtime + PostHog event check, Lighthouse on trumpytracker.com, check EO page category labels | Revert the PR | No |
| 2 | P5 [#159](https://github.com/AJWolfe18/TTracker/pull/159) Tracker chips | 593 | Merge test PR #158, then click through the chips on the TEST site (switch Stories off, "Load earlier" twice, Stories back on: the catch-up marker shows, then goes) | None (frontend only) | Revert the PR | No |
| 3 | P1 [#161](https://github.com/AJWolfe18/TTracker/pull/161) pipelines (replaces closed #151, #153) | 577, 590, 494, 349, 493 (guard only) | Merge test PR #163 so test's scraper matches P1 | Check that the first scheduled PROD RSS Tracker and SCOTUS Tracker runs are green with no Node 20 warnings (494 AC 3) | Revert the PR (code and workflows only, no SQL) | **Yes** |
| 4 | P3 [#165](https://github.com/AJWolfe18/TTracker/pull/165) dash guard | 580 (AC 1, 2) | Merge test PR #168 and re-run [migration 120](https://github.com/AJWolfe18/TTracker/blob/deploy/ado-580-dash-guard/migrations/120_editorial_dash_guard.sql) in the TEST SQL Editor first. Then on PROD: (1) read-only dash count, (2) run migration 120 (its self-test stops it if the URL rule is wrong), (3) its verify query must return 0. All three are in the PR body | Merge test PR #157, then run its steps 5 and 6 (2399/2099 reset), then let the SCOTUS routine run | Rollback SQL in the PR body | **Yes** |
| 5 | P4 [#166](https://github.com/AJWolfe18/TTracker/pull/166) Undo lockdown | 525, 353 | Deploy `admin-undo` to PROD from the `deploy/ado-525-353-undo` checkout (or from test after #167 merges) | Run migration 118, then 119 (order matters) | Rollback SQL for 118 and 119 in the PR body | **Yes** |

Review level that ran: `/code-review medium` on every PR (Codex round 2 fixes re-reviewed at medium: #158, #168, #157 clean; #164 3 doc issues fixed), re-run after each fix round until no finding rated medium or higher remained. #162, #165, #167 were clean on the first pass; #161 clean on its second pass (after the scraper fixes that also live in #163); #166 needed one medium fix (EO id pattern) and one low fix (Undo error text).

## PRs to test (merge these too)

| PR | What | Merge note |
|---|---|---|
| [#158](https://github.com/AJWolfe18/TTracker/pull/158) | ADO-593 fix (same diff as #159) | Before #159 |
| [#163](https://github.com/AJWolfe18/TTracker/pull/163) | ADO-590 warrant-hold review fixes (same scraper as P1) | Before or with #161 |
| [#167](https://github.com/AJWolfe18/TTracker/pull/167) | ADO-525 EO id pattern + Undo error text (same as in #166) | Then redeploy TEST `admin-undo` (`supabase functions deploy admin-undo --project-ref wnrjrywpcadwutfykflu`) |
| [#157](https://github.com/AJWolfe18/TTracker/pull/157) | Guarded PROD SQL: ADO-493 delete, ADO-580 26A124 dissenters, 2399/2099 reset | Steps are in the PR body; reset steps only after P3 + migration 120 |
| [#160](https://github.com/AJWolfe18/TTracker/pull/160) | ADO-594 action tracker design (PRD section 14) | Docs only |
| [#164](https://github.com/AJWolfe18/TTracker/pull/164) | ADO-592 draft agent patterns for 7 fronts (SQL NOT applied) + Hegseth's Pentagon front SQL (applied on TEST; PROD part 3 now targeted) | Docs + SQL files only. PROD paste: [hegseth-pentagon-front.sql](https://github.com/AJWolfe18/TTracker/blob/docs/ado-592-agent-patterns/scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql) after your title/tier/boat-strike decision |
| [#168](https://github.com/AJWolfe18/TTracker/pull/168) | Migration 120 Codex fixes (same file as in #165) | Before #165; then re-run migration 120 on TEST |

## SQL files for Josh (on PR branches until merged)
- ADO-493 delete (STEP 1 must read 1220 / 0 / 8, else stop): `scripts/maintenance/2026-10-01-ado-493-delete-2020-bulk-import.sql` on [chore/sept-leftovers](https://github.com/AJWolfe18/TTracker/blob/chore/sept-leftovers/scripts/maintenance/2026-10-01-ado-493-delete-2020-bulk-import.sql)
- ADO-580 26A124 dissenters (adds Kagan, vote stays 6-3): [2026-10-01-ado-580-trump-v-california-dissenters.sql](https://github.com/AJWolfe18/TTracker/blob/chore/sept-leftovers/scripts/maintenance/2026-10-01-ado-580-trump-v-california-dissenters.sql)
- ADO-580 2399/2099 reset (after P3 + migration 120): [2026-10-01-ado-580-scotus-2399-2099-reset.sql](https://github.com/AJWolfe18/TTracker/blob/chore/sept-leftovers/scripts/maintenance/2026-10-01-ado-580-scotus-2399-2099-reset.sql)
- ADO-592 patterns (do not run until the 592 build): [2026-10-01-ado-592-agent-patterns.sql](https://github.com/AJWolfe18/TTracker/blob/docs/ado-592-agent-patterns/scripts/maintenance/2026-10-01-ado-592-agent-patterns.sql)

## Open decisions (Josh), all written on the cards
- **493:** keep or delete the 8 public 2020 merits cases (ids 1335, 1337-1340, 1343, 1344, 1481)? The SQL keeps them.
- **580 AC 4:** 2392 impact level 3 or 4?
- **494:** AC 4 (done before May 15, 2026) was missed. OK to count it as missed and move to Ready for Prod, with AC 3 checked from the first PROD runs?
- **593:** build the "catch-up" paging (about 15 lines)? Today, switching a chip back on after "Load earlier" hides rows from other sources until "Load earlier" catches up again. The PR bodies describe this. Recommended: yes, as a follow-up.
- **594:** D1 to D8 in PRD section 14 (label set and gold set, allies, bars, fronts, EO/SCOTUS/pardon bar 5 to 4, Said display, 592 skips coverage, PROD backfill of about 15,000 stories at $0 cash).
- **592:** The Courts tight (TEST pool 50) or wide (98)? Recommended tight. Keep Kushner's Gulf terms? Recommended keep. Apply the SQL with the 592 build, not before.

## Proposed cards (not created)
- EO page filters: `filter_category` / `filter_impact` events send `category` and `impact`, which are not on the `shared.js` analytics allowlist, so those filter choices are never recorded (found in the #162 review, older than this session).
- ADO-593 catch-up paging (above), if Josh says yes.

## Card states at end of session
593 Active (moves to Resolved after #158 merges and TEST check) · 590 Resolved · 577, 349, 353 Ready for Prod · 494, 525, 569 Testing · 580, 493, 594 Active · 592 Todo · 262 Resolved · 315 New (Resolved after the EO page check).

## How the session ran
- Fable advisor pass first: 13 points, all valid, folded into plan rev 3 (626e539). The one blocker: 74b505e and 7cb1d43 both edit `docs/ARCHITECTURE.md`, so 74b505e moved from P3 into P1.
- 6 lanes (A, B1, B2, D, E, F), at most 4 running at once, each in its own scratchpad worktree with `node_modules` swapped for a junction (see memory convention, October 1, 2026). All worktrees removed at the end; the main copy stayed on `test` throughout.
- Review loops: #160 (design doc) took 3 rounds and #163 (warrant hold edge cases) took 5. Each round found smaller gaps; the final rule for #163 is that the only path that inserts a guessed `pardon` is the over-the-limit path with a counted hold history.
- No ADO-572 (Social tab) or ADO-583 text reached any main PR; checked by grep on the P1 docs/package diff and on the P4 `admin.html` cherry-pick.

## Not in scope (Josh only, carried over)
- ADO-582: pin Missouri 15902 in PROD, then close (SQL in the September 30 handoff).
- `feed_registry` 21/22 check (owed since September 15).
- ADO-591: Suzula Bidon (id 147) review in PROD admin.
- PROD review queue for pardons 120 and 139-143 (blocks closing ADO-553).
- TEST click-through for 525 Undo, 315 labels and 262 search.
- ADO-585 Supabase DB size decision. 579, 576 and 564 decisions.

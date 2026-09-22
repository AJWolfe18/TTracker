# Handoff: pardons run red (DOJ blank page), EO 14426 review, ADO-589 signing-date fix shipped to PROD (September 21, 2026, evening)

All clock times are Central (CT). UTC = CT + 5 hours. Session ran about 8:00 PM to 11:00 PM CT.
Previous handoff (September 20, afternoon): `2026-09-20-pm-security-scan-prs-merged-ado-577-codex.md`.

## Outcome in one line
The pardons failure is a DOJ-side blank page and needs no code; every other pipeline and the Claude
routines are healthy and publishing; EO 14426 is fact-checked and publish-ready; and a real bug found
during that review (every EO showed the wrong "Signed" date) was fixed, reviewed three times, merged as
PR #152 and backfilled on PROD (278 rows) in the same session. ADO-589 is Closed.

## 1. Track Pardons failed today: DOJ published an empty page
- Run `35659562247` on main (4:51 PM CT): DOJ page fetched (HTTP 200, 79 KB), parsed 0 pardons, exit 1.
  Yesterday's run parsed 171 (newest grant September 8, all already in the DB).
- Root cause: the page's `Last-Modified` header is 2:22 PM CT September 21. The `<main>` article now holds
  three empty layout regions. Sibling DOJ lists (Biden pardons, clemency statistics) still render tables,
  and the Clemency Recipients landing page still links the same URL, so the list was not moved.
- Still blank at 9:16 PM CT (local dry run of the scraper reproduced 0 pardons). Wayback was offline, so
  the run logs bracket the change instead.
- Downstream steps ran clean, the Discord failure alert fired, no data lost. The scraper did its job:
  fail loudly. The daily run goes green on its own when the DOJ restores the body.
- NOT re-run manually: same code, same page, would only add a red run and a Discord ping.
- Watch item: the 1 PM CT run on September 22. If the page is still blank around September 24, that is a
  planning conversation (fallback source such as the per-date warrant PDFs), not a quick fix. Optional
  hardening, not done: scope the scraper's content selector to the main article so a blank page reports
  "content div not found" instead of "structure may have changed" (`scripts/ingest/doj-pardons-scraper.js`
  around line 135).
- Added a Quick Check for this to `docs/common-issues.md`.

## 2. Other pipelines and routines: all healthy (checked 9 PM CT)
- GitHub Actions on main in the last 24 hours: RSS Tracker PROD 4/4 green, Health Check 4/4, Judge
  Executor 4/4, EOs green, SCOTUS green, Skips Cleanup green. Pardons is the only red.
- Routine-silence step at 4:37 PM CT: judge fresh (1:48 PM), stories fresh (3:46 PM).
- The health check's twenty "completed - runnable" job lines with a red X are the same twenty legacy
  job-queue rows in every run for days: cosmetic.
- PROD content since midnight CT: 50 stories clustered, 56 enriched (55 with spicy summary + alarm level at
  claude-v1, 1 merged), 0 failures, 0 active waiting. Live stories-active endpoint serves them with both
  summaries. `enrichment_status` is null on every story enriched in the last week on both DBs; the Claude
  agent does not write that legacy field and the site does not read it.
- SCOTUS 184 public, 0 unenriched. Pardons 140 public, 0 pending, 0 in review. EO 14428 (water quality)
  ingested 3:18 PM CT, waits for the EO agent's ~11 AM CT run.

## 3. EO 14426 (veterans' benefits): reviewed, publish-ready, waiting on Josh
- Flagged only by the prompt's Level 0 policy (every alarm-0 order goes to human review, no gold-set
  example yet), not by doubt about content.
- Every hard fact checked against the Federal Register text (91 FR 58003, signed September 8, 2026):
  Departments of War and VA, 30/120/180-day deadlines, Section 3 job-placement mandate, all six statutes.
  Two soft research claims (records wait of "three to twelve months", "every administration since
  George W. Bush") are framing, not blockers. Tone matches Level 0 ("Reader, we checked twice"), no
  banned openings, no em dashes.
- ACTION FOR JOSH: admin dashboard, Executive Orders tab, highlighted row, Publish. No edits needed.

## 4. ADO-589: EO "Signed" date was the publication date (found, fixed, shipped, closed)
- Bug: schema and site define `executive_orders.date` as the signing date ("Signed" label,
  `src/lib/adapter.ts`), but `scripts/executive-orders-tracker-supabase.js` wrote `publication_date` into
  it while already fetching `signing_date`. All 278 PROD rows had date = publication_date. An archived
  backfill (`scripts/archive/backfill/backfill-eo-signing-dates.js`) fixed the data once in 2025 but not
  the tracker, so it regressed. TEST showed the same pattern for everything after EO 14417.
- Fix (test commits 418d11d, 3450e58, 24ddec1, a690c91; main squash f437414 via PR #152):
  - `scripts/lib/eo-dates.js`: `pickEoDate()` (signing, then publication, then today) with real
    calendar validation (2026-09-31 rejected); `resolveBackfillDate()` for existing rows never falls back
    to publication_date (an invalid signing date leaves the row alone).
  - `scripts/maintenance/backfill-eo-signing-dates.js`: `--env test|prod` required, PROD write needs
    `--confirm-prod`, `--dry-run`, keyset pagination on id (text on PROD, int on TEST), 15 s fetch timeout
    with two retries on 429/5xx, run-wide circuit breaker after 5 consecutive failures (stops with summary
    and resume point, exit 1), stdout `out()` helper (no console.log).
  - `executive-orders-tracker.yml`: dispatch input `backfill_signing_dates` runs the backfill through
    Actions secrets, before the tracker refresh; never fires on schedule.
  - `scripts/tests/eo-signing-date.test.mjs` (`qa:eo-dates`, in `qa:smoke`): 10 tests incl. guards that
    the tracker maps via the helper and that the backfill does not import the fallback helper.
- Reviews: in-session `/code-review medium` (1 low finding: timeout/retry, fixed); Josh's local Codex pass 1
  (3 P1s: calendar validation, backfill fallback, workflow-timeout breaker, all fixed); Codex pass 2 (one
  AGENTS.md P1, console.log, fixed); final pass clean.
- Verification: TEST backfill dry run 17, real 17, rerun 0 (EO 14420 August 14 -> August 10). Forced-429
  simulation (fetch preload) stopped at row 194 of 223, exit 1. `qa:smoke` exit 0, 18 suites.
- PROD: run `35683695947` on main with `backfill_signing_dates=true` at 10:35 PM CT: found 278, updated 278,
  0 errors, 0 not reached, tracker refresh ran after. EO 14426 date = September 8, 2026. Inauguration-week
  orders moved up to 11 days (EO 14147: January 28 -> January 20, 2025).
- All five AC recorded MET on the card; state Resolved then Closed. Cost $0.

## 5. Gotchas worth keeping (also in project memory)
- Cherry-pick to main hit conflicts in three files because test carries the unmerged ADO-577 alert step.
  The first resolution leaked that step (its script does not exist on main). Fix: slice the resolution to
  your own block's end and `git diff origin/main..HEAD` the deploy branch before pushing. Files on main are
  CRLF, test LF: conflict-marker regexes need `\r?\n`. Repo rejects merge commits: `gh pr merge --squash`.
  Work in a scratchpad `git worktree` off `origin/main` so the test checkout stays untouched.
- Josh asked "did you at least do a medium code review?": run `/code-review medium` in-session on any
  non-trivial change and say so before calling it done. Agent reviewers are denied in this repo.
- AGENTS.md P1 "console.log in production code" applies to maintenance scripts; the accepted pattern is
  the one-line stdout helper from `scripts/monitoring/alert-routine-silence.js`.

## 6. Open items for the next session
1. Pardons: check the September 22 1 PM CT run. Still blank on ~September 24 means plan a fallback source
   (card then). The selector-scoping hardening is optional.
2. Josh: Publish EO 14426 in admin.
3. PR #151 (ADO-577 needs-review Discord alert) is still open, waiting on Josh's Codex re-run and merge.
   Once merged, the EO workflow on main gains the alert step that was deliberately left out of #152.
4. Unchanged from the previous handoff: TEST service key rotation (Josh), ADO-587 discussion, ADO-588 AC 6
   needs a PROD pardons run with real work (blocked by the blank DOJ page for now), Supabase DB-size quota
   decision.

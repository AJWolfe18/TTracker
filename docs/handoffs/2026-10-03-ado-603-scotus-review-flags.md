# ADO-603: SCOTUS review-flag pile-up and the stale Callais write-up (October 3, 2026)

**Status:** Resolved (ADO-603). Everything is on main and PROD; nothing is waiting on Josh.

## What Josh saw

A pile of SCOTUS cases in Discord, all marked "needs review". There were 38 open flags on PROD, and none had ever been reviewed.

## Why it looked sudden

The over-flagging rule had been in the agent prompt since launch (April 4, 2026). The needs-review Discord alert (ADO-577) only reached main on October 2 (PR #161). Its first PROD runs posted six months of silent flags at once.

## Root causes

1. **The flag rule was wrong for unsigned orders.** The prompt said to flag any case where "the text does not explicitly state the vote split". The Court never prints a count on shadow-docket orders, cert denials, DIGs or per curiams; the noted dissents are the record. 34 of the 38 reasons were "vote inferred from noted dissents".
2. **The agent skipped vote and author fields on those orders.** That left the fetcher's CourtListener seed in place, which is often the dissent writer stored as `majority_author` in full-name form (for example, Danco showed Alito, who dissented). About 10 rows were affected.
3. **One docket can carry several decisions.** Louisiana v. Callais (row 1678) was enriched on April 5 from the 2025 reargument order. The April 29, 2026 merits ruling (6-3, Alito) then replaced the row's text, because the fetch dedupes on docket number. Nothing re-queued it, so PROD showed "punted to reargument" at impact level 2 for five months.

## What shipped

| Change | Where |
|---|---|
| Prompt: unsigned-order vote convention, `majority_author` null on those, always write vote/author fields, dissenter-count consistency check, "is this the decision `decided_at` names" check, Lab Corp gold example no longer flagged | `docs/features/scotus-claude-agent/prompt-v1.md`, PR #171 |
| Fetcher: a later cluster on an enriched row re-queues it (clears the old review stamp) and posts to Discord; a row on admin `flagged` hold is reported only; an older cluster is skipped and logged to `pipeline_skips` as `older_decision` | `scripts/scotus/refetch-guard.js`, `fetch-cases.js`, `qa:scotus-refetch`, PR #171 |
| One-time PROD data fix: clear 18 verified flags, re-queue 18 rows with wrong facts | `scripts/maintenance/ado-603-scotus-flags.js` (job, PR #172, removed in #173); the SQL twin `scripts/maintenance/2026-10-03-ado-603-scotus-review-flags.sql` is test-only and was never needed |
| Docs | `docs/reference/scotus-agent.md`, `docs/reference/discord-alerts.md` |

## How PROD was fixed without the SQL Editor

Josh was away from his PC. The claude.ai Supabase connector only sees WhiskeyPal, so this session had no PROD SQL. Instead:

- A `workflow_dispatch` job on main ran the same writes through PostgREST, using the existing `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` secrets.
- The job only runs from main, checks every id against its expected case name, and its filters make a second run change nothing.
- A dry run went first, then the real run: run 37163008600.
- The job log holds every row's before-values as the rollback record.
- The workflow was deleted after the run (PR #173).

The re-runs were then started by firing the PROD SCOTUS routine through RemoteTrigger. Auto mode was off, so the call was allowed.

## Verification

- All 20 re-queued cases (the 18 above plus 2099 and 2399 from the ADO-580 reset) were re-enriched in about 10 minutes.
- Every one came back high confidence with no flag, and the minority vote matches the dissenter count on every row.
- Spot-checked against public reporting:
  - Callais: 6-3, Alito, Kagan/Sotomayor/Jackson dissenting, impact 5.
  - Danco: no majority author, Thomas and Alito dissenting.
  - A.A.R.P.: 7-2 (Thomas joined Alito's dissent).
  - Hamm v. Smith: 5-4 DIG.
  - Ballroom order (2399): 5-4, Roberts plus the three liberal justices dissenting. It previously showed 8-1.
  - Saldaño: 6-3.
- Open SCOTUS review flags on PROD: **0**. EO has 1 open flag and Pardons has 0, so neither has the same pile-up.

## Reviews

- `/code-review` medium on fdafac3 found 2 issues: the re-queue kept the old review stamp, and a row on admin hold went unreported. Both were fixed in fd2bf0c.
- A low-level re-review of the fix found nothing.
- `/code-review` medium on the one-time job (2e35447) found nothing.
- `qa:smoke` passed.

## Gotchas for next time

- Agent prompts are read from main at run time, so a prompt fix must merge before any re-queue, or the rows get flagged again under the old rule.
- An enriched row only re-enters the agent's queue when `enrichment_status` is set back to `pending`. Editorial copy and `is_public` stay live until the agent rewrites them.

## Later in the session: home page load speed (ADO-605) and the traffic report

- **Traffic report artifact:** the column was widened from 44rem to 52rem at Josh's request (same URL).
- **Dead swipes are not a speed metric.** The report's "11 of 25 phone visitors swiped and nothing moved" counts PostHog `$dead_swipe` events: a gesture that changed nothing on screen. Nothing on the home page scrolls sideways (`body` has `overflow-x: hidden` and there are no carousels). Some of these may be swipes made during the 1 to 2 seconds before stories render. The check (watch 3 PostHog replays, and re-count after ADO-605 ships) is written on ADO-605.
- **Load speed was measured,** not guessed, with `scripts/perf/phone-load.mjs`: Galaxy S9+ emulation, first visit, CPU 4x slower, analytics blocked.
  - First Tracker entry: 0.6 s on Wi-Fi, 1.7 to 2.0 s on 4G, 2.8 s on slow 4G.
  - Cause: a serial chain. HTML, then JS, then `flags-prod.json`, then the Tracker's 6 PostgREST calls, each about 0.2 s. The database is not the bottleneck.
  - Also, every `/assets/*` file is served `max-age=0, must-revalidate`, so returning visitors re-check every file.
- **Plan and acceptance criteria are on ADO-605** (Todo, own session). Lazy loading was discussed and ruled out: the stories are the first thing on screen, so the fix is starting their fetch in parallel with the flag file, not deferring anything.
- **Gotcha:** the anonymous PageSpeed Insights API quota was exhausted. Use the local Playwright script instead (Chrome is installed, and `playwright` is already a devDependency).

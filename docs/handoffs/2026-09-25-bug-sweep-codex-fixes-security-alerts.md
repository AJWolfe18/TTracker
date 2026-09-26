# Handoff: bug sweep, Codex fixes on PRs #151/#153, undo lockdown, dash guard (September 25, 2026)

Session ran about 9:30 PM to 11:30 PM CT. Previous: `2026-09-23-ado-590-591-pardons-mixed-types-constraint.md`.
Josh stopped the session to clear context. **The in-session code review has NOT been run on today's commits yet**; do that first (`/code-review medium` over `cdd67d5..HEAD` on test).

## Josh's open steps
1. **PROD SQL tab in Chrome** ("Untitled query", TrumpyTracker): the ADO-590 May 2025 fix is loaded. Press Ctrl+Enter. Expect 2025-05-28 = 16 pardon + 6 commutation, 2025-05-29 = 1 + 2. (Not run as of 11:25 PM CT: anon REST still shows 21 public commutations.)
2. **PROD admin: Suzula Bidon (id 147)**: set level 0 and publish if the write-up supports it (ADO-591 AC 2+3).
3. **Codex re-run on PR #153 and PR #151** (both updated with fixes). Merge #153 first; #151 may need a re-merge of main after that (both touch the pardons scraper).
4. **PROD review queue: pardons 120, 139-143** (researched while web search was broken; approve or re-queue). Blocks closing ADO-553.
5. **Test round on TEST** (site: test--taupe-capybara-0ff2ed.netlify.app): admin Undo on a story, a pardon and a SCOTUS case (ADO-525); legacy /executive-orders.html shows Education and Technology labels, no "Uncategorized" (ADO-315); pardons/EO search still works (ADO-262).

## Done today (all on `test`, pushed)
| Commit | Card | What |
|---|---|---|
| 0016d16 | 494 → Testing | Workflows on Node 24 action majors (checkout/setup-node/upload-artifact v7), runtime Node 22; 5 dispatched runs green, 0 deprecation warnings |
| 2f3439e | 262 → Resolved | EO/pardons search analytics send query_length only |
| 2b822d6 (+PR #153) | 590 | Codex P1: unreadable warrant holds the row up to 3 runs (MAX_WARRANT_HOLDS), then inserts as pardon + flag |
| daec01b (+PR #151) | 577 | Codex P1s: review-queue flags never age out (older ones remind Mondays CT, Josh's decision), postDiscordReported for new-work alerts, no new console.log |
| 7cb1d43 | 577/590 | docs/reference/discord-alerts.md = single source for alert rules; common-issues warrant-hold rule |
| c5feacf | 349 → Testing | Failure alert step on EO, SCOTUS, skips-cleanup workflows |
| 861a405 | 525 → Testing | admin-undo edge function (deployed to TEST), admin.html Undo via it, migration 118 (applied TEST): anon can no longer call undo_content_change |
| 068793c | 353 → Testing | migration 119 (applied TEST): WITH CHECK + NOT NULL on admin audit tables |
| d12e987 | 315 | legacy EO page category labels match the eo_category enum |
| c635b8f, 74b505e | 580 (Active) | migration 120 (applied TEST): em/en dash guard trigger + backfill on 4 tables; rule in ARCHITECTURE.md |
| 3e8b647 | 580 | SCOTUS prompt Step 3: full opinion before the 15K excerpt, keep first 24K + last 6K |
| c625637 | 569 → Testing | analytics-gate loads GA4/PostHog after load + idle; vitest 182/182 |
| (ADO only) | 278, 223 | closed as obsolete with evidence |
| TEST DB | 591 | migration 063 applied on TEST (0 accepted, 6 rejected) |

## In progress, UNCOMMITTED in the working tree (ADO-493)
- `scripts/scotus/decided-at-guard.js` (new): checkDecidedAt + DEFAULT_SINCE_DATE '2024-10-01'.
- `scripts/lib/skip-reasons.js`: PIPELINES.SCOTUS_FETCH, REASONS.MALFORMED_DECIDED_AT.
- `scripts/scotus/fetch-cases.js`: default since 2024-10-01 (was 2020-01-01, the root cause of the February 23 bulk import); guard skips + recordSkip before processCluster.
- Still to do: unit test for checkDecidedAt (+ add to qa:smoke), commit, then the cleanup DELETE (card SQL) on TEST, then PROD by Josh.
- Finding: the 1,220 rows are real 2020 orders, not malformed dates. **8 of the Feb 23 imports are PUBLIC 2020 merits cases on PROD** (ids 1335, 1337-1340, 1343, 1344, 1481, e.g. McKinney). The card's DELETE only targets flagged rows; ask Josh whether the 8 public ones stay.

## PROD rollout notes (for the deploy PRs)
- ADO-525 order: deploy `admin-undo` to PROD, merge admin.html, THEN run migration 118 (else Undo breaks). Then 119.
- Migration 120 on PROD rewrites about 177 SCOTUS, 266 EO, 10 pardons, 6,132 stories rows (updated_at moves on SCOTUS/EO/pardons; story last_updated_at verified unchanged on TEST).
- ADO-580 AC 2 needs the prompt on main, then reset + re-run SCOTUS 2399 and 2099.
- ADO-569, 262, 315: verify on PROD (GA4 realtime / PostHog / Lighthouse) after deploy.

## Gotchas learned
- Worktrees: the #151 deploy branch tracks part of node_modules, so `mklink /J node_modules` fails there; copy scripts/config/package.json to a scratch dir and junction there.
- Bash tool heredocs collapse `\\`; jq filters with `\s` go in a file (`scratchpad/card.jq`).
- ADO Bug type has no "Removed" state; use Closed.
- Supabase SQL Editor: the ref-based Run click sometimes does nothing; clicking (1524,70) works; DDL with UPDATEs shows the "Potential issue" dialog (Run query at ~863,427).

# Handoff: ADO-581 on PROD, closed; session 2 split to ADO-582 (September 14, 2026)

Josh: "where did we leave off, what was next." Answer: ADO-581 session 1 was sitting in Testing with PROD blocked on the migration. This session finished it end to end.

## Decisions (Josh, September 14, 2026)
1. **Claude runs PROD via Chrome** - navigation to the PROD Supabase project was allowed this session (it had been denied on September 8). `gh workflow run` on the PROD RSS workflow is still denied by the auto-mode classifier ("Production Deploy"); scheduled runs cover it.
2. **Redistricting is OUT of the election regex.** PROD dry run with the September 8 pattern: 398 unassigned candidates, 357 at alarm 3+, of which 125 were map fights (gerrymander / redistrict / congressional map / district map). Under the floor-3 rule that would have swamped the main line. Pattern and co-word lost those terms (commit 9859ea8), TEST events row updated to match. The session-2 agent (ADO-582) handles redistricting with judgment.

## What happened on PROD (in order)
| Step | Result |
|------|--------|
| Migration 115 (edited pattern) via SQL editor | Success. No rows returned |
| Dry run, final pattern | alarm 5: 29 · alarm 4: 132 · alarm 3: 49 (2 residual redistricting headlines that also carry a real election term) |
| `assign_fronts_sweep(NULL)` | 12,802 candidates, 288 assigned: election 240, iran 34, epstein 6, kushner 3, crypto 3, qatar 1, ballroom 1 |
| Hand-assign 14648 / 14592 / 14688 | 0 rows (regex already caught all three) |
| `refresh_tracker_derived()` | 224 rows changed, 9.5 s; main line 1,385 -> 1,609 |
| Verify | all three `main_line = true` under election-suppression; 0 alarm-3+ election members off the main line; 307 election members |
| trumpytracker.com | "Whistle-Blower: Federal Agents May Have Broken State Laws in Search For Voter Fraud" at the top, tagged Election Suppression |
| Feeds | Votebeat id 21, Democracy Docket News Alerts id 22, active |

## Code to main
PR #143 squash-merged as `fea57ef` (02aa28c + 096a824 + 90f9e41 + 9859ea8 + a lint fix). Cherry-pick conflicts: main lacks ADO-572 (social) and ADO-577 (Discord alerts), both still Testing, so `package.json`, `skip-reasons.js` and `scotus-tracker.yml` were resolved to "main + only the 581 lines"; the ADO-554 seed SQL was never on main and stays deleted there; the schema doc took the incoming block (adds the migration-113 sections main's copy lacked). Every 581 file on the deploy branch was byte-identical to test; `qa:smoke` green on the branch.

**Lint PROD References** failed once: the runbook's first comment line carried the PROD project ref. Removed the ref (not an allowlist change). Any `scripts/` file that names `osjbulmltfpcoldydexg` fails that check.

## Gotchas found this session
- **PROD has no `feed_compliance_rules` table** (42P01). The CLAUDE.md "every feed MUST have a compliance row" rule is a TEST-only reality; `fetch_feed.js` defaults to 5000 chars / full text allowed when the `.single()` lookup fails, so every PROD feed already runs on defaults. Noted on ADO-581; needs its own card if the per-feed cap matters on PROD.
- **SQL editor batches:** only the last statement's result shows, so collect step results in a `CREATE TEMP TABLE` + `json_agg(...)::text` and read the grid cell via `document.querySelectorAll('[role="gridcell"]')`. The temp table triggers a "Potential issue detected: RLS" dialog - "Run without RLS" is correct.
- **A dirty working tree aborts `git checkout -b` but not the following cherry-pick**, which then runs against the CURRENT branch (it hit `test` and conflicted). Stash `supabase/.temp/cli-latest` before branching; check `git branch --show-current` after.
- The editor tab's `beforeunload` blocks `tabs_close_mcp` even after nulling `onbeforeunload` - close it by hand.

## ADO
- 557 Closed (delivered under 581). 581 Closed with AC verification on the card (AC 3 PROD CI proof and AC 4 first PROD fetch land with the 02:00 UTC September 15 scheduled run - check the "Assign stories to fronts" step in `gh run list --workflow rss-tracker-prod.yml`).
- **ADO-582** created (New): election front assignment agent, election front only, state-action rubric, one story_event row assigned_by='agent' with confidence, FRONT_ASSIGNMENT skips on decline, backfill then daily. Parent epic 543, related 581. Cost $0 marginal.

## Still owed by Josh (unchanged)
ADO-579 numbers for EO 14420 / 14407; ADO-580 (2392 level 3 vs 4); SCOTUS routine cron `0 16,23 * * *` never confirmed; ADO-564 north-star numbers (was due September 7); 572 / 577 verification on TEST then PROD deploy; `.agents/` and `exec brief for blueprint.png` untracked at repo root.

## Next-session prompt
```
/start-work ADO-582: election front assignment agent (Claude, election front only). Read docs/handoffs/2026-09-14-ado-581-prod-deploy-and-close.md and the session-2 section of docs/handoffs/2026-09-08-ado-581-fronts-sweep-alarm-floor.md. Replicate the SCOTUS/Stories cloud-agent shape. Candidate pool = unassigned active stories with an election word (co-word list + redistrict/gerrymander/congressional map) in headline or summary_neutral; rubric = state action that changes who can vote, how votes are counted, who certifies, or district maps (assign) vs horse-race/commentary/history (decline). Backfill on TEST first, spot-check 30 decisions, then daily step after assign-fronts.js and before refresh-tracker.js. First: confirm the 02:00 UTC September 15 PROD RSS run logged the "Assign stories to fronts" step and that Votebeat / Democracy Docket produced articles.
```

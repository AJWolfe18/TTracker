# October 15, 2026: pipeline alert review, Judge publish script (ADO-634), #191 review

**Cards:** ADO-634 (new Bug, Active) · ADO-635 (new Bug, New) · ADO-343 (Review, comment)
**PRs:** #192 to main (ADO-634, waiting for Josh's Codex) · #191 to test (ADO-343, review fixes pushed, waiting for Josh's Codex)
**Cost:** $0 cash. One TEST Judge routine run (subscription), small TEST reads, GitHub log reads.

## 1. Alerts traced (all times CT)
| Alert | Cause | Action |
|---|---|---|
| SCOTUS Tracker (PROD) failed, 3:40 PM | `npm ci` ECONNRESET on the GitHub runner, not our code | Re-ran run 38803889631: success, 0 flags, fronts + tracker refresh ran |
| Judge "silent", 11:11 AM health check | The 12:12 AM Judge run was denied by the cloud classifier while building its verdict file | ADO-634 (below) |
| Ingest health: WaPo Politics quarantined | Every feeds.washingtonpost.com feed (politics, national, world, business) returns 502 from WaPo's nginx | Nothing to fix; the daily retry (ADO-625) recovers it. Swap the URL only if it is still down around October 22 |
| EO needs-review, 3 flagged | Known: 14435 + ADO-616 (14426, 14433) | Josh reviews in admin |

Clean: Stories (fresh every run), Pardons, fronts, Stories digest (0 flags), ingest health on October 14.

Also seen, not alerting:
- `[candidate-gen] ANN block error: statement timeout` 3-6 times in every PROD RSS run since at least September 19 → **ADO-635**.
- `preflight-check.js` in the health check prints about 20 "Job #NNNN: completed - runnable" lines from the legacy job_queue. Noise only, step passes. No card.
- RSS Tracker PROD still runs about 5 times a day instead of 12 (GitHub drops schedule slots). This was proposed as a card on October 13 and is still Josh's call.

## 2. ADO-634: Judge loses about 1 in 7 runs to the classifier
Six of about 42 PROD runs since October 2 published no `judge-run/prod/*` branch: October 2 (13 UTC), October 8 and 9 (21 UTC), October 11, 12 and 15 (05 UTC). The run logs for October 12 ("Blind Apply") and October 15 ("Modify Shared Resources") show the judging finished and then the denial hit the agent's own improvised heredoc/node code that builds `judge-inbox/<run_id>.json`. The `auto_mode_*` fields (playbook option 1) are no longer enough.

Fix (playbook option 2, as for the Election front routine):
- `scripts/clustering/judge-publish.js` (dependency-free). `candidates` returns the RPC pairs (0.83 / 7 / 30) plus the run id and `decisions_path`. `publish <decisions.json>` fills headlines, `centroid_sim`, `evidence_as_of`, environment and mode from the saved rows, runs the executor's `validateVerdictFile`, commits the one file on `judge-run/<env>/<run_id>` and pushes it (one retry). A bad decisions file exits 2 with nothing written.
- `.claude/settings.json`: `Bash(node scripts/clustering/judge-publish.js *)`. Main's copy differs from test's, so in the PR only that line is added.
- Prompt v1.3: the agent writes only a decisions file (Write tool) and must never improvise build/publish code. Scratch lives in the gitignored `.judge-work/` inside the repo; a Write to /tmp would be outside the project and screened.
- Executor and workflow unchanged; `pairKey` is now exported.

Verified:
- `qa:smoke` passes on test; `qa:judge-executor` and `qa:agent-prompts` pass on the main branch.
- Live `candidates` against TEST.
- E2E `publish` into a throwaway local bare repo: one commit, apostrophes intact, a second call is a no-op.
- TEST routine run `cse_01HioPpgTBRS1G2pJW1ZdGQD` (10:08 PM CT): the agent used only the script + Write; 0 denials; 30 verdicts (3 merge / 23 keep / 4 uncertain) published in 102 s, against 160-190 s for the old flow. TEST settings allow `Bash(*)`, so this proves the flow; the rule is proven by the front routine.

Review: `/code-review medium`: 7 real, all fixed (scratch moved out of /tmp, errors name the pair, string ids, unreadable candidates, stdout drain, shared helpers, test path). 2 not real: a re-push after the executor consumed a branch (the agent only retries when nothing was pushed, and the executor is idempotent per run_id), and a mode change between calls (the environment is fixed per session).

**To finish:** Josh's Codex on #192 → merge (squash) → watch the next 6 PROD Judge runs (RemoteTrigger `list_runs` / `get_run_log` on `trig_01DDXZkpC9PkgTzU8wDdL9QM`, 0 `permission_denied`) → AC 5 → Resolved/Closed. No migration, no edge function; the routine reads main at run time.

## 3. PR #191 (ADO-343 Feeds tab) review
`/code-review medium`: 5 real, fixed in 7845a91 on `feat/ado-343-feeds-tab` (worktree `C:\Users\Josh\GitHub\TTracker-feeds`); `admin-feeds` redeployed to TEST. JSX checked by an esbuild compile of the babel block.
- Reset failures on an inactive feed no longer says it will be fetched.
- The `feed_not_found` 404 reason is read from FunctionsHttpError.
- The activate message uses the server's `failing_threshold`.
- The nav opens Feeds unfiltered.
- A null JSON body is a 400.

Not real: the 1,000-row cap and the extra round trips (about 40 feeds). Josh's call: activate/deactivate/reset write no audit trail, unlike the other admin writes (noted on ADO-343).

## 4. Session gotcha
The local auto-mode classifier refused to write `judge-publish.js` ("Auto-Mode Bypass", because its purpose is to clear the cloud classifier) and then refused even read-only `gh` calls. Josh left auto mode and the work went through with normal prompts. Recorded in memory.

## 5. Later the same evening: #191 merged
Josh's Codex on #191 found 1 P2: Home's feed counts stayed stale after a Feeds action until the 5-minute stats poll. Fixed in 4a912b9 (FeedsTab calls the parent's `fetchStats` after each successful action). #191 was squash-merged to test as **6abe924**, and ADO-343 moved to **Testing**. ACs 1-4 are met; the 375px layout is built but not yet checked in a browser, which is noted on the card. The `TTracker-feeds` worktree is left in place: never `git worktree remove` one with node_modules junctions (memory gotcha).

**#192 is NOT merged.** Josh's pasted Codex result named only #191's file, so #192 (ADO-634) still needs its own Codex pass.

Why GitHub skips the news runs (Josh asked): GitHub's scheduler is best effort and drops queued scheduled jobs under load, worst at the top of the hour, and `rss-tracker-prod.yml` runs at `0 */2`. Recommended: move the cron to `:17` (a small PR to main, $0) and count runs for 2 days; if it is still well under 12 a day, use an external trigger (routine or free cron service calling workflow_dispatch). Josh has not approved it yet.

## Josh decisions open
1. Codex on #192 (ADO-634), then merge it to main.
2. Audit trail for Feeds tab writes: add one, or accept none.
3. Still open from October 13: the RSS PROD schedule card, ADO-602 AC 1, ADO-495 AC 3, the 524/594/592 PROD batch with #186/#187/#189.

## Next session
1. After #192 merges: check 6 PROD Judge runs for 0 denials, then close ADO-634.
2. WaPo: if still 502 around October 22, find a replacement feed (score it with `scripts/rss/scorer.js` first).

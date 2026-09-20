# Handoff: Judge health check, executor poll times, ADO-586 built, the hidden September 8 pardon (September 20, 2026)

All clock times are Central (CT). UTC = CT + 5 hours. Session ran about 12:45 PM to 1:40 PM CT.
**Read the Addendum at the bottom too: it supersedes parts of sections 2, 3, 4 and the ADO list.**

## Outcome in one line
The PROD Judge is healthy after last night's fix (2 of 3 scheduled runs checked, both clean). Two PRs to
main are open for Josh: #147 (executor poll times) and #148 (ADO-586, routine silence alert). The
"missing" September 8 pardon is sitting in the admin review queue, and the reason is that the Pardons
agent's web research no longer works.

## 1. PROD Judge after the auto-mode fix (routine `trig_01DDXZkpC9PkgTzU8wDdL9QM`)
| Scheduled run (CT) | Published | Denials | Executor |
|---|---|---|---|
| 12:04 AM | yes | 0 | 30 rows logged, 0 merged (its 5 merge pairs were already merged by the hand-fired run). Taken from the previous handoff, log not re-read. |
| 8:05 AM (`cse_01KcpYL75agfVPfVAjWNtp8m`) | yes, `judge-run/prod/judge-2026-09-20T13-06-03.934Z` | 0 (no `permission_denied` in the log) | run `35524249839`: merged 15386 into 15357, 15404 into 15383, 15395 into 15359. Deferred 0, failed 0, 30 rows, digest sent, branch deleted |
| 4:03 PM | NOT YET CHECKED | | |

Changed on the routine (Josh approved in this session): the start-up message. It implied the agent does
the live merges; the 8:05 AM run noticed and said so. It now says the agent only pushes the verdict file
and the executor on main merges. The update resent the FULL `session_request.config`; the `auto_mode_*`
fields read back unchanged. The 4:03 PM run is the first with the new message.

## 2. Executor poll times (Josh asked) - PR #147
GitHub started the executor's `:30` polls 3 to 5 hours late (8:30 AM poll ran at 11:56 AM). The RSS
tracker (`0 */2`) is late too and skipped two overnight slots. New schedule: `23,53 5,13,21` and
`23 6,14,22` (23, 53 and 83 minutes after each Judge run). Best effort only: GitHub does not promise
schedule times. The Judge prompt now says never to promise a time in the push notification. Cost $0,
about 90 more Actions minutes a month, which are free because the repo is public (Addendum C). Test commit `68303d0`. https://github.com/AJWolfe18/TTracker/pull/147

## 3. ADO-586 built - PR #148, card is Ready for Prod
- `scripts/monitoring/alert-routine-silence.js`: newest row of `clustering_judge_log`
  (`source = judge-agent`, 12 hours) and `stories_enrichment_log` (6 hours). One Discord message per
  silent routine, none when fresh, a failed read posts its own message. Exit behaviour changed after Codex review (Addendum B).
- Step added to `rss-health-check.yml`, `if: always() && github.ref == 'refs/heads/main'`,
  `continue-on-error`. Optional repository variables `SILENCE_HOURS_JUDGE` / `SILENCE_HOURS_STORIES`.
- `scripts/tests/routine-silence.test.mjs` = `qa:routine-silence`, added to `qa:smoke`.
- Test commits `e049960` + `1586084` (playbook note). `package.json` conflicted on the cherry-pick:
  main's smoke list has no `qa:social` / `qa:alerts`; resolved by keeping main's list plus the new test.
- Known limit: the executor writes the Judge rows and runs late, so two batches can land a little over
  12 hours apart and cause one false alert. If it happens set `SILENCE_HOURS_JUDGE` to 14.
- After merge: open the next "RSS Pipeline Health Check" run on main, look for two lines starting
  `[routine-silence]` that say `fresh`, then close the card. https://github.com/AJWolfe18/TTracker/pull/148

All 8 acceptance criteria are recorded MET on the card (AC 1 and 2 get their live proof after merge).

## 4. The September 8 pardon Josh could not see
- It ran. The DOJ scraper has all 171 pardons (newest September 8) and counts them as duplicates.
- The pardon is Emory Clash Jones, id 173. The agent enriched it September 16 at 3:09 PM CT and set
  `needs_review = true`, which forces `is_public = false` until Josh approves it in admin (Pardons tab).
- The public site shows 9 of the 29 September 3 pardons and none for September 8. Four of the hidden
  September 3 rows are confirmed held the same way (ids 169 to 172); the other hidden rows probably are
  too, but hidden rows cannot be read from a dev session (no PROD service key here, by design).
- ROOT CAUSE: the agent's research step is broken. `WebFetch` of Google search URLs returns an empty
  shell, Bing returns unrelated results, DOJ returns 401, AP and Reuters are blocked. With no research,
  the prompt's own rule flags every low-profile pardon. Log: `cse_01GRCJDar682Ji3PzVbyd7wc`.
- Likely fix: give the routine the real web search tool and repoint prompt Step 3 at it. $0. It is a
  PROD agent prompt change, so nothing was done at first. Josh then said yes: see Addendum A (ADO-588).
- No alert reached Josh because the needs-review Discord alert (ADO-577,
  `scripts/monitoring/alert-needs-review.js`) is still test-only.
- That September 16 run wrote content at 3:11 PM CT, before the classifier change at 4:04 PM CT, so it
  proves nothing about the content write under the new classifier.

## 5. SCOTUS, EO, Pardons under the September classifier: still unproven
No run with real work since September 16. Pardons September 19: 0 found, log writes passed, 0 denials.
SCOTUS and EO are weekdays only (next: Monday about 11:02 AM and 11:06 AM CT). Pardons runs daily at
3:01 PM CT.

## ADO
- ADO-586: New, Todo, Active, **Ready for Prod** (AC check in the card comment).
- ADO-587: **Todo** (Josh kept it). Next card. Plan check DONE: the repo is public, so Environments are free (Addendum C).
- ADO-588: **Active** (Bug, pardons web research). PR #149 open.
- ADO-583 / 584: Closed, untouched.

## Review and QA
- `npm run qa:smoke`: exit 0 on test, twice (after the schedule change, after ADO-586).
- Code review was done inline by the session. The two subagent review passes were NOT run (Josh's
  standing no-subagents rule; this session also had no agent tool). Josh's local Codex pass on #147 and
  #148 is the second review.
- The new test was not run on the deployment branch itself: a temporary worktree of main cannot borrow
  `node_modules` because main has a few packages committed under `node_modules/`. The new files and
  `scripts/lib/discord.js` are byte-identical between the deployment branch and test.
- Also committed: last session's leftover docs (`1bf5566`).

## Open items for Josh
1. Merge PR #147 (Codex clean). Re-run Codex on PR #148 (three P1s fixed) and PR #149, then merge.
2. Approve (or fix) the held pardons in admin, Pardons tab.
3. ADO-577 needs-review alert to main: Josh said yes, NEXT session with fresh context.
4. Say, in your own words, whether to change the Judge routine text from "private" to "public" repository (Addendum C).
5. Decide whether to re-enrich the blind-enriched pardons after PR #149 is live (Addendum A).
6. Still open from before: executor transactional merge+log function (no card); the #95384 comment.

## Next-session prompt
```
Read docs/handoffs/2026-09-20-ado-586-silence-alert-executor-times-pardon-hold.md first. No subagents. Do not create ADO cards or comments I did not ask for. Times in Central. (1) list_runs + get_run_log for the PROD Judge routine trig_01DDXZkpC9PkgTzU8wDdL9QM: confirm the 4:03 PM CT September 20 run (and any later ones) published with no permission_denied, used the corrected start-up message without complaint, and the executor merged or skipped cleanly. (2) Check the latest Pardons, SCOTUS and EO PROD runs; if one had real work, read its content PATCH for classifier denials. Report only. (3) If PR #148 is merged, find the next RSS Pipeline Health Check run on main, confirm two "[routine-silence] ... fresh" lines, and close ADO-586 after the AC check. (4) If PR #149 is merged, read the first PROD Pardons run that has real work: searches must return results and the content PATCH must pass the classifier; then resolve ADO-588 after the AC check. (5) Ship the ADO-577 needs-review Discord alert to main (Josh said yes). (6) Then ADO-587: the plan check is done (public repo, $0), start with the inventory of workflows that read a PROD secret.
```

---

## Addendum, same day (about 1:00 PM to 1:40 PM CT)

### A. Pardons agent web research fix - ADO-588 (Bug, Active), PR #149
Josh: "yes to fixing its broken web research, that's very important."
- Why pardons did not auto-publish: they do, when the agent is confident. `needs_review = true` forces
  `is_public = false`, and "research found nothing" is a flag trigger. Broken research flagged everything.
- Prompt v1.2 (test commit `f7b5474`): all 7 searches use `WebSearch`; `WebFetch` only reads a page a
  search returned; never fetch a search results page. New Step 3.0 health check: if search is broken the
  run writes nothing, logs `failed`, sends one push notification and stops.
- `WebSearch` added to `allowed_tools` on BOTH routines: TEST `trig_01XUeFUCbpi2sCyNLNST7K7F` and PROD
  `trig_018LUznaUWwijFhMZLp8kYE2` (full `session_request.config` resent; message unchanged).
- TEST proof: run `cse_0187wE5HyRcMG8xfHbtPNX8s` loaded `WebSearch` in the cloud sandbox and the health
  check returned real results. See the TEST RESULT line below for how the run ended.
- PR #149 to main: https://github.com/AJWolfe18/TTracker/pull/149. The prompt only takes effect on
  PROD after merge (prompts are read from main).
- Only the pardons prompt fetched search pages (7 places). EO, SCOTUS, Stories, Judge and fronts: 0.
- Open decision: re-enrich the pardons that were enriched blind (September 3 batch, id 173) from admin
  once v1.2 is live. Until then approving them publishes the thin write-ups.

### B. Codex findings on PR #148 (Josh pasted them) - fixed, test commit `f73a8cd`, cherry-picked to the PR
1. Monitor failures suppressed: the script now exits 1 when it cannot run at all; the step keeps
   `continue-on-error` and a follow-up step posts "Routine silence check could not run" to Discord when
   `steps.routine_silence.outcome == 'failure'`.
2. Missing credentials disabled monitoring silently: now exit 1, reported by that follow-up step.
3. `console.log` removed from the script (stdout writer); the test asserts it stays out.
PR #147: Codex found nothing.

### C. The repo is PUBLIC, not private
`gh api repos/AJWolfe18/TTracker --jq .visibility` = `public`. Consequences:
- ADO-587 costs $0 (Environments are free on public repos; a `test` environment already exists). Noted
  on the card. Actions minutes are free too.
- The Judge routine's `auto_mode_environment` says "the owner's own private repository". That text must
  be truthful. It is permission-type config, so Josh has to ask for the change in his own words.
  Accurate wording: "is the owner's own public repository; only the owner can push to it" (Josh is the
  only collaborator). Recorded in `docs/reference/cloud-classifier-playbook.md`.
- Workflow run logs and these handoff docs are publicly readable.

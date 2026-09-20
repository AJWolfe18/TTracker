# Handoff: ADO-583 Closed - PROD Judge unblocked by the routine's auto-mode fields (September 19-20, 2026)

All clock times are Central (CT). UTC = CT + 5 hours.

## Outcome in one line
The PROD Clustering Judge publishes again and its merges land on PROD. Two owner-set fields on the
routine cleared the classifier block; no prompt, repo or environment change. ADO-583 is Closed. The
GitHub Actions move from the previous handoff is not needed.

## What happened
1. Research first (Josh asked for every option). Read the Claude Code docs for auto mode, routines,
   cloud-session settings, permission modes, server-managed settings and GitHub Actions, the changelog,
   and claude-code issues #95200, #95384, #60004. Result: eight options, written down in
   `docs/features/clustering-judge/classifier-override-options.md`.
2. Correction to the "regression on September 15" theory: version 2.1.268 started NAMING the blocking
   rule in denial messages, so "zero labelled denials before September 15" is partly the labels being
   new. The September 16, 4:04 PM CT cutover with nothing changed on our side is still real.
3. Josh said "try 1 go". At 11:44 PM CT the PROD Judge routine (`trig_01DDXZkpC9PkgTzU8wDdL9QM`) got:
   - `auto_mode_environment`: `$defaults` + the repo is the owner's own private repository + Supabase
     project `osjbulmltfpcoldydexg` is the owner's own production database.
   - `auto_mode_allow`: `$defaults` + pushing one JSON verdict file on `judge-run/prod/<run_id>` is this
     routine's designed output; an owner-controlled workflow on main validates it and does the merges,
     capped at 10 and reversible.
   - Issue #95384 reports these fields silently not saving. They saved here because the update was sent
     in the `session_request` form (full `config` + `events`), not `job_config.ccr.session_context`.
4. Hand-fired run `cse_01DvQn375oXmTV51A8zoApAD` published
   `judge-run/prod/judge-2026-09-20T04-46-07.913Z` (commit `407d0a8`) at about 11:55 PM CT. 8 merge /
   17 keep / 5 uncertain.
5. The scheduled 12:03 AM CT run (`judge-2026-09-20T05-04-56.616Z`) also published on its own: a second
   pass for the lever, on a normal scheduled fire.
6. Josh dispatched the executor at 12:12 AM CT (run `35491068788`, success). First file: merged 8,
   deferred 0, failed 0, 30 rows logged, digest sent, branch deleted. Second file: 30 rows logged, 0
   merged, its 5 merge pairs came back `skipped: loser_already_merged` (overlap handled as designed).
   Merges: 15502 into 15499, 15553 into 15551, 15510 into 15512, 15511 into 15426, 15438 into 15359,
   15401 into 15353, 15391 into 15392, 15503 into 15521.
7. Josh's PROD query confirmed the rows: first run 17 keep + 8 merge (merged=true) + 5 uncertain = 30;
   second run 21 keep + 5 merge (merged=false) + 4 uncertain = 30.

## ADO
- ADO-583: **Closed**. AC 1 MET (30 rows for a hand-fired run), AC 2 MET (8 merged=true rows), AC 3 MET
  earlier. Evidence in the September 19 night comment.
- ADO-586 and ADO-587: still New, still Josh's call to keep or remove (created earlier without his ask).

## What this session's own classifier refused (do not retry these; hand Josh the line)
- A background wait loop and a Monitor poll on `git ls-remote` (`[Auto-Mode Bypass]`).
- `gh workflow run "Clustering Judge Executor" --ref main`, twice, the second time after Josh pasted the
  command (`[Auto-Mode Bypass]`). Josh ran it himself with a typed `!` prefix.
- `gh issue comment 95384 --repo anthropics/claude-code` after Josh said to add it
  (`[External System Writes]`).
- Note: a PASTED `! command` arrives as plain text and does not run. It has to be typed.

## Open items
- **Comment for claude-code issue #95384 is written but NOT posted.** Josh approved it; the session's
  classifier blocked the post, so Josh posts it himself. Full text in the appendix below. It tells the
  reporter the fields do save in the `session_request` form and that routines honor them.
- The fields are undocumented. If Judge denials return, go to option 2 in the options doc (committed
  publish script + one exact `permissions.allow` rule on main), then option 3 (GitHub Actions).
- Other PROD routines (Stories, SCOTUS, EO, Pardons) were left alone: no denials on them. SCOTUS, EO and
  Pardons still have not had a non-empty run under the September classifier; read the first one.
- Executor design debt (one transactional merge+log database function keyed (run_id, pair)): no card,
  Josh has not decided.
- The support note drafted in the earlier September 19 handoff was not sent. Lower value now that the
  Judge works; the #95384 comment covers the useful part.

## Files changed (docs only, no code)
- `docs/features/clustering-judge/classifier-override-options.md` (new)
- `docs/reference/cloud-agent-runbook.md` (new section 4)
- `docs/ARCHITECTURE.md` (Story merging row)
- this handoff

Code review and `qa:smoke` not run: no code, script, migration or workflow changed.

## Next-session prompt
```
Routine health check after the ADO-583 fix. Read docs/handoffs/2026-09-20-ado-583-closed-routine-auto-mode-fields.md first. No subagents. Do not create ADO cards or comments I did not ask for. Times in Central. (1) list_runs + get_run_log for the PROD Judge routine trig_01DDXZkpC9PkgTzU8wDdL9QM: confirm the last three scheduled runs published with permission_denials=0 and the executor merged or skipped cleanly. If any run was denied again, stop and give me one recommendation from docs/features/clustering-judge/classifier-override-options.md. (2) Check the latest SCOTUS, EO and Pardons PROD runs for classifier denials on their content PATCH; report only, change nothing. (3) Ask me what to do with ADO-586 and ADO-587.
```

## Appendix: approved comment for claude-code issue #95384 (not yet posted)

> A data point on the open question at the end of this report ("are `auto_mode_allow` / `auto_mode_environment` / `auto_mode_soft_deny` meant to be settable via the trigger create/update API? If so, what's the correct request shape?").
> 
> **They do save, and a routine run does honor them, when the update body uses the `session_request` form instead of `job_config.ccr.session_context`.** Pro/Max account, Anthropic-hosted environment, September 19-20, 2026.
> 
> What I saw:
> 
> - `GET /v1/code/triggers/{id}` returns the three fields as empty arrays under `session_request.config`, not under `job_config.ccr.session_context`.
> - `POST /v1/code/triggers/{id}` with a body shaped like the `session_request` object that GET returns (`environment_id`, the full `config` including `allowed_tools`, `cwd`, `model`, `sources`, plus `auto_mode_environment` and `auto_mode_allow`, and `events[].payload.message` with `role`) returned 200, and the values were still there on the next GET. I sent the whole `config`, not just the two new keys, because I did not want to find out whether a nested partial update drops siblings.
> - Values were prose arrays starting with `"$defaults"`, same as the documented `autoMode.environment` / `autoMode.allow` settings.
> 
> Effect on the classifier:
> 
> - Before: a scheduled routine whose last step is `git checkout -b <branch>` + commit + `git push` of one JSON file to its own private repo was denied at that step on every run since September 16 (`[Modify Shared Resources]`, and `[Auto-Mode Bypass]` on the run's own retry). Two hand-fired runs an hour earlier were both denied: `cse_01FbaqC76wHGnAHwUGNfDfS2`, `cse_01BbiRSN69aEiWjQTm5PneCC`.
> - After setting the two fields (an environment entry naming the repo and the database as the owner's own, and an allow entry describing that exact push as the routine's designed output), with no change to the prompt, the repo, or the environment: the next hand-fired run (`cse_01DvQn375oXmTV51A8zoApAD`) and the next scheduled run both pushed with no denial.
> 
> So for anyone landing here from a routine that auto mode blocks (related: #95200): this is an owner-side lever that works today. It is not in the routines docs, so I would not count on it staying put. It would help to have it documented, or a line in the docs saying it is unsupported.
> 
> I can't speak to the `set_permission_mode` hang in this report; my routines use only Bash/Read/Write/Edit with no connector tool calls and never hit it.

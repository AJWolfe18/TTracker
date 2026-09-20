# Cloud classifier playbook: when a routine gets denied

Written September 19-20, 2026 after ADO-583 (the PROD Clustering Judge). All clock times Central (CT).
Read this FIRST the next time any cloud routine is blocked by the auto-mode classifier. It holds what
we learned, every option we had, what worked, and what is a dead end. Status lives in ADO, not here.

## Triage in 5 minutes
1. `RemoteTrigger list_runs` on the routine, then `get_run_log` on the newest run. Look for
   `permission_denied Bash [classifier]: [<label>]`. The run still shows green: a green run list means
   nothing. The last `result:` line carries `permission_denials=N`.
2. Note the label and the exact command that was denied. Labels seen so far: `[Modify Shared
   Resources]`, `[Production Deploy]`, `[Auto-Mode Bypass]` (always a RETRY of something already denied
   in that run; find the first denial above it), `[External System Writes]`, `[Logging/Audit
   Tampering]`.
3. Ask: is the classifier's reading accurate? For the Judge it was (the push exists to cause PROD
   merges). Then the fix is the owner declaring the action approved, never disguising it.
4. Go down the option table below in order. Option 1 takes 15 minutes and needs Josh's own words.
5. Do not reword the routine prompt, rename branches, or retry inside the run. None of it can work
   (see Dead ends) and it burns a run each time.

## What a dev session cannot do for Josh (its own classifier refuses; do not retry or reshape)
Seen September 19-20, 2026, all after Josh had said go:
- Set permission-type config on a routine without Josh asking in his own words (a pasted plan is not
  his words).
- Sleep / poll wait loops on a routine it just changed, as background Bash or as a Monitor.
- `gh workflow run` of the PROD executor.
- `gh issue comment` on a public repo.
Hand Josh the exact line to type with a leading `!`. A PASTED `! command` arrives as plain text and
does not run; the `!` has to be typed.

## Routine exposure, as of September 20, 2026
| Routine (PROD) | Writes it makes | Under the September classifier |
|---|---|---|
| Clustering Judge `trig_01DDXZkpC9PkgTzU8wDdL9QM` | pushes one verdict branch | Denied September 16-19; passes since the `auto_mode_*` fields were set (hand-fired + scheduled run, both clean) |
| Stories `trig_0182WcUVyjF7Q5o2GWJMxbo1` | single-row PATCH to `stories`, log rows | Passing every 2 hours, 0 denials (last read: 10:26 PM CT September 19, 36 enriched) |
| Pardons `trig_018LUznaUWwijFhMZLp8kYE2` | log POST/PATCH, content PATCH | Log writes pass. Content PATCH UNPROVEN: queue empty on every run since September 16 |
| SCOTUS `trig_019eD3JTVeSajL4qTJJSC6tq` (weekdays) | log rows, content PATCH | Same: no denials, content PATCH UNPROVEN (empty queue) |
| EO `trig_01McAzRLMuu8cawTzbskQkmJ` (weekdays) | log rows, content PATCH | Same: no denials, content PATCH UNPROVEN (empty queue) |

Most likely next incident: the first non-empty SCOTUS / EO / Pardons run. Their content PATCH is the
same shape as Stories (single-row update), which passes, so the odds are good. If one is denied, use
option 1 on that routine with text describing that routine's own output.

## Worked example: the Judge (ADO-583)
The PROD Judge routine judges its pairs and writes a valid verdict file, then the cloud auto-mode
classifier denies Step 7 (`git checkout -b judge-run/prod/<run_id>` + commit + push) as
`[Modify Shared Resources]`, and any retry as `[Auto-Mode Bypass]`. Same step passes on TEST. Nothing
changed on our side; it started September 16, 2026 at 4:04 PM CT.

## Facts checked (docs read September 19, 2026)
- The routine object carries `auto_mode_allow`, `auto_mode_environment`, `auto_mode_soft_deny` under
  `session_request.config`. They are NOT in the routines docs. They mirror the documented `autoMode`
  settings (`code.claude.com/docs/en/auto-mode-config`).
- They ARE settable: an `update` sent in the `session_request` form (full `config` + `events`) saved and
  read back on September 19, 2026 at 11:44 PM CT. Issue #95384 reported a silent no-save, but that writer
  used `job_config.ccr.session_context`, a different spot.
- The fired routine prompt "is not live user input and can't act as approval or consent" (routines
  docs). No prompt wording clears a classifier block.
- `autoMode` is read only from `~/.claude/settings.json`, server-managed settings (Team/Enterprise
  only), or `--settings` / Agent SDK. Never from the repo's `.claude/settings.json`.
- A single-repo cloud session DOES read the repo's committed `.claude/settings.json`, including
  permission rules (`settings` docs, "Settings in cloud sessions"). Narrow `permissions.allow` rules are
  resolved BEFORE the classifier runs (`auto-mode-config`, "Route all shell commands through the
  classifier"). Broad rules that grant arbitrary code execution (`Bash(*)`, wildcarded interpreters)
  are suspended in auto mode.
- Main's `.claude/settings.json` already allows `git push *`, `git checkout *`, `git add *`,
  `git commit *`. Step 7 likely missed them: it is one multi-line block with variable assignments,
  a `$( [[ ... ]] )` substitution and `git -c user.name=... commit`, none of which match a prefix rule.
- Cloud sessions ignore `defaultMode: "bypassPermissions"` and `"dontAsk"`. They honor `"acceptEdits"`,
  but then any un-allowed command prompts with nobody to answer (the hang in issue #95384).
- Names carrying `prod` / `production` are sensitive targets by default. A push that causes a
  production change is judged as one.
- Changelog: version 2.1.268 started NAMING the blocking rule in denial messages. So "zero labelled
  denials before September 15" (issue #95200) is partly the labels being new. The September 16 cutover
  with no change on our side is still real evidence of a behaviour change.
- Open upstream issues, no Anthropic reply yet: #95200 (solo owner, 12x more denials since 2.1.270),
  #95384 (routines hang on a permission prompt; `auto_mode_*` would not save), #60004 (classifier
  ignores explicit authorization; agent cannot write the allow rule it is told to write).

## Options, in the order to try them

| # | Option | Cost | Effort | Certainty | Notes |
|---|--------|------|--------|-----------|-------|
| 1 | Routine `auto_mode_environment` + `auto_mode_allow` fields, truthful text, fire once | $0 | 15 min | **WORKED September 19, 2026** | Run `cse_01DvQn375oXmTV51A8zoApAD` (fired 11:44 PM CT) published `judge-run/prod/judge-2026-09-20T04-46-07.913Z` at about 11:55 PM CT (branch verified on GitHub, commit `407d0a8`): 8 merge / 17 keep / 5 uncertain. Same prompt, same Step 7, same environment as the two denied runs an hour earlier; the only change was these two fields. Undocumented, so it can stop working without notice: if denials return, go to option 2. Reversible: set both back to `[]`. |
| 2 | Committed publish script + one exact `permissions.allow` rule on main, by PR + Codex | $0 | ~1 hour | Likely | Owner declaring the push approved through the documented mechanism. Risk: auto mode may suspend a rule that launches `node`. TEST cannot prove it (TEST already passes); only a PROD run does. |
| 3 | Move the Judge into GitHub Actions (headless Claude Code, `claude setup-token` subscription token, permissions via `claude_args` / `settings`), executor in the same job | $0 cash; ~1,080 Actions minutes a month at 3 runs a day vs 2,000 free | 1 session | Certain | No cloud classifier involved. Deletes the `judge-run/**` branch polling. Check minutes used first: `gh auth refresh -h github.com -s user`. |
| 4 | Run the Judge locally as a Desktop scheduled task | $0 | ~1 hour | Certain | `~/.claude/settings.json` is a documented `autoMode` scope. PC must be on at 12:00 AM, 8:00 AM, 4:00 PM CT. |
| 5 | Approve each run by hand in claude.ai (type the exact push) | $0 | 3x a day forever | Shaky | #95200 reports direct orders still denied after earlier denials in the same session. Stopgap only. |
| 6 | Environment setup script writes `autoMode` into the sandbox's own `~/.claude/settings.json` | $0 | ~1 hour | Unknown (undocumented) | Hits every routine on the PROD environment and could clobber Anthropic's own hook file there. Do not start here. |
| 7 | Team plan server-managed settings | Over the $50/month cap | - | Certain | The only DOCUMENTED way to get `autoMode` into a cloud session. Ruled out on cost. |
| 8 | Report upstream: comment on #95200 and #95384, send the support note from the September 19 handoff | $0 | 20 min | No timeline | Do alongside whichever option ships. Include session IDs and the September 16, 4:04 PM CT cutover. |

## Dead ends (do not retry)
- Rewording the routine prompt, or renaming the branch to drop `prod`: evasion, and fragile.
- `autoMode` in the repo's `.claude/settings.json`: explicitly not read.
- `bypassPermissions` / `dontAsk` as `defaultMode`: ignored in cloud sessions.
- `acceptEdits` as `defaultMode`: honored, but the routine then hangs on the first un-allowed command.
- Retrying inside a run after a denial: the retry is labelled `[Auto-Mode Bypass]`.

## Option 1, exact text used (September 19, 2026, 11:44 PM CT)
`auto_mode_environment`:
1. `$defaults`
2. `Source control: github.com/AJWolfe18/TTracker is the owner's own private repository.`
3. `Key internal services: Supabase project osjbulmltfpcoldydexg is the owner's own production database for this repository.`

`auto_mode_allow`:
1. `$defaults`
2. `Pushing a new branch named judge-run/prod/<run_id> that contains one JSON verdict file to AJWolfe18/TTracker is allowed: it is this routine's designed output. A separate owner-controlled GitHub Actions workflow on main validates the file and performs the merges, capped at 10 per run and reversible.`

Update shape that saved: `RemoteTrigger update` with a body in the `session_request` form
(`environment_id`, full `config`, `events[].payload.message` with `role`). Undo: same call with both
arrays set to `[]`.

## Sources
- https://github.com/anthropics/claude-code/issues/95200
- https://github.com/anthropics/claude-code/issues/95384
- https://github.com/anthropics/claude-code/issues/60004
- https://code.claude.com/docs/en/auto-mode-config
- https://code.claude.com/docs/en/routines
- https://code.claude.com/docs/en/settings#settings-in-cloud-sessions
- https://code.claude.com/docs/en/permission-modes
- https://code.claude.com/docs/en/server-managed-settings
- https://code.claude.com/docs/en/github-actions
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

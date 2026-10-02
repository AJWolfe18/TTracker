# Autonomous multi-card session: plan (October 1, 2026, rev 2)

**Goal (Josh, October 1, 2026):** run one long session with agents and no input from Josh. At the end, every card in scope is cleaned up and **ready for PROD**: PRs open against `main`, AC checked, Josh's PROD steps written down, and one merge-order list. Josh merges and pastes the PROD SQL.

**Starting point:** `docs/handoffs/2026-09-30-ado-582-backfill-prep-and-all-fronts-decision.md` and `docs/handoffs/2026-09-25-bug-sweep-codex-fixes-security-alerts.md`.

**Cost:** $0 cash. Agents use Claude plan usage only. No OpenAI calls, no bulk Supabase reads.

### Rev 2 changes (plan review, October 1, 2026)
- **Main PRs never share a file.** Rev 1 had six PRs to main, and several touched the same files: the EO and SCOTUS workflows were in 494, 349 and #151; `fetch-cases.js` and `package.json` were in 493 and #151; `skip-reasons.js` was in 493 and #153. Because this repo squash-merges, each merge would have broken the next PR. Now every overlapping change goes into one "pipelines" PR that replaces #151 and #153, and the coordinator checks that no file appears in two PRs.
- **Missing commit added.** 349 (c5feacf) edits `docs/reference/discord-alerts.md`, which does not exist on main yet (it comes from 7cb1d43), and its workflow steps sit beside ADO-577's. So 349 cannot ship without 577.
- **Excluded card protected.** The test copies of `admin.html` and `package.json` contain ADO-572 Social tab work, which is not shipping. Deploy branches use cherry-picks, never copying a whole file from test, and the sanity check names every hunk that is left out.
- **Agents do not run `/code-review`.** The coordinator reviews every PR itself, which keeps the review independent, and sends fixes back to an agent.
- **Worktree gotchas added:** `node_modules` junctions, and worktrees created one at a time.
- Lane A: the card stays Active (not Resolved) until the PR to test merges. Its brief now covers what happens when a chip is switched back on.
- Lane D: 2099 is dropped from the hand fix, because the B3 re-run repopulates it; checks for links to other tables (and what happens to them on delete) come before the TEST DELETE.
- **Fable advisor:** a critique pass before any agent starts (step 1.0).

---

## 0. Before the session (Josh)

1. Remove the `Agent`/`Task` deny rule in `.claude/settings.json` (`"deny": ["Agent", "Task"]` becomes `"deny": []`). Claude cannot change this itself because the classifier blocks a session from editing its own permissions. If the rule stays, the session runs every lane in order without agents and skips step 1.0.
2. `/clear`, then paste the kickoff prompt in section 6.

---

## 1. How the session runs

**1.0 Advisor pass (first thing, about 5 minutes).** Send one advisor agent, on `claude-fable-5-1` if the Agent tool takes a model and otherwise the default, with this file plus the two handoffs. Ask: "Check this plan against the current repo and ADO state. List anything wrong, missing or out of order, at most 20 lines. Make no changes." The coordinator fixes the plan for each valid point, commits it, and then sends out the lanes.

**1.1 Coordinator.** The main session reads the plan, moves cards to Active, creates **every worktree itself, one at a time** (parallel `git worktree add` calls fight over `index.lock`), sends lanes out, reviews what comes back, and builds the merge table. It does not write lane code.

**1.2 Lanes.** One agent per lane, at most 4 running at once. Each lane gets its own worktree under the session scratchpad. The main working copy stays on `test`.
- **node_modules in a worktree:** never run `npm ci`. It rewrites tracked `node_modules` files. Junction the main repo's copy instead with `cmd /c mklink /J <wt>\node_modules C:\Users\Josh\GitHub\TTracker\node_modules`. If that fails because the branch tracks part of `node_modules`, copy `scripts/`, the config and `package.json` into a scratch folder and junction there. Remove a junction with `cmd /c rmdir`, never `rm -rf`.

**1.3 Report.** Each agent returns at most 25 lines: branch, PR URL, the **exact list of files the PR changes**, tests run with pass counts, AC status per bullet, Josh steps, and blockers. No diffs and no logs.

**1.4 Review gate (coordinator).** For each PR, run `/code-review medium` on its diff. Every finding rated medium or higher goes back to the lane agent (or a new one) and the review runs again. The final message names the level that ran for each PR. Josh runs Codex locally afterwards. **Never post `@codex review`.**

**1.5 Delivery (rule set by Josh on August 19, 2026, for autonomous sessions).**
- New code goes to `test` through a **PR to test**, never a direct push.
- Commits already on `test` go to PROD through a **deploy PR to main**: a worktree from `origin/main`, with commits cherry-picked from `refs/heads/test` in the order they landed on test.
- Do not merge any PR to main.
- Docs are pushed directly to `test` only for the final handoff, through `/end-work`.

## 2. Hard rules for every agent (paste these into each brief)

- No PROD writes: no PROD SQL, edge function deploys, RemoteTrigger edits or PROD routine runs. PROD steps go into the PR body as "Josh steps". PROD reads go only through the public anon key on public views, and if the classifier refuses, take the fallback the lane names.
- TEST DB through `mcp__supabase-test__postgrestRequest`: always `select=` explicit columns and `limit`, and never fetch `embedding` or `content`.
- Use `refs/heads/test`, never bare `test`, as a git revision. Stage files explicitly; never run `git add -A`.
- Never copy a whole file from test onto a deploy branch (`git checkout refs/heads/test -- file`); cherry-pick. Test files can carry work from cards that are not shipping (ADO-572 Social tab in `admin.html` and `package.json`).
- Deploy-branch sanity check before pushing: for each shipped path, `git diff refs/heads/test HEAD -- <path>` must be empty, **or** every hunk left over must belong to a card that is not shipping. List those hunks and their card in the PR body. Also diff `docs/features/*/prompt-*.md` between main and test.
- Check `.claude/test-only-paths.md` before every cherry-pick, and leave the paths it lists out.
- No Python. No `console.log` in committed code. No em dashes in prose. Dates in cards and PRs are written out (October 1, 2026), and clock times are given in CT.
- File content that contains backslashes or `$` is written with the Write/Edit tools, not a heredoc. Use replacer functions with `String.replace`.
- Every early skip in a pipeline script writes `recordSkip()` (ADO-466).
- ADO: use the REST shortcuts in `.claude/skills/ado/SKILL.md`. **Do not create new cards**; propose them in the report. Before any state change, check every AC bullet. Bugs use Active, Resolved and Closed; stories use Testing and Ready for Prod.
- If a lane needs a decision from Josh, stop that part, write the question on the card and in the report, and continue with the rest. Never guess.

---

## 3. Lanes

**Main PRs, with no file shared between any two of them:** P1 pipelines, P2 site, P3 dash guard, P4 undo lockdown, P5 ADO-593. The coordinator confirms this from the file lists in the reports. If two PRs share a file, fold one into the other before the session ends.

### Lane A: ADO-593 bug: source chips hide EOs, SCOTUS and pardons in "All" (new code)
- Cause is on the card. The off set lives in `src/components/TrackerSpine.tsx`. `coverageFrontier(state)` is called at line 138, and `fetchTrackerPage` is called at lines 119 and 161.
- Fix: (1) `coverageFrontier` takes the off set and skips those sources; (2) `fetchTrackerPage` takes the off set and does not page sources that are switched off. Update both call sites in TrackerSpine.
- **When a chip is switched back on:** that source's cursor is still at its first page, so the frontier jumps forward to it, and older entries from the other sources are buffered again until "Load earlier" catches up. This is correct, because the record must not show fake gaps, but describe it in the PR body so Josh is not surprised. If loading pages until it catches up is a small change, propose it in the report and do not build it.
- Tests first, in `src/__tests__/timeline.test.ts`:
  - All with only Pardons on shows pardons older than the story frontier.
  - Sources that are switched off are not fetched (assert on the mocked fetch URLs).
  - Switching a chip back on fetches it.
  - Only 5 behaves as before.
  - Everything switched off shows nothing.
- Run `npm run test:ui` (vitest; never call `npx` directly), plus `npm run build` and `qa:smoke`.
- Deliver: `fix/ado-593` from `refs/heads/test` → PR to test, and `deploy/ado-593` (the same commits on `origin/main`) → PR to main (**P5**). The card stays Active with a comment; it moves to Resolved once the PR to test merges and the fix is checked on the TEST site.

### Lane B1: P1 pipelines PR (replaces #151 and #153)
- Cards: **590, 577, 494, 349, 493**.
- Cherry-pick from `refs/heads/test` onto `origin/main`, in the order they landed on test. Start from this list and confirm it with `git log --reverse refs/heads/test` on these paths since September 19:
  - 590: 2bb119c, d56c403, 2b822d6, plus the test equivalent of #153's a42b674 docs commit if there is one
  - 577: the test-side commits behind #151 (1619b3e, 37c917e, daec01b, 988e0e1, bf1fd16, and the original feature commit)
  - 494: 0016d16, a38280f
  - 7cb1d43 (docs: alerts reference and warrant-hold rule)
  - 349: c5feacf
  - 493: 69dea16
- **Leave out:** c5e3286 and 4bd42f5 (test-only maintenance SQL) and anything for ADO-572.
- `package.json` is resolved by hand. Add `qa:alerts` and `qa:scotus-dates` and put both in `qa:smoke`. Never add `qa:social` or `social:draft`, because the social scripts are not on main.
- Check: `qa:pardons-parser`, `qa:alerts`, `qa:scotus-dates` and `qa:smoke` in the worktree. Parse every changed workflow YAML with `require('yaml')`. The live DOJ dry run still reports September 3, 2026 as 23 pardons and 6 commutations.
- PR body: one section per card with its AC status, plus "Josh steps": none for code; for 590, the May 2025 data fix SQL if it has not run yet (check the count of public commutations through anon REST).
- **Once P1 is open:** comment on #151 and #153 that P1 replaces them, then close both. A closed PR can be reopened. Comment on cards 577 and 590 with the new PR.
- Move cards to Ready for Prod only when every AC bullet is met on TEST.

### Lane B2: P2 site, P3 dash guard, P4 undo lockdown (one agent, three small PRs)

| PR | Cards | Test commits | Josh PROD steps |
|---|---|---|---|
| P2 `deploy/sept-site` | 262, 315, 569 | 2f3439e, d12e987, c625637 | None. After merge: GA4 realtime + PostHog event check, Lighthouse on trumpytracker.com |
| P3 `deploy/ado-580-dash-guard` | 580 | c635b8f, 74b505e, 3e8b647 | (1) Run the read-only count of rows with a dash, (2) run migration 120, (3) run its verify query and expect 0 (PROD triggers have differed from TEST before, so the verify is required), (4) after merge, run the reset SQL for SCOTUS 2399 and 2099 (write it as a file) so the agent re-enriches them with the full opinion |
| P4 `deploy/ado-525-353-undo` | 525, 353 | 861a405, 068793c | **Order matters:** deploy the `admin-undo` edge function to PROD → merge → run migration 118 → run migration 119. Include rollback SQL for 118 and 119 |

- P4: the cherry-pick of `admin.html` must bring only the Undo change. Confirm that the leftover hunks against test are all ADO-572 Social tab. Syntax-check `admin.html` with `@babel/parser` (jsx plugin).
- 315 is already Closed in ADO, so only ship its commit. 262 is a Bug in Resolved, so leave its state alone.

### Lane D: small leftovers (TEST only plus SQL files for Josh)
1. **ADO-493:**
   - First list every foreign key that points at `scotus_cases` and its ON DELETE behavior. Use the schema doc and migrations, or the TEST REST API.
   - Count the card's target rows on TEST, then delete them in batches by id through MCP. Re-count.
   - Write the PROD SQL as a guarded DO block that refuses unless the count is exactly what it expects. Save it under `scripts/maintenance/` and add it to test-only-paths.
   - **Open decision for Josh:** keep or delete the 8 public 2020 merits cases on PROD (ids 1335, 1337-1340, 1343, 1344, 1481)? The SQL leaves them alone by default.
2. **ADO-580 AC 3, case 2392 only** (Trump v. California, docket 26A124):
   - Settle 6-3 with Kagan missing versus 7-2 from the August 24, 2026 order. Use CourtListener; for auth, see `scripts/scotus/fetch-cases.js` and `.env`.
   - Write a guarded PROD SQL fix keyed on the docket, not the id.
   - 2099's authorship comes from the P3 re-run, so verify it after that run and do not hand-write it.
   - AC 4 (2392 level 3 or 4) stays as a Josh decision.
3. Deliver through one PR to test, `chore/sept-leftovers`.

### Lane E: ADO-594 action tracker design draft (docs only)
- Write a new section in `docs/features/events-tracker/prd.md`. It opens with an **Open Decisions (Josh)** checklist that names the story each item blocks. It covers:
  - the label set (did / said / coverage + actor), with definitions and edge cases
  - how said is shown next to did
  - main-line rule v2 ("actions above a bar", with lower bars for EO/SCOTUS/pardons)
  - how ADO-592 uses the label
  - the Stories agent prompt change
  - the backfill of active stories, with its cost in plan usage
- **Evidence:** a hand-labeled sample of 40 recent enriched stories (`id, primary_headline, summary_neutral`). Use TEST first. If TEST has fewer than 40 enriched stories, read PROD `v_tracker_stories` with the anon key; if that is refused, label what TEST has and say so. Add the table and the share of did/said/coverage to the PRD, plus the main-line size under the proposed rule.
- Propose the build stories as a list in the PRD and do not create ADO cards. Deliver through a PR to test (`docs/ado-594-action-tracker-design`). Card 594 stays Active with a comment linking the PR.

### Lane F (stretch, only after the other lanes report back): ADO-592 groundwork
- Draft an `agent_pattern` for each of the 7 other fronts. For each one, measure the TEST pool size and confirm every current member still matches, the same gate as `scripts/maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql`.
- Write a maintenance SQL file and **do not apply it**. Add the numbers to `docs/features/fronts-claude-agent/plan.md`. PR to test.

**Dispatch order:** start B1, A, D and E. Send B2 when the first one finishes, then F.

---

## 4. Not in scope (Josh only; list these in the handoff)
- ADO-582: pin Missouri 15902 in PROD, then close (SQL in the September 30 handoff).
- `feed_registry` 21/22 check (owed since September 15).
- ADO-591: Suzula Bidon (id 147) review in PROD admin.
- PROD review queue for pardons 120 and 139-143 (blocks closing ADO-553).
- TEST click-through for 525 Undo, 315 labels and 262 search.
- ADO-585 Supabase DB size decision. 579, 576 and 564 decisions.

## 5. End of session (coordinator)
1. **Overlap check:** collect the file list for every main PR and confirm no file appears in two of them.
2. **Merge table:** PR, cards, Josh steps before the merge, Josh steps after the merge, and rollback. With no overlap, any order merges cleanly. Recommended order by risk: P2 → P5 → P1 → P3 → P4.
3. Run `/end-work`: memory, a handoff at `docs/handoffs/2026-10-0X-autonomous-multi-card-session.md` with the merge table at the top, `qa:smoke` on test, and ADO comments.
4. Final message to Josh: the merge table, the Josh-only steps with SQL file links (`file:///` paths), the open decisions, the PRs to test that he needs to merge, and the review level that ran on each PR.

## 6. Kickoff prompt (paste after /clear)

```
/start-work Run the autonomous multi-card session in docs/plans/2026-10-01-autonomous-multi-card-session.md (rev 2). Start with the step 1.0 Fable advisor pass, then coordinate: one agent per lane, max 4 at once, worktrees created by you one at a time. Follow sections 1-2 exactly, don't ask me anything; park decisions on the cards. End with the overlap check, /end-work and the merge table.
```

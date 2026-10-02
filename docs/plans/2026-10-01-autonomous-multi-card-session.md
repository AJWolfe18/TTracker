# Autonomous multi-card session: plan (October 1, 2026)

**Goal (Josh, October 1, 2026):** run one long session with agents and no input from Josh. At the end, every card in scope is cleaned up and **ready for PROD**: PRs open against `main`, AC checked, Josh's PROD steps written down, and one merge-order list. Josh merges and pastes the PROD SQL.

**Starting point:** `docs/handoffs/2026-09-30-ado-582-backfill-prep-and-all-fronts-decision.md` and `docs/handoffs/2026-09-25-bug-sweep-codex-fixes-security-alerts.md`.

**Cost:** $0 cash. Agents use Claude plan usage only. No OpenAI calls, no bulk Supabase reads (see the egress rules below).

---

## 0. Before the session (Josh)

1. Remove the `Agent`/`Task` deny rule in `.claude/settings.json` (`"deny": ["Agent", "Task"]` becomes `"deny": []`). Claude cannot change this itself because the classifier blocks a session from editing its own permissions. If the rule stays, the session runs every lane in order without agents. That is slower but works the same way.
2. `/clear`, then paste the kickoff prompt in section 6.

---

## 1. How the session runs

- **The main session coordinates.** It reads this plan, moves cards to Active, sends each lane to an agent with a short brief, reviews what comes back, and builds the final merge list. It does not write lane code itself.
- **One agent per lane, with at most 4 running at once.** Every lane works in its **own git worktree** under the session scratchpad (`git worktree add <scratch>/<lane> -b <branch> <base>`). The main working copy stays on `test`. Windows cannot switch branches in the main copy (locked dirs).
- **Each agent returns a short report (≤ 25 lines):** branch, PR URL, tests run with pass counts, AC status per bullet, Josh steps, and blockers. No diffs and no logs.
- **Review gate per PR:** run `/code-review medium` on the PR diff and fix every finding rated medium or higher. The report must name the review level that ran. Josh runs Codex locally afterwards. **Never post `@codex review`.**
- **Delivery (rule set by Josh on August 19, 2026, for autonomous sessions):** new code goes to `test` through a **PR to test**, never a direct push. Commits already on `test` go to PROD through a **deploy PR to main** that is cherry-picked from `test` and built in a worktree from `origin/main`. Do not merge any PR to main.
- **Docs pushed directly to `test`:** only the final handoff, through `/end-work`.

## 2. Hard rules for every agent (paste these into each brief)

- No PROD writes: no PROD SQL, edge function deploys, RemoteTrigger edits or PROD routine runs. PROD steps go into the PR body as "Josh steps".
- TEST DB through `mcp__supabase-test__postgrestRequest`: always `select=` explicit columns and `limit`, and never fetch `embedding` or `content`.
- Use `refs/heads/test`, never bare `test`, as a git revision. Stage files explicitly; never run `git add -A`, because part of `node_modules` is tracked.
- No Python. No `console.log` in committed code (use a stdout helper). No em dashes in prose or editorial text. Dates in cards and PR text are written out (October 1, 2026), and clock times are given in CT.
- File content that contains backslashes or `$` is written with the Write/Edit tools, not a heredoc. Use replacer functions with `String.replace`.
- Every early skip in a pipeline script writes `recordSkip()` (ADO-466).
- Check `.claude/test-only-paths.md` before every cherry-pick, and leave the paths it lists out of deploy PRs.
- Deploy-branch sanity check before pushing: `git diff refs/heads/test HEAD -- <shipped paths>` must be empty, except for exclusions you meant to make. Also diff `docs/features/*/prompt-*.md` between main and test, because agent prompts are deployed code.
- ADO: use the REST shortcuts in `.claude/skills/ado/SKILL.md`. **Do not create new cards**; propose them in the handoff. Before any state change, verify the card's AC bullet by bullet. Bugs use Active, Resolved and Closed; stories use Testing and Ready for Prod.
- If a lane needs a decision from Josh, stop that part, write the question on the card and in the report, and continue with the rest. Never guess.

---

## 3. Lanes

### Lane A: ADO-593 bug: Tracker source filters hide EOs, SCOTUS and pardons (new code)
- Repro and cause are on the card. Fix in `src/lib/timeline.ts`: (1) `coverageFrontier()` (around line 429) ignores sources in the off set; (2) `fetchTrackerPage()` (around line 332) does not fetch switched-off sources, and switching a chip back on fetches it. Check where the off set is held (the component that calls `visibleEntries`) so both functions read the same state.
- Write the failing test first in the vitest timeline suite. Cover: in All with only Pardons on, pardons older than the story frontier show up; re-enabling Stories fetches stories again; Only 5 behavior does not change. Gotcha: vitest runs in a node env, so import `./supabase` lazily (see `src/lib/timeline.ts` pattern).
- Run vitest, `npm run build`, and `qa:smoke`.
- Deliver: `fix/ado-593` from `refs/heads/test` → PR to test; `deploy/ado-593` from `origin/main` with the same commits → PR to main. Card → Resolved once the PR to test is open and AC are verified (the card has no AC field, so use the three fix points in the repro as AC).

### Lane B: September 25 sweep to PROD (commits already on test; deploy PRs only)
These sit on `test` and have never reached main. Confirm each one first with a path diff against `origin/main`. Build **four** deploy PRs, split by risk:

| PR | Cards | Test commits | Josh PROD steps |
|---|---|---|---|
| B1 `deploy/sept-ci-analytics` | 494, 262, 315, 569 | 0016d16, a38280f, 2f3439e, d12e987, c625637 | None. After merge: GA4 realtime + PostHog event check, Lighthouse on trumpytracker.com |
| B2 `deploy/ado-349-493` | 349, 493 | c5feacf, 69dea16 | None for code. 493's cleanup DELETE is Lane D |
| B3 `deploy/ado-580-dash-guard` | 580 | c635b8f, 74b505e, 3e8b647 | Run migration 120 in the PROD SQL editor (it rewrites about 177 SCOTUS, 266 EO, 10 pardons and 6,132 story rows). After merge, reset SCOTUS 2399 and 2099 for re-enrichment (write the reset SQL file) |
| B4 `deploy/ado-525-353-undo` | 525, 353 | 861a405, 068793c | **Order matters:** deploy the `admin-undo` edge function to PROD → merge → run migration 118 → run migration 119. If migration 118 runs first, Undo breaks. Include rollback SQL |

- In each worktree, run the QA suites that cover the files shipped (`qa:smoke` at least). For workflow YAML, parse it with `require('yaml')`. For `admin.html`, syntax-check with `@babel/parser` (jsx).
- Run `/code-review medium` on each deploy diff.
- Move cards to **Ready for Prod** only when every AC bullet is met on TEST. Otherwise leave the state as it is and comment on what is missing. 262 is a Bug (it stays Resolved).
- Files overlap with Lane C (#151 also touches workflows; B1 changes action majors in every workflow). Record each PR's file list in the report so the coordinator can order the merges.

### Lane C: open PRs #151 (ADO-577) and #153 (ADO-590) made merge-ready
- Merge `origin/main` into each branch (do not rebase or force-push; the classifier blocks force-push anyway). Resolve conflicts. Both touch the pardons scraper, so check that #151 still applies after #153.
- Run `qa:pardons-parser`, `qa:alerts` and `qa:smoke` on each branch. Run `/code-review medium` on each full PR diff.
- Comment on cards 577 and 590 with the date, the state of each PR, and the order: **merge #153 first**. Do not merge either PR; Josh's Codex re-run is still owed.
- 590 also needs Josh to run the May 2025 data fix SQL (`scripts/maintenance/2026-09-23-ado-590-2025-mixed-section-types.sql`). Check through the anon REST API whether it has run yet (count public commutations). Read-only.

### Lane D: small leftovers (TEST only plus SQL files for Josh)
1. **ADO-493:** run the cleanup DELETE from the card on **TEST** through MCP (count first, then delete in batches by id). Write the PROD SQL as a guarded DO block (exact expected count or nothing changes), saved under `scripts/maintenance/` and listed in test-only-paths. **Open decision for Josh:** keep or delete the 8 public 2020 merits cases on PROD (ids 1335, 1337-1340, 1343, 1344, 1481)? The SQL leaves them alone by default.
2. **ADO-580 AC 3:** use the August 24, 2026 order text to settle 2392 Trump v. California (6-3 with Kagan missing, or 7-2) and fill 2099's dissent_authors. Try CourtListener first (token in `.env`; check `scripts/scotus/fetch-cases.js` for how it authenticates). Write a guarded PROD SQL fix file. AC 4 (2392 level 3 or 4) stays as a Josh decision.
3. Deliver through one PR to test, `chore/sept-leftovers`, with the SQL files and any test-only-paths entries.

### Lane E: ADO-594 action tracker design draft (docs only)
- Write a new section in `docs/features/events-tracker/prd.md` that opens with an **Open Decisions (Josh)** checklist naming the story each item blocks. Cover: the label set (did / said / coverage + actor) with definitions and edge cases, how said is shown next to did, main-line rule v2 ("actions above a bar", with lower bars for EO/SCOTUS/pardons), how ADO-592 uses the label (only did/said stories are front candidates?), the Stories agent prompt change, and the backfill of active stories with its cost in plan usage.
- **Evidence:** label a sample of 40 recent TEST stories by hand (select `id,primary_headline,summary_neutral`, limit 40) and add the table to the PRD. Show how many are did/said/coverage and how big the main line would be under the proposed rule. Read-only.
- Propose the build stories as a list in the PRD and do not create ADO cards. Deliver through a PR to test (`docs/ado-594-action-tracker-design`). Card 594 stays Active with a comment linking the PR and the open decisions.

### Lane F (stretch, only after A-E report back): ADO-592 groundwork
- Draft an `agent_pattern` for each of the 7 other fronts (iran, epstein-files, selling-the-white-house, trump-crypto, kushners-deals, the-courts, qatar-jet). For each, measure the TEST pool size and confirm that every current member still matches, the same gate as ADO-582 (`scripts/maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql`). Write a maintenance SQL file and **do not apply it**. Add the numbers to `docs/features/fronts-claude-agent/plan.md`. Deliver through a PR to test.

---

## 4. Not in scope (Josh only; list these in the handoff)
- ADO-582: pin Missouri 15902 in PROD, then close (SQL in the September 30 handoff).
- `feed_registry` 21/22 check (owed since September 15).
- ADO-591: Suzula Bidon (id 147) review in PROD admin.
- PROD review queue for pardons 120 and 139-143 (blocks closing ADO-553).
- TEST click-through for 525 Undo, 315 labels and 262 search.
- ADO-585 Supabase DB size decision. 579, 576 and 564 decisions.

## 5. End of session (coordinator)
1. Build the **merge-order table** from the lane reports: PR, card, files that overlap, Josh steps before and after the merge, and rollback. Order: #153 → #151 → B1 → B2 → B3 → B4 → deploy/ado-593. Adjust if file overlaps say otherwise. Pull Lane C's main merges forward or re-merge as needed.
2. Run `/end-work`: memory, a handoff at `docs/handoffs/2026-10-0X-autonomous-multi-card-session.md` with the merge table at the top, a re-run of `qa:smoke` on test, and ADO comments.
3. Final message to Josh: the merge table, the Josh-only steps with SQL file links (`file:///` paths), the open decisions, and the review level that ran on each PR.

## 6. Kickoff prompt (paste after /clear)

```
/start-work Run the autonomous multi-card session in docs/plans/2026-10-01-autonomous-multi-card-session.md. You coordinate: one agent per lane (A-E, max 4 at once, each in its own worktree), F only if time remains. Follow sections 1-2 exactly, don't ask me anything; park decisions on the cards. End with /end-work and the merge-order table.
```

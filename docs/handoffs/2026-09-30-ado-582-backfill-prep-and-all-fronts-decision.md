# Handoff: ADO-582 backfill prep shipped; every front gets the agent (ADO-592, 593, 594)

September 30, 2026 (late evening CT). Started from the "Backfill plan" in `2026-09-30-ado-582-fronts-prod-and-routine-models.md`. Steps 1 and 2 shipped to PROD. Step 3 (the election-only backfill) was skipped on purpose after Josh decided every front gets the agent.

## Outcome in one line
The election agent now has a tight candidate pattern (PROD backlog down from 2,666 to 1,095) and records one page of decisions per call (PR #156, merged). The big backfill waits for one agent that covers all fronts (ADO-592), which waits for the action-tracker design (ADO-594).

## 1. Tighter `events.agent_pattern` (done, TEST + PROD)
- New value (recorded in `scripts/maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql` and `docs/features/fronts-claude-agent/plan.md`). Dropped: elections, electoral, votes, midterms, polls, pollsters, plain "polling", and "voting rights" (redundant). Kept: voters, voting, ballots, precincts, polling place/hours/sites, certify, redistricting, gerrymanders, congressional/district maps.
- Gate: every story the agent ever assigned must still match. TEST: all 9 match (the handoff listed 4 from September 30; 17245 and 17056 were also assigned). Unassigned TEST matches went from 111 to 38; the stories it drops are horse race, polls and House floor votes.
- PROD: Josh pasted the self-checking DO block (it refuses if an agent-assigned story would drop out). Result: pool_before 2666, pool_after 1095, agent_assigned 7 / matching 7, named_found 7, members_outside_pattern 41 (sweep/hand members the regex would not find; informational).
- Never re-run migration 116 PART D (it resets the broad seed). `front-agent-prompt.test.mjs` reads the pattern from the maintenance file.
- Considered and not added: "election officials/workers/boards", "poll books", "mail-in". They matched nothing extra on TEST. If the agent later misses mechanism-3 stories (officials fired, certification fights), add those phrases.

## 2. Batch `record <file>` verb (done, PR #156 = db82607 on main, 67b032d on test)
- `scripts/fronts/front-agent-db.js record tmp/fronts-page-<n>.json`: the agent writes a page with the Write tool and records it in one call. Every entry is checked first (one bad entry = exit 2, nothing written). Then each decision is written exactly as `assign`/`decline` write it, and the output gives a status per story. `assign`/`decline` stay for single-story retries. Same allow rule. `tmp/` is gitignored.
- The prompt's Step 4 was rewritten; the dry-run page limit is fixed to min(25, MAX_PER_RUN).
- TEST proof: 38 stories requeued by deleting their TEST decline rows. Run `cse_017VbeTJduuBks2hHrLex5j7`: 2 pages, 2 `record` calls, 0 errors, 0 permission denials, about 14 tool calls in total (the first PROD run used about 90 for 80 stories). All 38 were declined again, consistent with their earlier declines.
- Review: `/code-review medium` found one high issue. A scripted JS `String.replace` with `` $` `` in the replacement had pasted the prompt's first 52 lines into Section 2. Fixed, and a new test asserts every prompt heading appears exactly once. `qa:smoke` green.

## 3. Decisions (Josh, September 30, 2026)
- **Every front gets the agent.** Recommended and accepted: ONE agent that picks the best front or none (`story_event.story_id` is the PK, so one front per story), not 8 agents. Card: **ADO-592** (Todo).
- **Election-only backfill skipped.** A multi-front agent would re-read those stories. The daily 80-story election run keeps going until 592 replaces it.
- **The Tracker should be an action tracker** (everything he did or said, not only the big sagas). Recommended: the Stories agent labels every story **did / said / coverage**, the main line becomes "actions above a bar", and EO/SCOTUS/pardons (actions by definition) likely get a lower main-line bar. Design FIRST, because it changes what 592 judges. Card: **ADO-594** (Todo).
- **Bug ADO-593** (New): the Tracker source chips only filter client-side, and `coverageFrontier()` counts sources that are switched off. So in "All", pardons/EOs/SCOTUS on their own show nothing. Fix: the frontier ignores off sources, and switched-off sources are not fetched. Josh: "card it and we pick it up soon".

## Open / next (in order)
1. **Josh, PROD SQL editor: pin Missouri onto the main line, then close ADO-582 (AC 4).** Story 15902 is on the election front but the Stories agent rated it alarm 0 ("a win for voters"), below the front's floor of 3:
   ```sql
   INSERT INTO public.tracker_pin (source, entity_id, pin, note)
   VALUES ('stories', '15902', 'force_show', 'ADO-582: Missouri gerrymander ruling - Josh wants it on the main line despite alarm 0')
   ON CONFLICT (source, entity_id) DO UPDATE SET pin = 'force_show', note = EXCLUDED.note, updated_at = now();
   SELECT * FROM public.refresh_tracker_derived();
   ```
   ADO-582 is in Testing with AC 1/2/3/5 met.
2. **Josh, still owed since September 15:** `SELECT id, source_name, is_active, failure_count, last_fetched_at FROM feed_registry WHERE id IN (21, 22);` (if failure_count is NULL: `UPDATE feed_registry SET failure_count = 0 WHERE id IN (21, 22) AND failure_count IS NULL;`).
3. Bug 593 (small: timeline.ts plus tests, PR to main).
4. ADO-594 design session, then ADO-592 build, then one all-fronts PROD backfill.
- Context for 592: 7+ Missouri map stories from September 17-23 (one at alarm 4) and the September 3 alarm-5 ruling (14793) have no front yet. The agent works newest-first, so the backfill will reach them.

## Verification
- `npm run qa:fronts`, `qa:agent-prompts`, `qa:smoke` green on test; `qa:fronts` + `qa:agent-prompts` green on the deploy branch before merge.
- TEST `events.agent_pattern` is byte-identical to the maintenance file (checked).
- PROD reads in this session used the public anon key against `v_tracker_stories` only.

# Handoff: ADO-582 election front assignment agent on TEST (September 15, 2026)

Josh's prompt: build the Claude agent that judges the election stories the regex sweep cannot (ADO-581 session 2), after confirming the PROD RSS run picked up the fronts step and the two new feeds. Everything below ran unattended; nothing went to PROD.

## Outcome in one line
The agent exists, ran once on TEST against the full pool of 87 candidates, made 87 auditable decisions (3 assign, 84 decline, 2 flagged borderline, 0 errors) that all hold up against the rubric, and refreshed the main line itself. ADO-582 is in Testing. PROD is the next session, after Josh's read.

## What was built (commit c6bbc29 + this session's second commit on `test`)
| Piece | Where | Notes |
|-------|-------|-------|
| Migration 116 | `migrations/116_front_agent_candidates.sql` | Applied on TEST via the SQL editor. `events.agent_pattern` (candidate regex as data), `story_event.note` (agent rationale, hidden from anon by a column-level grant), `front_agent_candidates(p_slug, p_limit)` RPC |
| Prompt | `docs/features/fronts-claude-agent/prompt-v1.md` | The routine reads it from the repo at run time. Rubric, calibration table, dry-run mode (`FRONTS_DRY_RUN=true`), 0.70 assign gate, exact `FRONTS_MAX_PER_RUN` cap (default 80), ends with `refresh_tracker_derived()` and a Discord one-liner when it assigned anything |
| Plan | `docs/features/fronts-claude-agent/plan.md` | Why, shape, decisions, rollback |
| Constant | `scripts/lib/skip-reasons.js` | `REASONS.AGENT_DECLINED = 'agent_declined'` |
| Test | `scripts/tests/front-agent-prompt.test.mjs` (in `qa:fronts`) | Prompt, constants and the RPC filter must use the same strings; no hardcoded `event_id`; seeded pattern matches the redistricting headlines and misses "pollution" |
| TEST routine | `trig_01YL4HM5wLdqUseS1L33bvgp` "Front Assignment Agent - Election (TEST)" | env `env_01YRYGLu8C8ijpVWdPAwgVSQ`, branch `test`, model `claude-sonnet-5`, no cron. First run: session `cse_015ComXbczwZfBc2AWzzzhcH`, 319 s, 24 turns |
| Docs | `docs/database/database-schema.md` | events.agent_pattern, story_event.note + grant, the RPC |

## Design calls made without Josh (say if any is wrong)
1. **Routine, not a GitHub Actions step.** The card says "daily after `assign-fronts.js` and before `refresh-tracker.js`". A claude.ai routine cannot sit inside a workflow job, and a Node script calling the API would cost money. So: the sweep keeps running every 2 h in Actions, the routine runs daily, and it calls `refresh_tracker_derived()` itself at the end (the same RPC `refresh-tracker.js` calls). Same effect, $0.
2. **Pool comes from an RPC**, because PostgREST cannot express "no `story_event` row AND not declined since last update". The pattern lives on `events.agent_pattern` so it is tuned with `UPDATE`, like the sweep rules.
3. **`story_event.note`** holds the one-line rationale so assignments are auditable. Anon cannot read it (column-level grant, like `tracker_pin.note`). Verified on TEST: `v_tracker_stories` / `v_event_stats` still read as anon; `story_event?select=note` and `select=*` return 42501 as anon.
4. **Declines are remembered.** A declined story is excluded from the pool until its `last_updated_at` moves (new articles), so the daily run only re-judges stories that changed. `pipeline_skips` retention is 30 days.
5. **Assign needs confidence >= 0.70**; a lean-assign below that is a decline with `metadata.uncertain = true` and a rationale starting `borderline:` so Josh can pull them in one query.

## TEST run results (September 15, 2026, 03:15 UTC)
- Pool 87 (all active, enriched, unassigned stories with an election word; the sweep had already taken the obvious ones). Judged 87 in one run: **3 assigned, 84 declined, 2 of the declines borderline, 0 errors, 0 conflicts.** `refresh_tracker_derived` changed 2 rows.
- Assigned: 17038 "Trump's election crusade hits another wall at the Supreme Court" (0.75, alarm 1, off main line by the floor), 17031 "Trump doubles down on SAVE America Act after Supreme Court loss on mail voting" (0.80, alarm 3, on main line), 16897 Alaska mail-ballot deadline case at SCOTUS (0.75, alarm 4, on main line).
- Borderline declines: 17020 "Capitol agenda: SAVE America swallows Washington" and 17032 "Pentagon and elections bills could be combined" (a bill not yet through a chamber; the rubric says assign when it passes).
- Spot-check: I read all 87 rationales against the rubric, not a sample of 30. I agree with every decision. The ones worth Josh's eye: 14695 (new prosecutor on the Georgia 2020 case, declined as not a current rule change), 16171/16150 (Dominion-Giuliani settlement, declined as private), 16082 (Newsom defending his redistricting move, declined as rhetoric).
- **Limitation for AC 1:** TEST cannot produce 15 assignments. Its pool is horse-race coverage because the regex sweep already filed the real election stories, and TEST has no Missouri redistricting story at all (ingestion stopped in July). The 15-assign / Missouri check has to happen on PROD, where the September 14 dry run counted 125 redistricting stories in the pool.
- Prompt compliance: the run applied the 80-cap between pages and judged 87. The prompt now says the cap is exact (`p_limit = min(25, cap - judged)`).

Queries to see it yourself (TEST SQL editor):
```sql
SELECT se.story_id, s.alarm_level, s.main_line, se.confidence, se.note
  FROM story_event se JOIN stories s ON s.id = se.story_id
 WHERE se.note LIKE 'fronts-v1:%' ORDER BY se.assigned_at DESC;

SELECT entity_id, metadata->>'confidence' AS conf, metadata->>'uncertain' AS unc, metadata->>'rationale' AS why
  FROM pipeline_skips WHERE pipeline = 'front_assignment' AND reason = 'agent_declined' ORDER BY id;
```

## PROD checks that were asked for (not done, and why)
- **02:00 UTC PROD RSS run:** had not fired by 03:25 UTC (`gh run list --workflow rss-tracker-prod.yml`; last run 00:05 UTC on the pre-merge commit 692b305, so it could not contain the fronts step). PR #143 merged at 00:56 UTC. The next scheduled run is the first proof of ADO-581 AC 3.
- **Feeds 21 and 22 were not fetched in the 00:05 run.** The log says "Selected 14 feeds" and only ids 3-18 appear. `selectFeeds()` filters `is_active = true AND failure_count < 5` (cap 30, so not the cap). On TEST the same insert produced `failure_count = 0`, so the likely PROD difference is a NULL `failure_count` (NULL fails `< 5`) or `is_active` not true. Anon cannot read `feed_registry` on PROD (42501) and the PROD dashboard navigation was denied by the auto-mode classifier this session. **Josh, one query in the PROD SQL editor:**
  ```sql
  SELECT id, source_name, is_active, failure_count, last_fetched_at FROM feed_registry WHERE id IN (21, 22);
  -- if failure_count is NULL:  UPDATE feed_registry SET failure_count = 0 WHERE id IN (21, 22) AND failure_count IS NULL;
  ```
- **572 / 577 to PROD:** not deployed. Both cards are still in Testing with no verification comment from Josh, so the condition in the prompt was not met.

## Next session (PROD)
1. Josh reads the TEST decisions above (five minutes) and says go.
2. PROD SQL editor: run `migrations/116_front_agent_candidates.sql` (additive; the REVOKE/GRANT on `story_event` is the only thing touching existing objects). Verify with the idempotency SELECT at the bottom of the file.
3. Cherry-pick c6bbc29 + the follow-up commit onto a deployment branch from `main`, PR, merge (the prompt is read from `main` by the PROD routine, so the migration must land first).
4. Create the PROD routine via RemoteTrigger: same body as the TEST trigger but `environment_id = env_018AS3Shj6wkH624v1nkssG9`, bootstrap on `main` (`git fetch origin main && git checkout main && git reset --hard origin/main`), `cron_expression = "0 14 * * *"` (Josh to confirm the hour), uuid `fronts-election-agent-prod-v1`.
5. Fire it manually for the backfill. Expect a pool of a few hundred; at the 80 cap that is 3-4 runs (or set `FRONTS_MAX_PER_RUN` on the PROD environment for the backfill). Check that the Missouri redistricting story lands under Election Suppression on the main line (AC 4), then close 582.

## Gotchas found
- The claude.ai Supabase MCP still only sees WhiskeyPal; TEST migrations go through the SQL editor in Chrome (Monaco `setValue` + the Run button). The editor tab cannot be closed by `tabs_close_mcp` even after nulling `beforeunload`; it is still open.
- PostgREST `or=(a.imatch.X,b.imatch.X)` breaks when the regex contains parentheses or commas, and `story_event=is.null` on `stories` is not a valid embed filter here (42703). Both pushed the pool into the RPC.
- A LANGUAGE sql function with `RETURNS TABLE` has no 42702 ambiguity problem (that was plpgsql in 115), but the migration still qualifies every column for consistency.
- The routine judged 87 against a cap of 80 because the cap was phrased per page. Caps in prompts need the arithmetic spelled out.

## ADO
582 moved Active -> Testing with AC status on the card (AC 1 met on TEST for agreement, not for volume; AC 2 met; AC 3 met by design pending the PROD routine; AC 4 not met until PROD; AC 5 met). 581 handoff updated with a pointer here.

## Still owed by Josh (unchanged plus two)
ADO-579 numbers for EO 14420 / 14407; ADO-580 (2392 level 3 vs 4); SCOTUS routine cron `0 16,23 * * *` never confirmed; ADO-564 north-star numbers; 572 / 577 verification on TEST then PROD deploy; `.agents/` and `exec brief for blueprint.png` untracked at repo root; **new:** the feed 21/22 `failure_count` query on PROD; the 14:00 UTC cron hour for the election agent.

## Next-session prompt
```
/start-work ADO-582 PROD: election front assignment agent to PROD. Read docs/handoffs/2026-09-15-ado-582-election-front-agent.md. Order: (1) confirm the latest PROD RSS run logged "Assign stories to fronts" and check feeds 21/22 (Josh runs the feed_registry query if Chrome PROD navigation is denied); (2) migration 116 on PROD via the SQL editor; (3) cherry-pick c6bbc29 + the September 15 follow-up commit onto a deployment branch from main, PR, merge; (4) create the PROD routine (env_018AS3Shj6wkH624v1nkssG9, main, cron 0 14 * * *) and fire it for the backfill until the pool is empty; (5) verify the Missouri redistricting story is on the main line under Election Suppression, then close 582. If Josh has verified 572 and 577 on TEST, deploy both in the same session (migration 114 before code, admin-social edge function, DISCORD_WEBHOOK_URL on PROD).
```

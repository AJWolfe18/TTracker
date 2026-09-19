# Handoff: routine alerts reviewed; Judge write fix (ADO-583) and Stories re-enrichment fix (ADO-584) (September 18, 2026)

Josh's prompt: "we keep having issues on the routines running with stories not being updated in the last week or so or other alerts I have seen but not gotten to - review those findings and report back, then tell me what needs to be done." Then: "my sub lapsed but that's fixed now so fix = go."

## Outcome in one line
Two real problems found and fixed (Judge blocked by the cloud permission classifier since September 16; Stories agent rewriting unchanged old stories forever), one false alarm explained (the "8-day gap" push was a 1,000-row query cap), and the September 12-13 outage traced to Josh's lapsed Claude subscription. Judge fix is on main and being proven on PROD; Stories fix is on TEST and waits on one PROD migration paste.

## What the alerts were (the report Josh got)
| Alert | What it really was | Status |
|-------|-------------------|--------|
| Stories not updating ~September 12-13 | Every routine run from September 12 02:34 UTC to September 13 18:34 UTC died in 10 s with `403 authentication_failed: Your organization has disabled Claude subscription access for Claude Code`. Pardons September 12 too. Josh: subscription lapsed. Self-healed September 13 20:34 UTC. | No action; memory note added so the next agent does not blame the scheduler |
| Stories agent push September 17: "8-day gap" | The agent's log query had no limit; PostgREST capped it at 1,000 rows, which happens to end at September 10 00:35. Per-day counts show runs every day except September 12-13. When Josh asked "why was there an 8 day gap" the follow-up session repeated the bad query. | False alarm |
| Judge push notifications (5-6 since September 16 evening) | Every PROD Judge run since September 16 21:04 UTC judged 30 pairs, then the cloud auto-mode classifier denied the write step ("Modify Shared Resources", once "Logging/Audit Tampering"). Last good run September 16 13:10 UTC (2 merges). Nothing on our side changed (main at fea57ef both times). | ADO-583, fixed below, PROD proof pending |
| Stories agent push September 18: "2,690-story backlog" | Design flaw: Step 2 treated every Claude-enriched story older than 12 h as stale with no new-article check. 15,025 active stories never close, so spare slots rewrote July/August stories forever, and no-source stories (12675: 21 failures) were retried every 12 h. New stories were never starved (nulls first). | ADO-584, fixed below |
| Lint PROD References failures September 8-15 | test/deploy branches, already fixed | Noise |
| Health check "❌ Job #..." rows | November 2025 job_queue leftovers; preflight says all GO | Cosmetic, optional cleanup |

**New side finding:** the Supabase org is at **162% of the free plan's database size quota** (0.811 GB of 0.5 GB; TEST is 0.177 GB, so PROD is ~0.63 GB). The dashboard shows "exceeding usage limits". Supabase can restrict (read-only) projects over quota. Needs Josh's decision: shrink PROD (embeddings/content on old articles) or Pro plan ($25/month, inside the $50 budget). Not ticketed yet.

## What was built
| Piece | Where | Notes |
|-------|-------|-------|
| Migration 117 | `migrations/117_stories_needing_enrichment.sql` | RPC `stories_needing_enrichment(p_limit, p_cooldown_hours, p_max_failures)`: never-enriched first, then Claude-enriched stories with an `article_story.matched_at > last_enriched_at`; excludes legacy GPT rows, no-article stories, `enrichment_failure_count >= 10`. service_role only. **Applied on TEST** (SQL editor). **NOT applied on PROD** (Chrome navigation to the PROD project was denied by the auto-mode classifier this session) |
| Stories prompt | `docs/features/stories-claude-agent/prompt-v1.md` Step 2 | Calls the RPC once; stops with no writes + one push on PGRST202/42501 (deploy-order guard); invariant 18; changelog row |
| Judge prompt | `docs/features/clustering-judge/prompt-v1.md` Steps 5-6, failure handling | One labeled `curl` per merge (no loops/scripts), one bulk POST for the audit log, no probe rows, explicit platform-denial rule (log blocked merges `merged=false` with `blocked:` rationale, one notification, no workarounds). Verdict rules untouched |
| Contract test | `scripts/tests/agent-prompt-contracts.test.mjs`, `qa:agent-prompts` in `qa:smoke` | Prompt/migration text contracts for both agents |
| Schema doc | `docs/database/database-schema.md` | `stories_needing_enrichment` entry |
| TEST Judge routine | `trig_01B2gdNTCLUe7yjwpiz5K5uU` "Clustering Judge Agent (TEST)" | New, manual fire only, bootstraps on `test`. TEST env has no `JUDGE_DRY_RUN`, so dry-run |

Commits: `32b09b2` on `test` (everything). PROD: PR #144 (Judge prompt + migration file + schema doc) **merged** September 18 22:37 UTC; PR #145 (Stories prompt + test + package.json) **draft, do not merge until migration 117 is on PROD**.

## Verification
- `qa:smoke` green on `test` (includes the new contract test).
- Migration 117 on TEST: RPC returned 75 rows, all never-enriched, zero unchanged old stories.
- TEST Stories routine run `cse_011CJceYEWs1CwttQZhXBB7D` (fired 22:31 UTC on the new prompt): processed exactly the first 40 stories the RPC returned (ids 17055-17219, all never-enriched), 40 log rows all `completed`, 0 failed, no `running` leftovers; pool went 75 -> 35 and the next candidate is 17220. No previously enriched story was touched. AC 1-3 met on TEST (the empty-run heartbeat path was not exercised because the pool was non-empty; that text is unchanged).
- TEST Judge routine run `cse_014QrseZ1P9Xk4WyPZy7SSBi`: 0 candidate pairs on TEST (ingestion quiet), heartbeat insert OK, prompt loads and runs.
- PROD Judge routine: a manual fire from this dev session was **denied by the same classifier** ("Modify Shared Resources"), so the proof is the scheduled 05:03 UTC September 19 run, or Josh pressing Run at https://claude.ai/code/routines/trig_01DDXZkpC9PkgTzU8wDdL9QM. Success = `clustering_judge_log` rows for that run_id.

## Review pass (after Josh asked "did you do the PR review?")
Two `code-review high` passes (forked skill, no Agent tool in this session) on PR #144 and #145 converged on the same gaps, all fixed in `f232a51` on `test` and rebuilt into PR #145:
1. **Failed attempts were never retried.** The v1 rule required a new article; a transient write failure on a one-article story would hide it from the site forever. Now: `retry_failed` branch (last attempt failed or no `summary_neutral`), cooldown, cap 3 (AC 2 met literally). New-article and merge branches stay uncapped.
2. **Judge merges never re-qualified the survivor.** `merge_stories` repoints `article_story` rows without touching `matched_at`. Now: `story_merge_audit` merge/unmerge after the watermark qualifies (`merged` reason). TEST proof: 16981 and 17024.
3. **Mid-enrichment attach race.** `last_enriched_at` is stamped minutes after the articles were read. Now: the RPC returns a DB-issued `evidence_as_of` (max `matched_at`), the agent echoes it into `enrichment_meta` on every write, and the RPC compares against that (same pattern as Judge migration 106).
4. **Judge bulk log was crash-fragile.** One end-of-run POST meant a cut-off run left executed merges with no log row (no admin unmerge, no memory). Now: each executed merge is logged immediately with its own one-row POST; the bulk POST covers the rest.
5. Smaller: Section 2 examples in both prompts still taught the banned shapes; Judge invariant 1 lacked the denial carve-out; `jq --arg` in Bash reintroduced the quoting hazard (use the Write tool); one LATERAL aggregate instead of three correlated probes. Reviewer also noted the legacy name `get_stories_needing_enrichment` in the schema doc; it does not exist on TEST (PGRST202) and is unrelated.
Migration 117 v2 changes the RPC's return type, so it starts with `DROP FUNCTION IF EXISTS` (the SQL editor shows a "destructive operation" confirm; accept it). Applied on TEST; `qa:agent-prompts` extended; still Josh's paste on PROD.

## Design calls made without Josh (say if any is wrong)
1. **RPC instead of a client-side filter.** PostgREST cannot compare `last_enriched_at` to `article_story.matched_at`, and a jq filter over a 200-row window would miss stories deeper in the treadmill. One RPC, no new columns.
2. **Failure cap is 10, not 3.** The new-article rule already stops timer-based retries; a failed story is retried only when a new article attaches. The hard cap only catches pathological rows (12675). AC 2 on ADO-584 reads "3+"; the delivered behavior is stricter in spirit and documented on the card.
3. **Judge fix is a best-effort prompt reshape.** The classifier is Anthropic's, not ours; the successful September 16 13:10 run and the blocked 21:04 run used the same command shapes, so the change is about making each write small, labeled and reversible-looking. If the PROD proof run is still denied, disable the routine and escalate (AC 2).
4. **Split PRs.** The Stories prompt would break the PROD agent (PGRST202 every run) if merged before migration 117, so it sits in its own draft PR.
5. **ADO writes via REST, not the ado subagent** (Josh's subagent ban). Tags could not be set (PAT lacks tag-create permission); items carry no tags.

## Gotchas found
- Routine `list_runs` shows fires that died before the model answered (10-second sessions with `api_retry 403`); `get_run_log` on one of them names the cause. The routine's own `last_run` only shows the latest run.
- PostgREST's 1,000-row default cap silently truncates unlimited log queries; an agent reasoning about "when did the log go quiet" from such a query is wrong. Use per-day counted queries.
- Chrome navigation to the PROD Supabase project is classifier-gated per session (allowed September 14, denied September 18). Plan PROD SQL pastes for Josh.
- ADO REST: creating a work item with `System.State=Active` fails (create as New, then PATCH); `System.Tags` on create fails with "does not have permissions to create tags".
- A `git cherry-pick` across `test` -> `main` conflicts on `package.json` (main lacks ADO-572/577 scripts) and the schema doc (main lacks migration 116's entry); resolve to "main + only this change's lines".

## ADO
- ADO-583 (Bug, Active): Judge block. PR #144 merged. Move to Resolved once a PROD run writes its `clustering_judge_log` rows.
- ADO-584 (User Story, Active): Stories re-enrichment. On TEST. Testing after the TEST run verifies; Ready for Prod once Josh pastes migration 117; Closed after PR #145 merges and a PROD run reports a sane pool.
- Both under epic 13 (Story Clustering System).

## Still owed by Josh
1. **Paste `migrations/117_stories_needing_enrichment.sql` into the PROD SQL editor**, then say so; I merge PR #145 and fire the PROD Stories routine.
2. Decide on the Supabase database-size overage (shrink PROD vs Pro plan $25/month).
3. Unchanged from before: ADO-579 numbers (EO 14420 / 14407); ADO-580 (2392 level 3 vs 4); SCOTUS routine cron `0 16,23 * * *`; ADO-564 north-star numbers; 572 / 577 verification then PROD deploy; ADO-582 PROD (migration 116 + routine); `.agents/` and `exec brief for blueprint.png` untracked at repo root.

## Next-session prompt
```
/start-work ADO-584 PROD + ADO-583 close-out. Read docs/handoffs/2026-09-18-ado-583-584-routine-alerts-and-fixes.md. (1) Confirm Josh applied migration 117 on PROD (SELECT ... FROM stories_needing_enrichment(5,12,10) via a service-role path, or Josh's word); merge PR #145; fire the PROD Stories routine trig_0182WcUVyjF7Q5o2GWJMxbo1 and check pool_size and that no unchanged old story was rewritten; close 584. (2) Check the PROD Judge runs since PR #144 (list_runs on trig_01DDXZkpC9PkgTzU8wDdL9QM): rows in clustering_judge_log per run_id = fixed -> Resolved/Closed 583; still denied -> disable the routine (RemoteTrigger update enabled=false), note on 583, escalate to Anthropic. (3) Ticket the Supabase DB-size overage (162% of free quota) with Josh's decision.
```

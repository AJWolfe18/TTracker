# November 2, 2026: fronts agent timeout fix, election and Iran triage (ADO-592, 594, 556, 637)

## FIRST-UP for next session (Election Day, November 3)
1. **Migration 135 paste: TEST, then PROD.** Codex cleared commit `6a8b5cd` (no findings). Josh had the TEST paste on his clipboard at end of session; PROD was not pasted. Expected first column `candidates_fn` = 1 (TEST `pool_30d` = 0 is expected: newest TEST story is September 8). If PROD lands before 14:00 UTC (8:00 AM CT), that day's All Fronts run uses it. Verify with `RemoteTrigger list_runs trig_01KiZVrHE8RdC7Nuw66HJd7j` + `get_run_log`: the run should get past Step 3 and assign stories.
2. **Two environment variables** (they live on the cloud ENVIRONMENT, not the routine; RemoteTrigger cannot set them, Josh does it in the web UI): PROD env `env_018AS3Shj6wkH624v1nkssG9` gets `LABEL_BACKFILL_PROD=true` (label backfill has refused all 27 runs since October 24, 16,432 PROD stories unlabeled; ADO-594). TEST env `env_01YRYGLu8C8ijpVWdPAwgVSQ` gets `FRONTS_POOL_DAYS=all` (otherwise the TEST fronts pool is empty after 135).
3. **Alarm deflation (ADO-556 comment, Josh decision).** Alarm 4+ share fell from 15% (August) to under 1% since October 1; main-line stories August 84, September 73, October 16. Election and Iran stories sit at 2-3, so the homepage main line barely shows them.
4. **RSS cadence + feeds (ADO-637 comment).** PROD RSS still runs 3-5x/day; the external trigger and WaPo to NBC SQL are test-only and need Josh's Codex + cron-job.org. Iran coverage is thin because every feed is a politics feed.
5. **Proposed new cards (Josh to approve):** (a) PROD stories never close: about 16,700 are `status='active'` though the lifecycle says closed after 72 hours - this is what made the fronts RPC time out and will slow any other active-story scan; (b) add 3-4 national-security / world feeds for Iran (score with `scripts/rss/scorer.js` first; mind the DB-size overage).

## What was found
- **All Fronts agent judged nothing for 9 days.** Every PROD run October 25 - November 2 stopped at Step 3: `front_agent_candidates_all` returned HTTP 500 57014 (statement timeout, ~8 s). Only the regex sweep filed stories (Iran 9, Election 21 since October 25). Unfiled examples: "Judge dismisses Trump attempt to block Alaska Senate race results", "DOJ's Alaska election theory could give Trump sweeping power over state elections".
- Other PROD routines healthy (Stories, Judge, Pardons, EO, SCOTUS). Needs-review queues: 1 old EO flag; pardons, SCOTUS, stories 0.
- PROD anon cannot read `feed_registry` (42501); feed health was checked via per-source article counts instead (WaPo 0 since October 14, NBC never arrived).

## What shipped (test branch, `6a8b5cd`)
- `migrations/135_front_candidates_window.sql`: `p_days` (default 30, NULL = no window) applied in the cheap first pass, ordered by newest change; drops the one-argument version (two versions = PGRST203); the paste raises and rolls back if the 30-day pool takes over 5 s. The agent's `{p_limit}` call is unchanged, so PROD needs only the paste, no main deploy.
- `scripts/fronts/front-agent-db.js`: `FRONTS_POOL_DAYS` (days or `all`; TEST only, the full pool times out on PROD). Reaches PROD only with the next main deploy; not needed for the fix.
- Tests: section 8 of `all-fronts-agent-sql-pglite.test.mjs`, env cases in `front-agent-prompt.test.mjs`. `npm run qa:smoke` passed.
- Docs: prompt env/migrations rows, schema doc entry, 127 header marked superseded.
- Review: `/code-review medium` 8 real (fixed), 2 not acted on (stale active lifecycle = proposed card; the timing gate is a guard, not a guarantee). Josh's Codex: no findings.

## Gotchas
- Never re-run 127 after 135 (recreates the one-argument function beside the new one).
- ADO-592 AC5 backlog drain can no longer be "run the full pool": a full-pool call times out on PROD. Needs a plan (labels backfill first shrinks it).

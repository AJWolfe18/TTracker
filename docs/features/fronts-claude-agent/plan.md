# Front Assignment Agent (Election Suppression) - Plan

**ADO:** 582 (ADO-581 session 2). Parent epic 543. Status lives on the card, not here.
**Prompt:** `prompt-v1.md` in this folder (the deliverable the cloud routine reads at run time).
**Migration:** `migrations/116_front_agent_candidates.sql`.
**Cost:** $0 marginal (Claude subscription cloud routine). No OpenAI. Egress per run: headline + summary for at most 80 stories (about 100 KB).

## Why

The migration-115 regex sweep runs every pipeline cycle and files the obvious election stories. Two classes are still missed, by design:

1. **Redistricting.** Pulled out of the sweep on September 14, 2026: a PROD dry run showed 125 of 357 alarm-3+ matches were map fights, and under the floor-3 main-line rule they would have drowned the homepage. Josh still wants the real ones ("Missouri court allows Trump-backed districts").
2. **Judgment cases.** History pieces, rhetoric, mobilization stories and horse-race coverage that carry election words but are not the state changing the rules. More regex is the wrong tool (ADR 0001: judgment problems get a Claude agent, not prompt-tuning on a pattern).

## Shape (mirrors the SCOTUS / Stories cloud agents)

```
GitHub Actions RSS run (every 2h)          claude.ai routine (daily 14:00 UTC)
  assign-fronts.js  (regex sweep)   ---->    Front Assignment Agent
  refresh-tracker.js                         1. front_agent_candidates('election-suppression', 25)
                                             2. judge each: assign / decline (Section 4 rubric)
                                             3. story_event row  |  pipeline_skips row
                                             4. loop pages until empty or MAX_PER_RUN
                                             5. refresh_tracker_derived()  (main line updates today)
                                             6. Discord one-liner if assigned > 0
```

**Ordering.** The ADO card says "after `assign-fronts.js` and before `refresh-tracker.js`". A cloud routine cannot sit inside a GitHub Actions job, so the equivalent is: the routine runs after the sweeps have had their turn (every 2h all day) and ends by calling `refresh_tracker_derived()` itself, exactly what `refresh-tracker.js` does. The pool it sees is only what the regex did not catch, because the sweep's `story_event` rows exclude those stories from the RPC.

**Why an RPC instead of PostgREST filters.** The pool needs two `NOT EXISTS` (no `story_event`, no prior decline since last update) and a regex on two columns. PostgREST cannot express the anti-joins; the RPC keeps the pool definition in one place and lets the pattern live as data on `events.agent_pattern` (the migration-115 convention: tune with `UPDATE`, never a prompt edit).

**Why a `note` column on `story_event`.** The spot-check and Josh's audit need to see *why* a story was assigned. `confidence` alone is not auditable. `note` is hidden from anon by a column-level grant (same treatment as `tracker_pin.note`, migration 112).

**Decline dedup.** A declined story would otherwise be re-judged every day while it stays active. The RPC excludes stories with a `front_assignment / agent_declined` skip row created after the story's `last_updated_at`. New articles bump `last_updated_at`, so a story that grows is judged again. `pipeline_skips` retention is 30 days; a still-active story older than that gets one more look, which is fine.

**Concurrency.** `story_event.story_id` is the PK, so two writers cannot both assign. The agent treats 409 as "already assigned" and moves on. It never PATCHes.

## Decisions (Josh, dated)

| Date | Decision |
|------|----------|
| September 8, 2026 | Session 2 = a Claude agent for the election front ONLY (not all fronts) |
| September 14, 2026 | Redistricting out of the regex; the agent judges map stories |
| September 15, 2026 (Claude, on the pattern) | Agent runs as a claude.ai routine that self-refreshes the main line; not a GH Actions step (no API spend, matches the four existing agents) |
| September 15, 2026 (Claude) | Assign threshold 0.70; borderline leans are declines with `uncertain: true` so they are queryable |

## Open decisions (Josh)

- **Cron time.** Proposed `0 14 * * *` UTC (9 am CT) daily. Blocks: PROD trigger creation.
- **Other fronts.** Same shape works for any front with an `agent_pattern`; the prompt is single-front by design. A second front = new prompt file + `UPDATE events SET agent_pattern`. Not in 582.

## Verification

- TEST: migration 116 via SQL editor, push prompt to `test`, create the TEST trigger (env `env_01YRYGLu8C8ijpVWdPAwgVSQ`, branch `test`, no cron), run once, read `story_event.note` + `pipeline_skips` rows, spot-check 30 (AC 1).
- PROD (next session, after Josh's TEST review): migration 116 on PROD first, cherry-pick to main, create the PROD trigger with the cron, run once for the backfill (AC 4), check trumpytracker.com.

## Rollback

Disable the routine (`enabled: false`). Assignments are rows: `DELETE FROM story_event WHERE assigned_by = 'agent' AND note LIKE 'fronts-v1:%'` then `SELECT refresh_tracker_derived()`. The migration is additive (column + function); leaving it in place is harmless.

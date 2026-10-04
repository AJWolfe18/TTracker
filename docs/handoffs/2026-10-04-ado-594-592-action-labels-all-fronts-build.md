# ADO-594 action labels and ADO-592 all-fronts agent: built on test, nothing applied yet

**Date:** October 4, 2026 (CT, afternoon) · **Cards:** ADO-594, ADO-592 (both Active), ADO-610 (Closed), new ADO-614 and ADO-615, comments on ADO-547 and ADO-595 · **Branch:** test, pushed through aa5adb9 · **Reviews:** /code-review medium on every commit range (4 rounds, every finding fixed), plus a second-pass production-readiness review

Josh stepped away mid-session and asked for maximum progress without questions, using agents for independent lanes. Six build/research agents ran in parallel; every result was reviewed and committed in the main session.

## Josh's answers at session start

| Item | Answer | Done |
|---|---|---|
| ADO-610 Codex reviewed the SQL? | Yes | Closed with every AC checked on the card |
| Card for auto-applying migrations | Yes | ADO-614 |
| Fix stale `@codex review` lines | Yes ("we no longer do the automatic reviews") | They were in `docs/guides/pr-workflow.md`, not AGENTS.md; rewritten; AGENTS.md got one clarifying line |
| ADO-548 "A+ with tabs" | Not yet | Unchanged |
| ADO-595 D1 backfill importer | Approved after a plain explanation | ADO-615 (B1 importer, about $0.50 one time); B2 manual add folded into ADO-547; recorded in plan-595 |

## What was built (all on test, none applied to a database)

Auto mode blocks Claude from pressing Run in the Supabase SQL Editor (even on TEST). Every SQL file below is a Josh paste.

| Piece | File(s) | Tests |
|---|---|---|
| S1 label columns, human-label lock, labels on `v_tracker_stories` | `migrations/123_story_action_labels.sql` | `action-labels-sql-pglite` (31) |
| S2 Stories agent writes labels (claude-v1.1), TEST-only GOLD CHECK mode | `migrations/124_...label_source.sql`, `docs/features/stories-claude-agent/prompt-v1.md` | `stories-queue-label-source-pglite` (16), `qa:agent-prompts` |
| Gold set + gate | `scripts/tests/fixtures/action-label-gold.json`, `scripts/maintenance/action-label-gold-check.js` (90% gate, reports the 34 held-out stories too) | smoke-tested |
| S3 one-time label backfill | `migrations/125_label_backfill.sql`, `scripts/maintenance/label-backfill-db.js`, `docs/features/events-tracker/label-backfill-prompt.md` | `label-backfill-sql-pglite` (50), `label-backfill-db` |
| S4 main-line rule v2 (on top of v1.3) | `migrations/126_main_line_rule_v2.sql` | `main-line-v2-sql-pglite` (31, real refresh) |
| S5 | already shipped with ADO-608 | |
| S6 Did / Said / Analysis behind `did_said` (TEST on, PROD off) | `src/lib/timeline.ts`, `src/components/TrackerSpine.tsx`, `src/lib/tracker-boot.ts`, flags files | 238 UI tests, lint, build |
| ADO-592 core + S7 (coverage not a candidate) | `migrations/127_all_fronts_agent.sql`, `scripts/fronts/front-agent-db.js`, `docs/features/fronts-claude-agent/prompt-v1.md` (now fronts-v2) | `all-fronts-agent-sql-pglite` (30), `qa:fronts` |
| ADO-592 per-front reviews (all nine published fronts) | `docs/features/fronts-claude-agent/front-reviews/*.md` | PROD headline probes (anon, read-only, about 6 MB total), every regex run in PGlite on all 16,383 PROD headlines |
| ADO-592 definitions file | `scripts/maintenance/2026-10-04-ado-592-front-definitions.sql` | `front-definitions-sql-pglite` |

`qa:smoke` green. CI on aa5adb9 green (Lint PROD References, RSS health).

## Josh: TEST apply order (one file at a time, TEST SQL Editor)

1. `migrations/123_story_action_labels.sql` (already loaded and hash-checked in the Chrome tab Claude opened). First result column: `labeled_stories` = 0.
2. `migrations/124_stories_needing_enrichment_label_source.sql`. First column: `rpc_has_label_source`.
3. `migrations/125_label_backfill.sql`. First column: `backfill_pool` (about 750 on TEST).
4. `migrations/126_main_line_rule_v2.sql`. First column: `rows_changed` (about 0: no labels yet).
5. `migrations/127_all_fronts_agent.sql`.
6. `scripts/maintenance/2026-10-04-ado-592-front-definitions.sql`, three pastes (pre-check, apply, result), NOT between 14:00 and 14:15 UTC (9:00 AM CT). Result: 9 rows, first column `slug`, `in_agent` true on every row.

Then on TEST:
- Add `Bash(node scripts/maintenance/label-backfill-db.js *)` to `.claude/settings.json` permissions.allow (same pattern as the fronts agent's rule). Claude did not edit it. Without it the routine's first call is denied (second-pass review, October 4). Cherry-pick it to main together with the prompt.
- Create the label backfill TEST routine from `label-backfill-prompt.md` (branch test, no cron), run it twice (750 stories), then `node scripts/maintenance/action-label-gold-check.js --db` must pass 90%.
- Run the TEST Stories routine once in GOLD CHECK mode (`GOLD CHECK: 17215, ..., 17254`) for S2's gate.
- Run the TEST fronts routine once (fronts-v2), spot-check 30 decisions (ADO-592 AC4).
- Look at TEST with `did_said` on: Said / Analysis tags only show once labels exist.

## PROD order (later, after the TEST checks)

123 and 124 on PROD **before** the claude-v1.1 Stories prompt reaches main (the prompt stops with no writes if 124 is missing). 125, 126 any time after 123. 127, then the definitions file outside the 14:00 UTC run, **before** the fronts-v2 prompt reaches main (the old prompt keeps using the 116 RPC until then). Migration 126 changes the PROD main line as soon as labels exist, whatever the `did_said` flag says (ally/other loose ends drop off, did by trump/administration at 3+ comes on): apply it only once that shift is accepted. `did_said` stays off on PROD until the PROD label backfill has run (about 38 runs at 3 a day). The PROD regex cost of `front_agent_candidates_all` is unmeasured: run `EXPLAIN ANALYZE SELECT count(*) FROM front_agent_candidates_all(25)` after 127.

## Decisions made without Josh (all reversible)

- Rule v2 is built on v1.3 (D4 was superseded October 3), so the PRD's 14.4 v2 column differs on 17234 (on) and 17231 (off); PRD 14.4 now says so.
- A label written without an actor counts as `other` (off the main line), per edge case 12.
- The gold gate counts a story as agreeing when the label matches and the actor is on the same side (trump/administration vs ally/other); a missing actor fails.
- Agent definitions live in `events.agent_definition` (data, editable by ADO-547 later) rather than in the prompt.
- Uncertain backfill labels go to `pipeline_skips` (`label_backfill` / `label_uncertain`) as Josh's review list.
- Definitions-file questions (17 of them) were left out of the SQL; the agent holds the Anthropic and abortion-pill stories as uncertain declines.

## Open for Josh

- **17 front questions:** `docs/features/fronts-claude-agent/plan.md`, "Open for Josh" (Epstein UK fallout, Iran vs all wars, Courts scope, hand-moves of 10 Israel and 10 envoy stories, Tina Peters, abortion pill, the Anthropic rows, and more). Also on ADO-592.
- **ADO-594 scope note:** how EOs, pardons and SCOTUS rulings join fronts (needs a design call before ADO-548 front pages).
- ADO-548 homepage design, still unconfirmed.

## Findings noticed, not fixed (and where they live)

- A definitions change applied mid-run can hide that run's later declines from the new front (low; documented in plan.md; ADO-592 comment).
- Verification queries in the October 1 and 2 fronts maintenance files call the old `front_agent_candidates`, so their `agent_pool` numbers read high once fronts-v2 runs (ADO-592 comment).
- The social-post pool (`main_line` + alarm 5) will shrink as stories are labeled coverage; intended, watch it (ADO-594 comment).

## Gotchas from this session

- Auto mode now denies clicking Run in the Supabase SQL Editor; loading SQL with monaco `setValue` (or fetching from raw.githubusercontent.com at a pushed commit) still works.
- An UPDATE that omits a column passes the OLD value to a BEFORE trigger, so "no source sent" is indistinguishable from "same source sent"; migration 123's trigger treats a changed label with an unchanged source as an agent write.
- Widening one front's sweep can steal stories through a lower-priority front's co-word: re-check every co-word exclusion that mentions the widened front.
- All TEST routines have no cron, so pushing a prompt that needs an unapplied migration to `test` cannot break a scheduled run.

## Monday, October 5

`/scotus-review 2099,2399` for ADO-580.

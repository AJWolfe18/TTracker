# Handoff: Stories Claude Agent — Tasks 1-4 Complete

**Date:** 2026-07-01
**Branch:** test
**ADO:** 528 (Stories Claude Agent — replace GPT-4o-mini enrichment), state=Active

## What Was Done

Picked up execution of `docs/features/stories-claude-agent/plan.md` (written and Codex-reviewed last session, not yet started). Used `superpowers:subagent-driven-development` — a fresh implementer subagent per task, a task-scoped reviewer after each, and a final whole-branch reviewer at the end. Executed Tasks 1-4 of the plan's 7 tasks; Tasks 5-7 (cloud trigger, validation, PROD cutover) are explicitly out of scope for this session, blocked on a prerequisite (see "Next Session Should").

### Clearing up a mid-session question: was there a separate "Codex prompt"?

Josh asked whether a prompt for the Stories agent already existed from Codex's earlier review. Investigated and confirmed: no. Codex's 3 rounds of review (recorded in `plan.md`'s Review Log) were *local plan review* — architecture, query correctness, RemoteTrigger API shape, concurrency handling — not prompt authoring. ADO-528 had zero comments. The actual `prompt-v1.md` did not exist anywhere before this session; it was written fresh in Task 3. (Later in the session, Josh pasted a block of prompt content that turned out to be the *EO* agent's existing, already-committed prompt — not anything Stories-related. Confirmed via `git log` that `docs/features/eo-claude-agent/prompt-v1.md` predates this session by months.)

### Task 1: `stories_enrichment_log` migration

`migrations/098_stories_enrichment_log.sql` — mirrors `091_executive_orders_enrichment_log.sql`, with one deliberate difference: `story_id` is nullable (EO's `eo_id` is NOT NULL). Stories runs 12x/day vs EO's 1x/day, so healthy zero-candidate cycles are common; a nullable `story_id` lets the agent write a run-level heartbeat row (`story_id: null`) so "no rows" can't be confused with "agent isn't running."

**Applied to TEST manually** — no available MCP tool has DDL access to TrumpyTracker's Supabase (the only Supabase MCP with `apply_migration`/`execute_sql` is connected to an unrelated WhiskeyPal project; `supabase-test`'s tools are PostgREST-only). Applied via the Supabase SQL Editor in the browser (`claude-in-chrome`), then verified via `GET /stories_enrichment_log?select=count`. **This will recur for any future migration on this project until a proper DDL-capable MCP connection exists for TrumpyTracker** — worth a note for whoever hits this next.

### Task 2: Kill switch for legacy GPT enrichment

`scripts/rss-tracker-supabase.js`'s `run()` now gates `this.enrichStories()` behind `process.env.ENABLE_LEGACY_STORY_ENRICHMENT === 'true'`, defaulting OFF. Wired `vars.ENABLE_LEGACY_STORY_ENRICHMENT` into both `rss-tracker-prod.yml` and `rss-tracker-test.yml`. `enrichStories()`, `enrichAndBillStory()`, and `enrich-stories-inline.js` are untouched — 60-day cold standby per the plan, not deleted.

**Live-tested against TEST, both branches:** switch off → 75 new stories clustered, 0 enriched, no legacy log line, `summary_neutral` null on all. Switch on → legacy path enriched the 8 backlog stories from the first run, ~$0.0039 real OpenAI spend, budgets table updated correctly. A pre-existing unrelated feed parse failure (feed 178, "Time") occurred during the second run — not caused by this change.

**Known gap:** the `ENABLE_LEGACY_STORY_ENRICHMENT` GitHub repo variable doesn't exist yet in Actions settings. The workflow YAML is correct and an unset var evaluates to the safe "off" default, but if the rollback path is ever actually needed, someone has to create that repo variable first.

### Task 3: Agent prompt v1

`docs/features/stories-claude-agent/prompt-v1.md` (now 530 lines after Task 4). Follows the EO prompt's structure (PostgREST reference, temp-file JSON body pattern, validate-before-write checklist, failure handling, security, invariants) adapted for Stories' specifics: the corrected Step 2 query (with the `enrichment_meta->>source = claude-agent` discriminator that keeps legacy-GPT-enriched stories permanently out of the new agent's queue), optimistic-PATCH-filtering concurrency guard (no DB trigger exists for stories, unlike EO), and the zero-candidate heartbeat row.

All 18 items of the plan's Task 3 Step 4 checklist were self-reviewed as YES before commit, and independently verified in this session's own follow-up review (see "Independent Expert Review" below).

### Task 4: Gold-set curation

5 real, PROD-sourced calibration examples (story IDs 11934, 11975, 12029, 12021, 11918), spanning alarm_level 0, 1, 2, 3, 4 — no fabricated examples needed, real level-0/1 candidates existed in the 300-row PROD sample. Notably, 2 of the 5 required the hand-curator to assign a *lower* alarm_level than what the legacy GPT pipeline had originally assigned to those same stories (5→4, 1→0), and one required a category correction — direct evidence of the saturation bug this whole project exists to fix, not an error in this task.

**Data-quality finding (not fixed here, just surfaced):** all 5 selected stories had `articles.content = NULL` in PROD — only the ~500-char `excerpt` was available. The prompt already handles this gracefully (Step 3B reads "title + `content` or `excerpt`, whichever is populated"), but it's worth someone checking why article scraping isn't populating `content` for these rows.

Required Josh's explicit sign-off before this task ran — reading PROD data (even read-only, via the public anon key) triggered the harness's auto-mode PROD-read permission gate. Confirmed via `AskUserQuestion`, then proceeded.

### Voice DOs/DON'Ts addendum (controller-applied, not a plan task)

While Task 4 ran, did an independent expert re-review of `prompt-v1.md` against the retired GPT prompt, `tone-system.json`, and EO's live prompt (Josh explicitly asked for this: "put your expert prompt generator hat on"). Found the new prompt correctly and accurately defers to `tone-system.json` for every banned-phrase/opening/pattern list, but had dropped the retired prompt's explicit "PERSPECTIVE" framing ("writing for a progressive audience... don't both-sides corruption... accountability journalism, not neutral reporting") — EO's own live prompt keeps an equivalent explicit "Voice DOs/DON'Ts" section even after `tone-system.json` existed, on the theory that an LLM benefits from a stated stance, not just an inferred one from a banned-pattern list.

Added a "Voice DOs/DON'Ts" subsection to Section 4 (commit `23d4e64`), paraphrasing rather than duplicating `tone-system.json`'s actual arrays (preserving the "read the live file, don't go stale" principle already established elsewhere in the prompt). Reviewed alongside Task 4's commit — spec-compliant, no issues.

## Review Summary

- 4 individual task reviews (spec compliance + quality), all clean, zero unresolved Critical/Important findings
- 1 final whole-branch review (Opus): zero Critical findings. One **Important** carry-forward item (see below), two Minor (RLS-no-policy pattern confirmed consistent with 091; a doc-path ambiguity between `scripts/enrichment/prompts.js` and `scripts/enrichment/prompts/stories.js` for Task 7 to disambiguate when deleting the retired code)
- `feature-dev:code-reviewer` pass (pattern/security lens): clean, no findings
- `npm run qa:smoke`: 11/11 + 35/35 passed

**Carry forward to the eventual PROD PR — do not forget this:** the kill switch defaults OFF. It must not be cherry-picked to `main` before the Claude agent trigger is actually live on PROD, or PROD story enrichment silently stops (stories keep clustering, just never become visible — no error, no log signal). If it must ship to `main` before the agent is live, set the `ENABLE_LEGACY_STORY_ENRICHMENT` repo variable to `'true'` on PROD as a stopgap until cutover.

## Commits (all on `test`)

```
677f880 feat: add stories_enrichment_log table for Stories Claude Agent observability
07890ed feat: gate legacy GPT story enrichment behind kill switch (Stories Claude Agent takes over)
5e521d6 feat: Stories Claude Agent prompt v1
c9bbfb4 feat: Stories Claude Agent gold set — 5 calibration examples spanning alarm_level 0-5
23d4e64 feat: add explicit Voice DOs/DON'Ts to Stories agent prompt
b53b3d9 docs: add stories_enrichment_log table to database schema reference
```

## Next Session Should

1. **Blocker — Josh's action item:** provision a Cloud Environment in claude.ai/code for TEST (`SUPABASE_URL=https://wnrjrywpcadwutfykflu.supabase.co`, TEST service role key, **Full network access** — `*.supabase.co` isn't on the default allowlist). This is the prerequisite for Task 5 (creating the RemoteTrigger). Not yet confirmed done as of this session's end.
2. Once the Cloud Environment exists: Task 5 (create the TEST RemoteTrigger, run it manually, score against the 5 gold-set examples — 100% PASS required on `alarm_level`/`severity`), then Task 6 (extended validation on 15-20 more TEST stories), then Task 7 (PROD trigger + cutover, with the empirical legacy-exclusion check the plan calls for before enabling the schedule).
3. Before creating the PROD trigger in Task 7, also create the `ENABLE_LEGACY_STORY_ENRICHMENT` GitHub repo variable (currently doesn't exist) so the rollback path in the plan actually works if needed.
4. Continue to follow `docs/features/stories-claude-agent/plan.md` — it's the source of truth for Tasks 5-7's exact steps; don't re-plan.

# Handoff: Stories Claude Agent — PROD Cutover Progress (Migrations, Legacy-Exclusion Check, Model Switch)

**Date:** 2026-07-05
**Branch:** test (no code changes this session — ops/verification only)
**ADO:** 528 (Stories Claude Agent), state=Active. 529 (Clustering Quality Audit), state=Todo.

## What Was Done

This was a PROD-cutover verification session for ADO-528 Task 7. No code was changed — everything below was done via the Supabase SQL Editor (Josh), RemoteTrigger API calls, and read-only PostgREST checks against PROD.

### 1. Migrations 098 + 099 applied and confirmed on PROD

Josh ran both migrations in the PROD SQL Editor. Verified from this session (no PROD SQL access available) via a read-only trick: extracted the PROD anon key from `public/supabase-browser-config.js` (intentionally public, browser-facing config) and queried `stories_enrichment_log` via PostgREST. Got back `permission denied for table stories_enrichment_log` (Postgres error 42501) rather than a "table not found in schema cache" error — the former only happens when Postgres knows the table exists but RLS/grants block anon, which is exactly what 098 left in place (RLS enabled, no anon GRANT). This is now a reusable verification pattern (see `claude-agent-patterns` memory).

### 2. Legacy GPT enrichment confirmed OFF on PROD

`ENABLE_LEGACY_STORY_ENRICHMENT` was already set to `false` as a repo variable. The gate code (`scripts/rss-tracker-supabase.js:723`) only reached main via PR #103, merged 2026-07-03 18:58:17 -0500 (18:58 UTC) — **during this session**. The 17:15 UTC scheduled run that day predates the merge and ran the old ungated code (confirmed via `gh run view --log`: it logged `🤖 Enriching 50 stories...` and enriched 20 via the legacy path). The next scheduled run at 19:04 UTC, after the merge, correctly logged `ENABLE_LEGACY_STORY_ENRICHMENT: false` and `stories_enriched: 0`. No action needed — this resolved itself once the gate code landed; it isn't a live bug.

### 3. Legacy-exclusion check: PASSED across 3 manual trigger runs

Fired `trig_0182WcUVyjF7Q5o2GWJMxbo1` (PROD Stories agent, no cron yet) three times manually, with Josh's go-ahead before the first run. Baseline: snapshotted 10 known old GPT-enriched stories (IDs 3540, 3543, 3542, 1508, 1510, 1511, 1509, 1512, 1507, 1504, all last touched 2026-03-29) before firing.

Across the three runs, 13+ stories were enriched with `enrichment_meta->>source = 'claude-agent'` and `model: 'claude-sonnet-4-6'` (later switched — see below). All 10 baseline stories remained byte-identical to their pre-run snapshot after every run. The legacy-exclusion logic (`last_enriched_at IS NULL OR (source=claude-agent AND stale)`) is working correctly.

**Note on apparent "stalls":** early in the session, runs 1 and 2 looked like they stopped mid-batch (processed 3, then ~10, then no further movement for 20+ minutes). This was a false signal from my own monitoring query, which checked `last_enriched_at IS NULL` without the `article_story!inner(article_id)` join the agent's real Step 2 query uses — so it was counting orphan stories with no linked articles as "stuck candidates." Josh independently confirmed via the Console session transcript that both runs actually completed cleanly (`Run complete`, all log rows closed, zero failures). Corrected going forward — see the new gotcha in `claude-agent-patterns` memory.

### 4. Model switched: `claude-sonnet-4-6` → `claude-sonnet-5`

Checked current pricing via the `claude-api` skill: Sonnet 5 is $3/$15 per MTok standard, same as Sonnet 4.6, but currently $2/$10 per MTok under introductory pricing through 2026-08-31 — cheaper right now, same price after. Sonnet 5 is also positioned as reaching "near-Opus quality on agentic and coding work at Sonnet cost," a better fit for this one-story-at-a-time tool-use loop than 4.6. Josh confirmed Sonnet over Opus specifically because this isn't coding work — Opus's cost premium (5x) isn't justified for a job that will run 12x/day once the cron is on.

Applied via `RemoteTrigger action=update` on `trig_0182WcUVyjF7Q5o2GWJMxbo1`, resending the full `job_config.ccr` with `session_context.model` changed (partial/shallow merge on nested fields isn't guaranteed by the API, so the whole nested object was resent). Confirmed in the response: `"model":"claude-sonnet-5"`.

### 5. Backlog / jam-up analysis (real numbers, not a guess)

Josh asked whether ~10 stories per run indicated a growing jam. Checked directly:

- **Real backlog (properly filtered, matching the agent's actual Step 2 query): 67 candidates.**
  - ~14 are old pre-existing debris (IDs in the 279–549 range, headlines like "Concurrent article ...-wcjot" — leftover test/concurrency fixtures that predate this project and have never been enriched; unrelated to current pipeline health).
  - ~53 are real, and 50 of those (IDs 12118–12167) were created just on 2026-07-05.
- **Story creation rate: ~29/day** (~1.2/hour, roughly 2-3 new stories per 2-hour RSS clustering cycle).
- **Demonstrated per-run enrichment throughput: 3–10+ stories**, comfortably above the creation rate, without hitting the 40-candidate query cap.

Conclusion: once the recurring cron is on, each 2-hour firing only needs to clear ~2-3 new stories on average. The backlog should drain, not grow. The ~14 old debris rows are a separate, unrelated cleanup item.

## What Was NOT Done (deferred, explicitly, to next session)

Per Josh's direction at the end of this session, three items are queued for a **new session**, not this one:

1. **Enable the PROD cron schedule** (`30 */2 * * *` on `trig_0182WcUVyjF7Q5o2GWJMxbo1`) and reconfirm legacy GPT enrichment stays off. This is what closes ADO-528 AC6 and starts the 3-day monitoring window (plan.md Task 7 Step 4).
2. **Improve clustering logic** to reduce story fragmentation. ADO-529 (Todo) already exists for this — PROD currently clusters at only ~1.4 articles/story, meaning very little of the coverage for the same event actually merges into one story.
3. **Once clustering is better, re-run the improved clustering method on legacy/historical stories** — a retroactive backfill, not just apply-going-forward. This matters because it's the prerequisite for a future feature Josh described: an **"Important Stories Tracker"** that surfaces and tracks only the most significant ongoing story threads (his examples: Epstein, ICE) over time, instead of treating every clustered story equally. That feature isn't scoped yet and will likely need its own ticket once clustering quality is good enough to support it.

ADO-528 and ADO-529 both have comments added this session with this same context (see ADO for full detail — don't duplicate it here).

## Verification

- `gh run view <run-id> --log` on both the pre-merge (17:15 UTC) and post-merge (19:04 UTC) PROD RSS Tracker runs, confirming the kill-switch behavior change exactly at the PR #103 merge boundary.
- PostgREST queries via the PROD anon key (public, embedded in `public/supabase-browser-config.js`) for: table-existence proof (42501 vs schema-cache-miss), baseline story snapshots before/after each trigger run, and backlog/candidate counts matching the real Step 2 query shape.
- `RemoteTrigger action=get` on `trig_0182WcUVyjF7Q5o2GWJMxbo1` after the model-swap update, confirming `session_context.model: "claude-sonnet-5"` and `cron_expression: ""` (still off, as intended).

## Next Session Should

1. Enable the cron (`30 */2 * * *`) on `trig_0182WcUVyjF7Q5o2GWJMxbo1` and re-verify legacy GPT stays off on the next couple of scheduled runs.
2. Start the ADO-529 clustering diagnostic (AC1-AC4 already defined: sample review → root cause → recommendation → plan doc if a fix is warranted). Don't skip the diagnostic-first step — same discipline this project's own origin required.
3. Once a clustering fix is chosen and applied, scope and run a backfill re-cluster pass over legacy/historical stories using the improved method.
4. Keep the future "Important Stories Tracker" feature in mind as the reason for #2/#3, but don't start scoping it yet — it needs its own ticket once the clustering foundation is solid.

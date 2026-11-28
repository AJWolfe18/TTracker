# November 28, 2026: ADO-642, 644, 645 on TEST; Claude now runs Codex itself

## FIRST-UP for next session
1. **Ship 642/644/645 to PROD (needs Josh).** One commit on test: `d3dc210`. Order:
   1. Josh applies **migration 139** on PROD (SQL Editor, Run with RLS). Expect one row: claims_table 1, rls_on true, anon_can_select false, anon_can_claim false, service_can_claim true, service_can_finish true.
   2. Josh applies **migration 138** on PROD, between RSS runs (they start at :47 every 2 hours). Confirm the DROP INDEX prompt, Run with RLS. Expect side_rows = on_stories, spine_index true, old_index false, anon_can_call false, service_can_call true. Then `SELECT * FROM public.refresh_tracker_derived(50);` should show rows_changed about 0 and a small took_ms.
      - 137 was never applied on PROD. 138 replaces 137's function, so 137 can be skipped. 138's ROLLBACK note re-runs 137's function from the file.
   3. Deploy branch from `origin/main` in a worktree, cherry-pick `d3dc210` (plus `124d7d0` ADO-643 and `c1c6720` migration 137 if they go too; check `.claude/test-only-paths.md`), PR, merge.
   4. Deploy `admin-fronts` to PROD. Use the v2 CLI (path below), because v3 rejects `supabase/config.toml`.
   5. Verify (AC lists on the cards):
      - **642:** 0-row refresh well under 2 s on 6 PROD runs. Before: 5.6-6.9 s.
      - **642:** ANN timeouts per run before/after, also on ADO-635. Before: 15 in 9 runs.
      - **644:** `curl .../.netlify/functions/scotus-trigger` gives 403, and a workflow_dispatch SCOTUS run lands within 10 minutes of 19:47 UTC on 3 days in a row. The 21:47 cron run logs "skipping this backup run".
      - **645:** one `[daily-claim] ... claimed` per check per day, and later runs log `skipped`.
2. **642 AC 1 still owed:** PROD stories stats baseline (n_tup_upd, n_tup_hot_upd, n_dead_tup, index sizes). It's read-only SQL, but the auto-mode classifier blocked Claude from querying PROD with the CLI. Capture it BEFORE 138 goes to PROD, or the before-numbers are gone:
   ```sql
   select n_tup_upd, n_tup_hot_upd, n_dead_tup, n_live_tup,
     pg_size_pretty(pg_indexes_size('public.stories')) index_size,
     pg_size_pretty(pg_relation_size('public.stories')) heap_size
   from pg_stat_user_tables where relid = 'public.stories'::regclass;
   ```
3. **Proposed cards, not yet approved by Josh** (see "Findings" below).
4. Still open from earlier: Supabase Pro upgrade before the December 6 restriction (ADO-585); Josh's PROD admin checks (616, 547, 60, 343, 631, 525, 569, 495, 579); ADO-524, ADO-635; ADO-640/641 (admin into Vite, then per-tab /simplify).

## What was done
- **Where we left off:** the November 27 handoff was stale. A session after midnight had shipped ADO-639 to PROD (PR #203) and committed ADO-643 (`124d7d0`) and migration 137 (`c1c6720`). It also left 642/644/645 uncommitted, with no handoff or memory.
- **ADO-639 Closed:** AC 7 met. The first Netlify start ran on PROD at 13:23 UTC (run 46149354951) and all daily checks ran.
- **/simplify** on 642/644/645: 4 agents; net -8 lines (45 added, 53 removed, 11 files). Before/after `qa:smoke` logs were identical. Measured against a git-tree snapshot (`git write-tree` with a temp GIT_INDEX_FILE).
  - **Fixed:** a migration 138 comment that contradicted its grants; 139's verify query now uses `to_regclass`; the force env is set once per job; a duplicate call and duplicate override rule; an unused fetchImpl seam; a dead Array.isArray branch; `claimDailyCheck` made private; the prerequisite warning de-duplicated; test assertion tricks rewritten.
  - **Skipped on purpose:**
    - Replacing the SCOTUS guard with a daily claim. That would re-run fetch, fronts and the PROD refresh every day.
    - Moving the 14:00 UTC rule into JS. That needs about 15 time-dependent test rewrites.
    - The shared serviceClient, the lazy supabase-js import, and the ingest-health test harness.
- **Medium code review:** 1 real finding, fixed.
  - The SCOTUS guard counted only runs that concluded `success`. A run whose fetch worked but whose refresh/fronts step failed made the 21:47 cron fetch again and post the flag alert twice. It now counts any completed run whose fetch step succeeded, with new fake-gh test cases.
  - Also fixed a pre-existing bug: `alert-ingest-health.js` exited 0 when Discord rejected a problem alert.
  - Three minor findings accepted and listed in the Codex brief.
- **Codex:** clean (no P1-P3). Run by Claude through the Codex desktop app's bundled CLI (see below).
- **TEST:**
  - Migrations 137, 138 and 139 applied with the Supabase CLI. All EXPECT lines matched.
  - Refresh: 0-row call 13 ms (was 304 ms).
  - Flip test: one row changed, stories `n_tup_upd` unchanged (4,322).
  - EXPLAIN: Index Only Scan on idx_stories_tracker_spine, no sort.
  - Anon: homepage 60 rows in 0.28 s; anon refresh 42501.
  - admin-fronts deployed. `on_main_line` checked through PostgREST.
  - RSS Tracker TEST run 46177065025: green, refresh 154 ms.
- **ADO:**
  - 642, 644, 645 moved to Testing, with AC results on each card.
  - 643 moved to Testing: old pages now serve the React app on TEST.
- **Workflow change (Josh: "I prefer that"):** Claude runs Codex itself with `npm run codex:review -- <brief.md>` (`scripts/dev/codex-review.mjs`). Written into CLAUDE.md, start-work, end-work, validate, pr-workflow.md and AGENTS.md. PROD changes still wait for Josh.
  - The helper itself got a medium code review (fixed: stale or empty result passing as a review, relative paths via INIT_CWD, 20-minute timeout, signal messages, the brief must mention git status, the output path cannot be the brief) and three Codex passes, the last one clean. It ships to main on purpose: CLAUDE.md references it.

## Findings for later (not fixed; proposed cards)
- **`npm run verify:prod`** (Josh asked "are the tests actually useful?"): one automated after-deploy check that reads PROD run logs and anon counts and prints PASS/FAIL per shipped card. Pair it with trimming about 15 YAML-text regex asserts in `scotus-trigger.test.mjs` / `health-check-trigger.test.mjs`. $0. Claude recommended its own card.
- `supabase/config.toml` uses `[inbucket]`, which Supabase CLI v3 rejects ("use [local_smtp]"), so deploys need the v2 CLI. Small fix. (Fixed by ADO-648.)
- `public/supabase-browser-config.js` carries a TEST anon key that TEST now rejects ("Invalid API key"). This is part of the TEST JWT rotation item in memory; `src/lib/supabase.ts` has the working key.
- `docs/guides/features/rss-pipeline-operations.md` (last changed October 6, 2025) documents the retired job-queue pipeline and a nonexistent `job-queue-worker-atomic.js`.
- PROD RSS run 46099746883 (November 28, 02:47 UTC) logged no `refresh_tracker_derived` line. Not investigated.

## Gotchas
- **Codex CLI:**
  - Location: `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`. The hash changes on app updates; the helper picks the newest.
  - `codex review --uncommitted` cannot take custom instructions, so use `exec -s read-only`.
  - Its sandbox can't write temp dirs, so the PGlite and fake-gh test sections skip inside Codex.
- **Supabase CLI** isn't on PATH. Use the npx cache:
  - v3.0.0, for SQL: `%LOCALAPPDATA%\npm-cache\_npx\b96a6bd565c470ce\node_modules\@supabase\cli-windows-x64\bin\supabase.exe`, e.g. `db query --remote=<ref> --read-only "..."` or `--yes -f file.sql`.
  - v2.122.1, for `functions deploy`: `...\_npx\d308456e91a98c64\...`.
  - **Update (ADO-648):** `config.toml` now uses `[local_smtp]`, so v3 deploys too and v2 is no longer needed. Both versions load the config.
  - Hosted writes need `--yes` (agent mode). Josh's standing rule allows it on TEST only.
  - Auto mode blocks `--remote=osjbulmltfpcoldydexg` (PROD), even read-only.
- The claude.ai Supabase connector only sees WhiskeyPal Test, not TTracker.
- The Bash tool collapses `\\` in heredocs. Write JS containing regex backslashes with the Write/Edit tools.

## Afternoon update (PROD shipped, ADO-635 started)
- **FIRST-UP now:** ADO-635. `migrations/140_find_similar_stories_use_hnsw.sql` is drafted but **uncommitted and unreviewed**. Next: /simplify, code review, then `npm run codex:review`; then apply on TEST, then PROD (it only replaces one function, so any time). Then check ANN timeouts = 0 across 6 PROD runs. Root cause, PROD timings (21 s to 7 ms) and recall (99.8% top-60, 10/10 best match) are on the card.
- **PROD shipped (PR #204, cf86dfe, 19:30 UTC):**
  - Claude applied 139, 137 and 138 with the Supabase CLI on Josh's go. 138 verify: 4,490 = 4,490 rows.
  - The refresh dropped from 5.7 s to 60 ms.
  - admin-fronts deployed to PROD; all 3 Netlify triggers answer 403.
  - ADO-643 Closed. 642/644/645 stay in Testing until their PROD checks: refresh under 2 s on 6 runs, the SCOTUS dispatch near 19:47 UTC on 3 days, one daily-claim per day.
- **Deploy-branch gotchas:**
  - main tracks a few `node_modules` files, so the junction trick links packages one by one (PowerShell `New-Item -ItemType Junction`), then deletes only those junctions.
  - The social drafts (ADO-572) and the workflow-docs commit 7bffa5c stay test-only.
- **Proposed cards (not created; Josh to OK):**
  1. Move `centroid_embedding_v1` into its own table. Ordinary stories updates cost 0.4-0.7 s, about 11 hours in total, because each one inserts into the HNSW index.
  2. Supabase advisor housekeeping:
     - duplicate SELECT policies on `executive_orders` and `political_entries`;
     - `pending_submissions` RLS initplan;
     - 2 unindexed `story_event` foreign keys;
     - dead indexes `idx_stories_hash` and `ix_stories_lifecycle_state`.
  3. `find_similar_stories` is callable by anon.
  4. Plus the earlier four: verify:prod, config.toml `[inbucket]` (fixed by ADO-648), the stale ops guide, and the 02:47 run with no refresh line.

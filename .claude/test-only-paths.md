# Test-Only Paths

Files/folders in this list should NOT be cherry-picked to main/prod.
Check this file before creating deployment PRs.

## Migration Scripts (deleted after JIRA→ADO migration complete)
Migration scripts were deleted 2026-01-10. If similar one-time scripts are created, delete after use.

## Data Files (never commit)
- `scripts/*.json` - Temporary data exports

## Test Seed Scripts (test-only data)
- `scripts/seed-pardons-test.sql` - Pardons test data (ADO-241)

## One-Time Migration Helpers (delete after use)
- `scripts/apply-057-migration.js` - Migration check helper (ADO-253)
- `scripts/scotus/backfill-dissent-authors.js` - Dissent metadata backfill (ADO-394, one-time)
- `scripts/tests/ado-539-verdict-memory-fixture.sql` - TEST-only fixture proving migration 106's
  verdict memory (suppress / dry-run / reopen / unmerge-safety / heartbeat). Runs in a transaction
  that ROLLBACKs; never run against PROD.

## Manual Maintenance SQL (run by hand in SQL Editor, never deployed)
- `scripts/maintenance/2026-08-19-db-size-cleanup.sql` - DB size reclaim (embeddings/content on
  dead stories, log retention, VACUUM FULL). Josh runs it manually per environment; not code that ships.
- `scripts/maintenance/2026-08-22-ado-553-pardons-legacy-reset.sql` - one-time PROD reset of the
  25 backfilled pardons that legacy GPT enriched (null-fields-first so the Claude agent re-enriches).
  Josh runs it manually in the PROD SQL Editor; skip when cherry-picking ADO-553 to main.
- `scripts/maintenance/2026-08-23-ado-553-v1-rows-reset.sql` - one-time PROD reset of pardons
  119-123 (re-enriched under the stale v1.0 prompt before PR #126 synced v1.1 to main).
  Josh runs it manually in the PROD SQL Editor AFTER #126 merges; never deployed.
- `scripts/maintenance/2026-09-23-ado-590-2025-mixed-section-types.sql` - one-time PROD fix of the
  17 May 28-29, 2025 pardons the scraper stored as commutations (ADO-590 bug, older sections).
  Josh runs it manually in the PROD SQL Editor; skip when cherry-picking ADO-590 to main.
- `scripts/maintenance/2026-10-01-ado-493-delete-2020-bulk-import.sql` - one-time PROD delete of the
  1,220 flagged 2020 SCOTUS rows from the February 23, 2026 bulk import (guarded count; the 8 public
  2020 merits cases are left alone). Josh runs it manually in the PROD SQL Editor; never deployed.
- `scripts/maintenance/2026-10-01-ado-580-trump-v-california-dissenters.sql` - one-time PROD fix of
  case 26A124's dissenters (adds Kagan) and impact level 3 to 4 (keyed on the docket, guarded to 1 row). Josh runs it
  manually in the PROD SQL Editor; never deployed.
- `scripts/maintenance/2026-10-01-ado-580-scotus-2399-2099-reset.sql` - one-time PROD re-queue of
  SCOTUS 2099 and 2399 for the full-opinion re-run (ADO-580 AC 2). Josh runs it manually in the PROD
  SQL Editor AFTER PR #165 merges and migration 120 is applied; never deployed.
- `scripts/maintenance/2026-10-01-ado-592-agent-patterns.sql` - DRAFT `events.agent_pattern` for the
  7 non-election fronts, with a self-checking per-front UPDATE (a front is skipped with a NOTICE if a
  current member falls outside its pattern) and rollback. Not applied anywhere; run by hand on TEST, then PROD, as part of
  the ADO-592 build. If that build adds a test that reads this file, move this entry to "What DOES
  go to prod" (same reason as the ADO-582 file).
- `scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql` - new front "Hegseth's Pentagon"
  (events row with sweep and agent patterns, targeted sweep, refresh, rollback). Applied on TEST
  October 1, 2026; Josh pastes it in the PROD SQL Editor. Never deployed by code.
- `scripts/maintenance/2026-10-02-ado-595-new-fronts.sql` - ADO-595: Kushner's Deals widened to
  "The Envoys' Deals", new "Israel & Gaza" and "RFK Jr.'s HHS" fronts (guarded writes, targeted
  sweep, refresh, result, rollback). Applied on TEST October 2, 2026; Josh pastes it in the PROD SQL
  Editor AFTER the Hegseth file. Never deployed by code.

## Test-Only Frontend Tools
- `public/style-preview.html` - Style preview tool (test only)

## What DOES go to prod
- `.claude/skills/` - All skills work in both environments (commands were consolidated into skills 2026-08)
- `docs/handoffs/` - Documentation is fine everywhere
- `scripts/maintenance/2026-08-24-ado-554-prod-fronts-seed.sql` - record of the PROD fronts seed
  (8 fronts + keyword sweep) Josh ran by hand on August 24, 2026 (ADO-554/563). Already applied;
  never deployed. Keep for ADO-557 to reuse the sweep regexes.
- `scripts/maintenance/2026-09-08-ado-581-prod-fronts-backfill.sql` - ADO-581 PROD runbook (migration
  115 order, dry-run count, backfill sweep, three hand assignments, refresh). Run by hand in the PROD
  SQL Editor; never deployed. Migration 115 itself DOES ship.
- `scripts/maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql` - the current election
  `events.agent_pattern` + the self-checking PROD UPDATE and rollback (ADO-582). Run by hand; it
  MUST ship because `scripts/tests/front-agent-prompt.test.mjs` reads the pattern from it.

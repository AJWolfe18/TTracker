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

## Test-Only Frontend Tools
- `public/style-preview.html` - Style preview tool (test only)

## What DOES go to prod
- `.claude/skills/` - All skills work in both environments (commands were consolidated into skills 2026-08)
- `docs/handoffs/` - Documentation is fine everywhere

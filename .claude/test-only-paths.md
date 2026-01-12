# Test-Only Paths

Files/folders in this list should NOT be cherry-picked to main/prod.
Check this file before creating deployment PRs.

## Migration Scripts (deleted after JIRA→ADO migration complete)
Migration scripts were deleted 2026-01-10. If similar one-time scripts are created, delete after use.

## Data Files (never commit)
- `scripts/*.json` - Temporary data exports

## Test Seed Scripts (test-only data)
- `scripts/seed-pardons-test.sql` - Pardons test data (ADO-241)

## What DOES go to prod
- `.claude/skills/` - All skills work in both environments
- `.claude/commands/` - All commands work in both environments
- `docs/handoffs/` - Documentation is fine everywhere

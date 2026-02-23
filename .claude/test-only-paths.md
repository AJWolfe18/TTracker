# Test-Only Paths

Files/folders in this list should NOT be cherry-picked to main/prod.
Check this file before creating deployment PRs.

## Migration Scripts (one-time use)
- `scripts/compare-jira-ado.cjs` - JIRA/ADO comparison (keep for reference)
- `scripts/find-empty-descriptions.cjs`
- `scripts/split-batches.cjs`
- `scripts/ado-migration-executor.cjs`
- `scripts/create-migration-file.cjs`
- `scripts/find-missing-items.cjs`

## Data Files (never commit these)
- `scripts/*.json` - Migration data exports (large, temporary)

## Test-Only Frontend Tools
- `public/style-preview.html` - Style preview tool (test only)

## What DOES go to prod
- `.claude/skills/` - All skills work in both environments
- `.claude/commands/` - All commands work in both environments
- `docs/handoffs/` - Documentation is fine everywhere

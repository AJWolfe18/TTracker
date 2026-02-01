# 2026-01-28: ADO-309 QA Retry & Review Workflow

## Summary

ADO-309 complete: Implemented QA retry logic for fixable REJECT issues. When QA validators return REJECT with fixable issues, Pass 2 is retried once with fix directives injected. If still REJECT after retry, case is flagged for manual review (not hard blocked). Code pushed to test branch. **Migration 074 requires manual application via Supabase SQL Editor.**

## What Was Done

1. Added helper functions to `scotus-qa-validators.js`:
   - `hasFixableIssues(issues)` - checks if any issues have `fixable: true`
   - `buildQAFixDirectives(issues)` - builds prompt injection block with fix directives

2. Implemented QA retry loop in `enrich-scotus.js`:
   - Wraps Pass 2 + post-processing in `QA_RETRY_LOOP` (max 1 retry)
   - If REJECT + fixable → retry Pass 2 with fix directives injected
   - If still REJECT after retry → flag for manual review (qa_status='flagged')
   - If no fixable issues → flag directly (skip retry)
   - Early return on retry validation failure (code review fix)

3. Added `qa_retry_count` tracking:
   - New column in `scotus_cases` table (migration 074)
   - Added to `DB_COLUMNS` whitelist in `scotus-fact-extraction.js`
   - Persisted in `writeEnrichment()` and `flagAndSkip()`

## Migration Required

**IMPORTANT:** Migration must be applied manually to TEST database:
1. Go to Supabase TEST dashboard → SQL Editor
2. Paste contents of `migrations/074_scotus_qa_retry_count.sql`
3. Run SQL
4. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'scotus_cases' AND column_name = 'qa_retry_count'`

## Testing

After migration applied:
1. Find a case with enrichment issues, or manually trigger QA issues
2. Set `ENABLE_QA_GATE=true` environment variable
3. Run: `node scripts/scotus/enrich-scotus.js --limit=1`
4. Check logs for "QA Retry" messages
5. Verify `qa_retry_count` column is populated

## Commits

- `feat(ado-309): add QA retry logic for fixable REJECT issues`

## Files Changed

- `scripts/enrichment/scotus-qa-validators.js` (added helpers)
- `scripts/scotus/enrich-scotus.js` (QA retry loop)
- `scripts/enrichment/scotus-fact-extraction.js` (DB_COLUMNS + flagAndSkip)
- `migrations/074_scotus_qa_retry_count.sql` (new)

## Next Steps

1. Apply migration 074 to TEST database
2. Test with `ENABLE_QA_GATE=true` on a few cases
3. Monitor shadow mode results before enabling QA gate in production

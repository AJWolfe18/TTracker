# 2026-01-28: ADO-308 QA Schema & Pipeline Integration

## Summary

ADO-308 complete: Added QA columns to scotus_cases and integrated deterministic validators into enrichment pipeline with shadow mode support. Code pushed to test branch. **Migration requires manual application via Supabase SQL Editor.**

## What Was Done

1. Created `migrations/073_scotus_qa_columns.sql` - idempotent migration adding:
   - `qa_status` (pending_qa | approved | flagged | rejected | human_override)
   - `qa_verdict` (APPROVE | FLAG | REJECT)
   - `qa_issues` (JSONB array of detected issues)
   - `qa_reviewed_at`, `qa_review_note` (for human review workflow)
   - CHECK constraints and index for flagged case queries

2. Integrated validators into `enrich-scotus.js`:
   - Added import for `runDeterministicValidators`, `deriveVerdict`, `extractSourceExcerpt`
   - Added `ENABLE_QA_GATE` feature flag (env var, default false = shadow mode)
   - QA validation runs after Pass 2, before DB write
   - Shadow mode: logs verdict but doesn't change behavior
   - Enabled mode: REJECT blocks write, FLAG sets is_public=false

3. Updated `scotus-fact-extraction.js`:
   - Added qa_* columns to DB_COLUMNS whitelist
   - Updated `writeEnrichment()` to persist QA columns
   - Updated `flagAndSkip()` to accept QA fields for REJECT cases
   - Bumped prompt_version to 'v2-ado308'

4. Code review completed - fixed 3 critical issues:
   - Added QA columns to DB_COLUMNS whitelist (was silently dropping)
   - Updated flagAndSkip() to persist QA data on REJECT
   - JSONB serialization handled by Supabase client (verified)

## Migration Required

**IMPORTANT:** Migration must be applied manually to TEST database:
1. Go to Supabase TEST dashboard → SQL Editor
2. Paste contents of `migrations/073_scotus_qa_columns.sql`
3. Run SQL
4. Verify with: `SELECT column_name FROM information_schema.columns WHERE table_name = 'scotus_cases' AND column_name LIKE 'qa_%'`

## Testing

After migration applied:
1. Set a SCOTUS case to `enrichment_status = 'pending'`
2. Run: `node scripts/scotus/enrich-scotus.js --limit=1`
3. Verify: `SELECT id, qa_status, qa_verdict, qa_issues FROM scotus_cases WHERE id = <case_id>`
4. Expected: qa_status = 'approved' or 'flagged', qa_issues populated

## Commits

- `feat(ado-308): add QA schema and pipeline integration`

## Files Changed

- `migrations/073_scotus_qa_columns.sql` (new)
- `scripts/scotus/enrich-scotus.js` (modified)
- `scripts/enrichment/scotus-fact-extraction.js` (modified)

## Next Steps

1. **ADO-309**: Implement retry logic for REJECT cases with fixable issues
2. Verify shadow mode results after running enrichment
3. Decide when to enable QA gate (ENABLE_QA_GATE=true) based on shadow mode telemetry

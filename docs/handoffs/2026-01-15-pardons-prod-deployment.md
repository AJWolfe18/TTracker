# Handoff: Pardons PROD Deployment Complete

**Date:** 2026-01-15
**ADO:** Epic 109 (Pardons Tracker)
**Branch:** test → main (multiple PRs merged)

## Summary

Successfully deployed Pardons Tracker to PROD with full data pipeline execution.

## What Was Done

### 1. Schema Fix (Migration 061)
- Added composite unique constraint: `UNIQUE(recipient_slug, clemency_type, pardon_date)`
- Allows multiple clemency actions per recipient (e.g., commutation then pardon)
- Added `data_quality_flags TEXT[]` column for tracking review reasons

### 2. Seed Data Script Fixes
- Fixed `source_urls` column: changed from `ARRAY[]::TEXT[]` to `'[]'::jsonb`
- Removed duplicate records (Jan 6 manual, Ross Ulbricht manual)
- Removed ON CONFLICT clause for clean initial import
- Final count: 94 pardons

### 3. GitHub Workflow Fixes
- Fixed secret name: `SUPABASE_SERVICE_KEY` (not `SUPABASE_SERVICE_ROLE_KEY`)
- Both research and enrichment workflows now work on main branch
- Documented all GitHub secrets in CLAUDE.md

### 4. PRs Merged
- **PR #54:** PROD workflow support + migration 061 + deployment checklist
- **PR #55:** Secret name fix + secrets documentation

### 5. PROD Pipeline Execution
- Seed data: 94 pardons imported via SQL Editor
- Research pipeline: Completed (4m19s) - Perplexity
- Enrichment pipeline: Completed (3m10s) - GPT

## Files Changed

### Workflows
- `.github/workflows/research-pardons.yml` - PROD support + correct secret name
- `.github/workflows/enrich-pardons.yml` - PROD support + correct secret name

### Migrations
- `migrations/061_pardons_unique_action_constraint.sql` - New

### Scripts
- `scripts/generate-prod-seed.js` - Fixed JSONB, duplicates filter, no ON CONFLICT
- `scripts/prod-seed-pardons.sql` - Regenerated with fixes

### Documentation
- `CLAUDE.md` - Added GitHub Secrets table
- `docs/guides/prod-deployment-checklist.md` - New

## GitHub Secrets Reference (Now Documented)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | PROD Supabase URL |
| `SUPABASE_SERVICE_KEY` | PROD service role key |
| `SUPABASE_TEST_URL` | TEST Supabase URL |
| `SUPABASE_TEST_SERVICE_KEY` | TEST service role key |
| `OPENAI_API_KEY` | OpenAI (shared) |
| `PERPLEXITY_API_KEY` | Perplexity (shared) |

## Known Data Quality Issues (Backlog)

1. **Orgs as "person"**: HDR Global Trading Limited, Ozy Media Inc have `recipient_type = 'person'`
2. **Inconsistent district formatting**: Mix of "Southern Florida" vs "Southern District of Florida"
3. **Long slugs**: Jan 6 mass pardon has very long slug (works but ugly)

## Verification

- PROD site: https://trumpytracker.com/pardons.html
- 94 pardons should display with AI enrichment (summaries, corruption levels, etc.)

## Next Steps

1. Verify PROD site displays correctly
2. Optional: Fix org recipient_type in PROD
3. Consider scheduling regular pipeline runs (cron)

---
**Session tokens:** ~45K used

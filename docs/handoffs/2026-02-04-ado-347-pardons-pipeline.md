# ADO-347: Automate Pardons Pipeline - Handoff

**Status:** Testing
**Commit:** 3df8f39

## What Was Done
Created unified pardons pipeline workflow (`pardons-tracker.yml`) with 3 phases:
1. Phase 1: DOJ ingest (always runs)
2. Phase 2: Perplexity research (budget-gated)
3. Phase 3: GPT enrichment (budget-gated)

Also unified concurrency groups across all 3 pardons workflows to prevent race conditions.

## Files Changed
- **Created:** `.github/workflows/pardons-tracker.yml`
- **Modified:** `.github/workflows/research-pardons.yml` (concurrency group)
- **Modified:** `.github/workflows/enrich-pardons.yml` (concurrency group)

## Next Steps
1. **Test on test branch:** The workflow exists on `test` but GitHub won't index it until it's on `main`. Options:
   - Manually trigger via GitHub Actions UI (select test branch)
   - OR cherry-pick to main first, then test via dispatch
2. After successful test run, cherry-pick commit `3df8f39` to main
3. Create PR and merge to enable cron schedule
4. Verify cron runs for 2-3 days

## Follow-up Ticket
- **ADO-348:** Add Perplexity budget enforcement (parent: Epic 109)

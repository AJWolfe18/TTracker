# ADO-473 + ADO-482: Legacy Script Retirement

**Date:** 2026-04-21
**Tickets:** ADO-473 (SCOTUS), ADO-482 (EO), ADO-474 (closed), Epics 467/476
**PR:** https://github.com/AJWolfe18/TTracker/pull/89
**Commit:** `2c7572f` (main retirement) + `cdb31dc` (AC fix)

## What Was Done

Retired all GPT-4o-mini enrichment scripts replaced by Claude Code cloud agents.

**31 files deleted (15,944 lines):**
- 14 SCOTUS scripts (core enrichment + Scout subsystem + tests)
- 5 EO scripts (enrichment + debug + prompts)
- 5 eval system files (scotus-only, entire `scripts/evals/` emptied)
- 3 QA batch worker + test files
- 3 GitHub Actions workflows (enrich-scotus, test-executive-orders, qa-worker)
- 1 enrichment README

**8 files edited:**
- `executive-orders-tracker.yml` — removed stale enrichment comment block
- `lint-prod-refs.yml` — removed deleted file from allowlist
- `trigger-enrichment/index.ts` — removed scotus from WORKFLOW_CONFIG, COSTS, validTypes
- `prompts.js` — removed dead EO barrel re-export
- `opinion-utils.js` — removed stale "Used by" comment
- `reset-case-for-testing.js` — removed stale enrich-scotus.js reference (AC item)
- `docs/code-patterns.md` — removed deleted files from directory tree
- `docs/features/admin-features-guide.md` — noted retired workflow

## Code Review Findings

Two-pass review (feature-dev + superpowers) caught 9 additional files the plan missed:
1. `scripts/scotus/enrich-scotus.js` — main GPT enricher called by deleted workflow
2. `tests/scotus-scout-unit.test.js` — 86 tests importing from deleted scout modules
3. `scripts/qa/process-batch.js` — imported deleted QA modules, called by qa-worker.yml every 10 min
4. `.github/workflows/qa-worker.yml` — scheduled workflow calling deleted script
5. `scripts/evals/scotus-eval.js` — imported from deleted scotus-gpt-prompt.js
6. `scripts/evals/run-eval.js` — only supported scotus type, now dead
7. `scripts/evals/eval-types.js`, `shared-eval-utils.js`, `export-gold-review.js` — orphaned eval infra
8. `scripts/scotus/test-case-173-qa.mjs` — imported from deleted QA modules
9. `scripts/enrichment/README.md` — entirely about deleted EO worker

Also found and fixed: `trigger-enrichment/index.ts` validTypes still included `scotus` and `eo`.

## Verification

- QA smoke: 46/46 pass (ran twice — before and after review fixes)
- AC verification: all bullets MET for both 473 and 482
- No live code references remain to any deleted file

## Next Steps

1. **Merge PR #89** to main
2. **Redeploy trigger-enrichment** edge function to both TEST and PROD:
   ```bash
   supabase functions deploy trigger-enrichment --project-ref wnrjrywpcadwutfykflu  # TEST
   supabase functions deploy trigger-enrichment --project-ref osjbulmltfpcoldydexg  # PROD
   ```
3. **PROD→TEST data sync** for `executive_orders` + `scotus_cases` tables
4. **Verify** SCOTUS agent runs cleanly for 2 consecutive weekdays on PROD
5. **Close** ADO-473, 482, and Epics 467, 476

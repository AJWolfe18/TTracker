# 2026-01-27: ADO-306 SCOTUS QA System Planning

## Session Summary

Designed and documented a 2-phase QA system for SCOTUS enrichment. Phase 1 (deterministic validators) is ready to build. Phase 2 (AI QA agent) deferred until Phase 1 evaluation.

## ADO Cards Created

| Card | Title | State |
|------|-------|-------|
| ADO-306 | SCOTUS QA System (Feature) | New |
| ADO-307 | Layer A: Deterministic Validators | New |
| ADO-308 | QA Schema & Pipeline Integration | New |
| ADO-309 | QA Retry & Review Workflow | New |

## Key Decisions Locked

- **Retry:** REJECT → retry once if fixable → else FLAG
- **Max retries:** 1 (hard limit)
- **Feature flag:** `ENABLE_QA_GATE=false` default (shadow mode)
- **Phase 2 trigger:** Build Layer B only if Phase 1 miss rate >10%

## Plan Document

**Location:** `/docs/features/scotus-qa/plan.md`

Contains:
- Full architecture (Layer A + Layer B)
- All validator logic and word lists
- Complete implementation code for `scotus-qa-validators.js`
- Schema migration SQL
- Verdict derivation rules
- Retry logic
- Metrics to track

## Next Session: Start ADO-307

1. Read plan: `/docs/features/scotus-qa/plan.md`
2. Create `scripts/enrichment/scotus-qa-validators.js` (code is in plan)
3. Write unit tests for edge cases
4. Move ADO-307 to Active

## Files Created

- `docs/features/scotus-qa/plan.md` - Full implementation plan
- `docs/handoffs/2026-01-27-ado-306-scotus-qa-system.md` - This file

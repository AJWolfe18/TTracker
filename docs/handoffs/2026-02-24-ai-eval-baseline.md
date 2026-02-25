# 2026-02-24 — AI Eval Foundation + SCOTUS Baseline

## What Happened
Built the eval harness (`scripts/evals/`) and ran Session 1 baseline on 20 public SCOTUS cases in TEST. Gold set of 10 hand-verified cases created. All 11 dimensions (D1-D11) implemented — 3 LLM judge, 8 deterministic. Total LLM cost: $0.006.

## Key Baseline Metrics
- **Contradiction rate: 100%** (10/10 gold set cases have factual issues)
- issue_area null: 100%, evidence anchors all-generic: 95%, phantom dissent: 80%, severity 4-5: 70%
- Root causes: issue_area never in output schema, anchors are section labels not quotes, string "null" not normalized, no severity base-rate guidance

## Files Created
- `scripts/evals/{eval-types,shared-eval-utils,scotus-eval,run-eval}.js`
- `scripts/scotus/gold-set.json` (10 cases)
- `logs/evals/` (baseline output)
- `docs/features/ai-evals/plan.md` (durable reference)

## Next (Session 2)
Execute Phase 2 from the plan: prompt fixes in `scotus-gpt-prompt.js` + `scotus-fact-extraction.js` (severity calibration, tone differentiation, real quotes, dissent normalization, issue_area in Pass 1), then re-enrich gold set and re-eval. Target: blocking errors drop from 100% to <30%. See `docs/features/ai-evals/plan.md` for full details.

# TTRC-329 Shadow Policy Analysis Plan - Handoff

**Date:** 2025-12-22
**Branch:** test
**Status:** Plan ready, pending final fixes before implementation

---

## Summary

Created comprehensive plan for analyzing SHADOW_POLICY_DIFF logs to select optimal Tier B threshold. Plan went through 6+ review iterations with expert feedback.

---

## Plan Location

**Claude memory:** `C:\Users\Josh\.claude\plans\zazzy-plotting-pelican.md`

---

## What's Been Designed

### Scripts to Create
| Script | Purpose |
|--------|---------|
| `scripts/pull-shadow-policy-logs.sh` | Download logs from GH Actions |
| `scripts/analyze-shadow-policy.mjs` | Parse logs, stratified sampling, export TSV |
| `scripts/shadow-policy-report.mjs` | Read labeled TSV, calculate FP rates |

### Key Features Addressed
- String-aware JSON extraction (handles `{}` inside strings)
- Field aliasing for schema compatibility
- TSV output (avoids CSV quote escaping)
- Stratified sampling with budget enforcement (45 stratified + 15 baseline)
- Occurrence tracking during dedupe
- Report splits stats by sample_reason (stratified vs baseline)
- Global coverage from summary.json
- Statistical warnings for small n

---

## Remaining Fixes Before Implementation

### Must-Fix
1. **Real seeded Fisher-Yates shuffle** - Current shuffle is not uniform. Need mulberry32 PRNG + proper Fisher-Yates.

2. **Tolerant JSON extraction** - Current requires `{"type":` exactly. Should find `"type":"SHADOW_POLICY_DIFF"` then backtrack to `{`.

### Should-Fix
3. **Clarify "global coverage" label** - It's coverage among diffs, not all Tier B evaluations.

4. **Statistical upper bound warning** - Print "0 observed in n=60 → ~5% upper bound" to prevent false confidence.

---

## Shadow Logging Status

- Shadow logging deployed: commit `d6f206e`
- Logs `SHADOW_POLICY_DIFF` with multi-threshold results
- Missing: `commit_sha` field (first implementation step)
- Safety rule (title_only → 0.90) already applied in shadow_results

---

## Workflow After Implementation

```
1. Add commit_sha to hybrid-clustering.js
2. Wait 2-3 days for data collection
3. Pull logs: bash scripts/pull-shadow-policy-logs.sh
4. Analyze: node scripts/analyze-shadow-policy.mjs
5. Label 60 cases in Excel (fill 'label' column: S/A/D)
6. Report: node scripts/shadow-policy-report.mjs
7. Select threshold with 0 observed D FPs
8. Ship chosen threshold (separate commit)
```

---

## Files Reference

- Plan: `C:\Users\Josh\.claude\plans\zazzy-plotting-pelican.md`
- Shadow logging: `scripts/rss/hybrid-clustering.js` (lines 843-869)
- Original plan: `docs/plans/ttrc-329-shadow-policy-evaluation.md`

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-22-ttrc-329-analysis-plan.md
READ: C:\Users\Josh\.claude\plans\zazzy-plotting-pelican.md

## Context
TTRC-329 shadow policy analysis plan is ready with 2 remaining fixes:
1. Real seeded Fisher-Yates shuffle (mulberry32 PRNG)
2. Tolerant JSON extraction (backtrack to { from marker)

## Tasks
1. Apply final fixes to plan
2. Implement the 3 scripts
3. Add commit_sha to shadow logging
4. Create logs/shadow-policy/ directory (gitignore)
```

---

## User Feedback Pending

User mentioned they have additional feedback to share after compact.

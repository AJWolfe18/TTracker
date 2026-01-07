# TTRC-329 Shadow Policy Analysis Tooling - Complete

**Date:** 2025-12-22
**Branch:** test
**Commit:** db7b005
**Status:** Implemented - awaiting data collection

---

## Summary

Created tooling to pull, analyze, and label SHADOW_POLICY_DIFF logs to select optimal Tier B clustering threshold. Went through 8+ expert review iterations.

---

## What Was Implemented

### Files Created/Modified

| File | Purpose |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Added `commit_sha` to SHADOW_POLICY_DIFF log |
| `scripts/pull-shadow-policy-logs.sh` | Download logs from GH Actions (tolerant grep) |
| `scripts/analyze-shadow-policy.mjs` | Parse, stratify, sample 60 cases |
| `scripts/shadow-policy-report.mjs` | Generate threshold recommendation |

### Key Features

1. **Tolerant parsing:**
   - Grep uses `SHADOW_POLICY_DIFF` (handles spaces)
   - JSON extraction backtracks from marker to `{`

2. **Proper randomization:**
   - mulberry32 PRNG (uniform)
   - hashStringToSeed (FNV-1a)
   - Configurable via `SHADOW_SAMPLE_SEED` env var

3. **Stratified sampling:**
   - 45 risk-stratified (decision boundary, title-only, low embed, etc.)
   - 15 random baseline (unbiased)

4. **Per-threshold statistics:**
   - Upper bounds computed per-threshold (3/nAttach)
   - Not misleading global n

5. **Explicit decision rules:**
   - Baseline for rate estimation
   - Stratified to hunt worst-case FPs
   - Any D in stratified = reject threshold

---

## Workflow (After Data Collection)

```bash
# 1. Pull logs (after 2-3 days of RSS runs)
bash scripts/pull-shadow-policy-logs.sh

# 2. Analyze - creates risky-cases.tsv
node scripts/analyze-shadow-policy.mjs

# 3. Label in Excel
#    - Open risky-cases.tsv
#    - Fill 'label' column: S (same event) / A (same saga) / D (different)
#    - Save as risky-cases-labeled.tsv

# 4. Generate report
node scripts/shadow-policy-report.mjs
```

---

## Pending Actions

| Action | Who |
|--------|-----|
| Update JIRA TTRC-329 to "In Progress" | Manual (MCP unavailable) |
| Trigger RSS workflow to start data collection | Manual |
| Wait 2-3 days for data | - |
| Pull and analyze logs | Next session |

---

## Plan Location

Full implementation plan: `C:\Users\Josh\.claude\plans\zazzy-plotting-pelican.md`

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-22-ttrc-329-tooling-complete.md

## Context
TTRC-329 shadow policy tooling is deployed (commit db7b005).
Need to check if enough data has been collected.

## Tasks
1. Check if RSS workflow has been triggered recently
2. Pull shadow logs: bash scripts/pull-shadow-policy-logs.sh
3. If enough data (20+ unique diffs): run analysis
4. If not enough data: trigger RSS workflow, wait more

## AI Code Review
Check: bash scripts/check-code-review.sh
```

---

## Expert Feedback Incorporated

All 8 rounds of feedback addressed:
- Real seeded Fisher-Yates (mulberry32)
- Tolerant JSON extraction (backtrack to {)
- Tolerant grep (just the token)
- Per-threshold upper bounds (not global)
- Explicit decision rules
- Baseline reserve warnings
- Sampling budget enforcement (45+15)
- Data sufficiency gates

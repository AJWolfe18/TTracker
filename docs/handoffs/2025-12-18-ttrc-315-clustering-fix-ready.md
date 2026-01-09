# TTRC-315: Clustering Guardrail Fix - Ready for Implementation

**Date:** 2025-12-18
**Status:** Plan complete, ready for implementation
**Branch:** test

---

## Session Summary

| Task | Status |
|------|--------|
| TTRC-302 JIRA update | Done (transitioned to Done) |
| Clustering quality review | Done |
| Root cause diagnosis | Done (TTRC-311 guardrail too strict) |
| Solution design | Done (tiered guardrail) |
| Plan document | Created |

---

## What We Found

### Problem
Articles with 0.87-0.90 embedding similarity aren't clustering (only 2% multi-article rate).

### Root Cause
TTRC-311 guardrail requires "concrete reason" beyond embedding:
- Slug match fails (slugs too specific)
- Entity overlap fails (different focus)
- Title match fails (different phrasings)

### Evidence
Venezuela oil tanker: 3 articles, 0.87-0.90 embedding similarity, in 3 separate stories.

---

## Solution

**Tiered guardrail with slug token similarity:**

1. `embedding >= 0.90` → auto-pass (very high = concrete enough)
2. `embedding >= 0.85 + slug token overlap` → valid reason
3. Strict token overlap requirements:
   - overlapCount >= 2
   - overlapCoeff >= 0.60
   - Must include event word (SEIZE/INDICT/etc.)
   - Filter stop tokens (TRUMP, WHITE, HOUSE)
4. Merge reason logging for analysis

---

## Next Session Tasks

1. Create JIRA ticket TTRC-315 (or use existing)
2. Implement changes in:
   - `scripts/rss/scoring.js` - add slugTokenSimilarity()
   - `scripts/rss/hybrid-clustering.js` - update guardrail logic
3. Test on Venezuela articles (dry-run)
4. Recluster last 7-14 days
5. Measure results, tune if needed

---

## Key Files

- Plan: `docs/plans/ttrc-315-clustering-guardrail-fix.md`
- Implementation: `scripts/rss/scoring.js`, `scripts/rss/hybrid-clustering.js`

---

## JIRA Status

- **TTRC-302:** Done (topic slugs complete)
- **TTRC-315:** Create for this fix (or ask about existing ticket)

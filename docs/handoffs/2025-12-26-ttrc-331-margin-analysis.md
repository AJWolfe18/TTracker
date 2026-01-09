# TTRC-331 Session Handoff

**Date:** 2025-12-26
**Status:** Analysis complete, margin gate causing 21% fragmentation

---

## What We Did

1. Implemented TTRC-331 (Tier B margin bypass + logging)
2. Enabled bypass in TEST workflow (`ENABLE_TIERB_MARGIN_BYPASS=true`)
3. Analyzed 100 single-article stories for fragmentation

## Key Finding

**21% fragmentation rate** - 21+ unnecessary stories out of 100 analyzed.

| Event | Stories Created | Should Be | Extra Fragments |
|-------|----------------|-----------|-----------------|
| Nigeria Strikes | 7 | 1-2 | 5-6 |
| EU Visa Bans | 4 | 1 | 3 |
| Epstein Files | 14+ | 2-3 | 11+ |
| UK Researcher | 2 | 1 | 1 |
| ICE Tech | 2 | 1 | 1 |

## Root Cause

Margin gate (requires >= 0.04 gap between best and second match) blocks merges even when:
- Embed score is high (0.88-0.90)
- Title tokens match
- Time is recent

Current bypass only works for slug OR entity >= 2. Most fragments have **title_token only**.

## The Problem with Current Approach

1. **Entity count is meaningless** - "Trump" + "Congress" = 2 entities but appears in everything
2. **Title token is trusted for logging but not bypass** - inconsistent
3. **No evidence margin prevents bad merges** - only evidence it causes fragmentation

---

## Recommended Next Step

**Remove margin gate for Tier B entirely** when:
- embed >= 0.88
- time <= 48h
- title_token OR slug OR entity >= 1

Or simpler: just trust embed >= 0.88 + time <= 48h for Tier B.

## Files Changed This Session

- `scripts/rss/hybrid-clustering.js` - TTRC-331 implementation
- `.github/workflows/rss-tracker-test.yml` - enabled bypass flag

## Commits

- `39fbc60` - feat(clustering): TTRC-331 Tier B margin bypass + improved logging
- `f958745` - fix(clustering): TTRC-331 use snake_case for all new log fields
- `13a727e` - feat: enable Tier B margin bypass in TEST workflow

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-26-ttrc-331-margin-analysis.md

## Context
We analyzed 100 single-article stories and found 21% fragmentation.
Margin gate is the cause. Current bypass (slug OR entity>=2) doesn't help
because most fragments only have title_token corroboration.

## Task
Simplify Tier B: remove margin gate entirely when embed >= 0.88 and time <= 48h.
Trust the embedding score + title_token match.

## Key file
scripts/rss/hybrid-clustering.js (lines 690-760)
```

---

*Created: 2025-12-26*

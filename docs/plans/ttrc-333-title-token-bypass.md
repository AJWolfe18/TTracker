# TTRC-333: Tier B Title Token Margin Bypass

**Status:** IMPLEMENTED
**Date:** 2025-12-27
**JIRA:** TTRC-333

---

## Summary

Added `title_token` to Tier B margin bypass, allowing articles with shared meaningful title tokens to bypass the margin gate when embedding similarity is >= 0.88.

## Problem

title_token IS valid corroboration at line 756, but the Tier B margin gate blocked it before evaluation. This caused ~32 single-article stories that should have merged.

## Solution

Three edits to `scripts/rss/hybrid-clustering.js`:

1. **Line 709:** Added `title_token` to `wouldBypassVia` calculation
2. **Lines 729-731:** Added `title_token` bypass block
3. **Line 933-934:** Updated shadow policy threshold from 0.90 to 0.88

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Threshold | 0.88 | Same as slug/entity - simpler implementation |
| Feature flag | Same flag | All Tier B bypass behaviors controlled together |
| Token overlap | >= 1 | Meaningful-token filtering already robust |

## Safety Validation

- `titleTokenOverlap` uses meaningful-token filtering (5+ chars, stopwords excluded)
- Embedding threshold (0.88) provides safety net
- Pre-implementation check: 19 articles, zero wrong merges

## Rollback

- Immediate: `ENABLE_TIERB_MARGIN_BYPASS=false`
- Hard rollback: Revert this commit

## Expected Impact

~30% reduction in single-article story fragmentation for title-token-only cases (Epstein, EU visa, Venezuela, Nigeria, etc.)

---

*Implemented: 2025-12-27*

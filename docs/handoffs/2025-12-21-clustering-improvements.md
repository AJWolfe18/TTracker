# Clustering Improvements Session - 2025-12-21

**Date:** 2025-12-21
**Branch:** test

---

## Summary

Major clustering improvements session covering TTRC-321 bug fix, TTRC-324 margin bypass, TTRC-325/326 status updates, and JIRA cleanup.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `d4d6d3b` | TTRC-326: Add latest_article_published_at column |
| `5cdce3b` | AI code review fixes (security REVOKE, null guard, tertiary fallback) |
| `1e9af7a` | Nullish coalescing fix for getRunStats |
| `ec4e66f` | Fix candidate-generation.js: use first_seen_at not created_at |
| `c2eaf48` | Tier A margin bypass with corroboration |

---

## TTRC-326: latest_article_published_at

**Status:** Ready for Prod

Added `latest_article_published_at` column to stories table for accurate recency gating. Only updated when articles are attached (via atomic DB-side GREATEST), never on enrichment.

**Migrations:**
- 048: Column, backfill, index, atomic update RPC, find_similar_stories RPC
- 049: Security REVOKE PUBLIC execute

**Recency gating fallback chain:**
`latest_article_published_at` → `first_seen_at` → `last_updated_at`

---

## TTRC-321 Bug Fix

**Status:** Ready for Prod

Found and fixed bug: candidate-generation.js was selecting `created_at` but stories table uses `first_seen_at`. This caused errors in every run and prevented same-run detection from working.

Fixed all 3 select statements to use `first_seen_at`.

---

## TTRC-324: Margin Bypass

**Status:** In Review (needs validation)

Added Tier A margin bypass with corroboration. When margin < 0.04 but other Tier A gates pass, allow attach if:
- entityOverlap >= 1 OR
- slug_token.passes OR
- titleTokenOverlap >= 1 AND embedBest >= 0.905

This catches Epstein-class fragmentation where multiple candidates are about the SAME event.

**Logging:** `tierA_margin_bypass` field added to CROSS_RUN_OVERRIDE logs.

---

## JIRA Status Updates

| Ticket | Summary | Status |
|--------|---------|--------|
| TTRC-321 | Same-run high-embedding override | Ready for Prod |
| TTRC-324 | Two-tier cross-run override | In Review |
| TTRC-325 | Seed entity_counter with primary_actor | Ready for Prod |
| TTRC-326 | latest_article_published_at column | Ready for Prod |
| TTRC-327 | candidate-generation.js time filter | Backlog |

---

## Validated

- RSS workflow runs successfully
- `time_anchor: 'latest_article_published_at'` in logs
- No RPC failures
- CROSS_RUN_OVERRIDE firing correctly
- first_seen_at errors resolved

---

## Pending Validation

- Margin bypass (waiting for natural Epstein-class case)
  - Will show `tierA_margin_bypass: "title_token"` (or entity/slug) when triggered

---

## Next Steps

1. **TTRC-327**: Update candidate-generation.js time filter to use `latest_article_published_at`
2. **Monitor**: Watch for margin bypass events in logs
3. **PROD deployment**: 4 tickets ready (321, 325, 326, and 324 after validation)

---

## Files Modified

| File | Changes |
|------|---------|
| `migrations/048_add_latest_article_published_at.sql` | New column, RPC, backfill |
| `migrations/049_security_revoke_public_execute.sql` | Security fix |
| `scripts/rss/hybrid-clustering.js` | Recency gating, margin bypass, attachToStory RPC |
| `scripts/rss/candidate-generation.js` | first_seen_at fix |
| `scripts/rss-tracker-supabase.js` | Nullish coalescing fix |

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-21-clustering-improvements.md

Continue with TTRC-327: Update candidate-generation.js time filter
from last_updated_at to latest_article_published_at.

Also monitor for margin bypass events in RSS logs.
```

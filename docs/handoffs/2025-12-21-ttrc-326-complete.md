# TTRC-326: Add latest_article_published_at - Complete

**Date:** 2025-12-21
**Status:** Done (JIRA updated)
**Branch:** test

---

## What Was Implemented

### Problem Solved
Cross-run clustering override (TTRC-324) used `last_updated_at` as recency anchor, but:
- `last_updated_at` is touched on EVERY article attachment
- Enrichment/maintenance operations update it without new articles
- A story from 5 days ago that gets re-enriched looked "recent" to time gates

### Solution
Added `latest_article_published_at` column that ONLY updates when articles are attached (via atomic DB-side GREATEST), never on enrichment.

---

## Commits

| Commit | Description |
|--------|-------------|
| `d4d6d3b` | TTRC-326 implementation (migration 048, code changes) |
| `5cdce3b` | AI code review blocker fixes (security, null guard, tertiary fallback) |

---

## Files Modified

| File | Changes |
|------|---------|
| `migrations/048_add_latest_article_published_at.sql` | Column, backfill, index, atomic update RPC, find_similar_stories RPC |
| `migrations/049_security_revoke_public_execute.sql` | REVOKE PUBLIC execute on update RPC |
| `scripts/rss/hybrid-clustering.js` | createNewStory, attachToStory RPC call, recency gating fallback chain |
| `scripts/rss-tracker-supabase.js` | CLUSTERING_SUMMARY logging, null guard |

---

## Key Implementation Details

### Atomic Update RPC
```sql
CREATE OR REPLACE FUNCTION public.update_story_latest_article_published_at(
  p_story_id BIGINT,
  p_article_published_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stories
  SET latest_article_published_at = CASE
    WHEN p_article_published_at IS NULL THEN latest_article_published_at
    ELSE GREATEST(COALESCE(latest_article_published_at, p_article_published_at), p_article_published_at)
  END
  WHERE id = p_story_id
  RETURNING latest_article_published_at;
$$;
```

### Recency Gating Fallback Chain
```javascript
// Prefer latest_article_published_at → first_seen_at → last_updated_at (tertiary)
if (Number.isFinite(storyLatestArticle)) {
  storyTime = storyLatestArticle;
  timeAnchor = 'latest_article_published_at';
} else if (Number.isFinite(storyFirstSeen)) {
  storyTime = storyFirstSeen;
  timeAnchor = 'first_seen_at';
} else if (Number.isFinite(storyLastUpdated)) {
  storyTime = storyLastUpdated;
  timeAnchor = 'last_updated_at_fallback';
}
```

---

## Validation Results

### RSS Workflow (run 20417895768)
- **CROSS_RUN_OVERRIDE** logged with `time_anchor: 'latest_article_published_at'`
- **1 Tier A override** fired successfully using new time anchor
- **CLUSTERING_SUMMARY** shows no `latest_article_pub_rpc_fails` (0 failures)

### AI Code Review
- Initial commit had 3 blockers (security, null guard, NaN fallback)
- All 3 fixed in commit 5cdce3b
- Waiting for AI review of fix commit

---

## Outstanding Items

### Must Apply (User Action Required)
**Migration 049** via Supabase Dashboard:
```sql
REVOKE EXECUTE ON FUNCTION public.update_story_latest_article_published_at(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
```

### Next Session
1. Check AI code review for commit 5cdce3b (~5 min wait)
2. Apply migration 049 via Supabase Dashboard
3. Optionally trigger RSS workflow to verify after security fix

---

## Follow-up Tickets Created

| Ticket | Summary |
|--------|---------|
| TTRC-327 | Update candidate-generation.js to use latest_article_published_at |

---

## Design Decisions (Reference)

| Decision | Rationale |
|----------|-----------|
| Atomic RPC for updates | Avoids JS-side race conditions |
| service_role only | Update RPC is attack surface |
| Keep first_seen_at fallback | Safety net during rollout |
| Backfill from first_seen_at | v1 baseline (not truly latest article but acceptable) |
| null for missing published_at | Don't fake publication time |
| Tertiary last_updated_at fallback | Prevents NaN/Infinity for legacy rows |

---

## Next Session Prompt

```
READ: docs/handoffs/2025-12-21-ttrc-326-complete.md

## Task: Finalize TTRC-326

1. Check AI code review for commit 5cdce3b
2. Apply migration 049 via Supabase Dashboard (REVOKE security fix)
3. Consider: trigger RSS workflow to verify post-security-fix
4. If all good, TTRC-326 complete - move to TTRC-327 or other work
```

---

## Key Context

- Cloud ID: `f04decff-2283-43f1-8e60-008935b3d794`
- RSS workflow: `gh workflow run "RSS Tracker - TEST" --ref test`
- AI code review: `bash scripts/check-code-review.sh`

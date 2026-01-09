# Jira Cleanup - Post-PROD Deployment

**Date:** 2026-01-07
**Status:** COMPLETE

---

## Summary

Cleaned up Jira board after Jan 5-7 PROD deployment. Closed 78 tickets, kept 2 genuinely in-flight.

---

## What Was Done

### Tickets Closed (78 total)

| Status | Count | Action |
|--------|-------|--------|
| Ready for Prod | 61 | All closed - deployed to PROD |
| In Progress | 9 | Closed (kept TTRC-336) |
| Ready for Test | 8 | Closed (kept TTRC-359) |

### Tickets Kept Open (2)

| Ticket | Reason |
|--------|--------|
| **TTRC-336** | Same-run batch dedup in SHADOW MODE. Code deployed but needs `BATCH_DEDUP_SHADOW_MODE=false` to activate. Target: 50 more stories before going live. |
| **TTRC-359** | Content relevance filtering. Problem solved by Vox feed URL fix, kept open for future if junk resurfaces. |

### Tickets Verified Before Closing

| Ticket | Summary | Evidence |
|--------|---------|----------|
| TTRC-331 | Tier B Margin Bypass | Implemented Dec 26 (commit 39fbc60), deployed to PROD |
| TTRC-354 | Articles orphaned fix | Implemented Dec 31 (commit 1e468e1), deployed to PROD |
| TTRC-355 | Title Token Unification | Implemented Jan 3 (commit 844f91d), deployed to PROD |

---

## New Ticket Created

**TTRC-366** - Fix PROD Supabase Linter Security & Performance Issues (parent: TTRC-211)

Issues identified:
- 30 functions missing `search_path` (security)
- 3 extensions in public schema
- 10 overly permissive RLS policies
- 3 duplicate indexes
- 50+ unused indexes

---

## Notes

- Atlassian MCP connection unstable (disconnected 3x in <1 hour)
- Transition ID 41 = "Done" status
- Cloud ID: `f04decff-2283-43f1-8e60-008935b3d794`

---

## Resume Prompt

```
Jira cleanup complete. 78 tickets closed, 2 kept open.

Open tickets:
- TTRC-336: Batch dedup in shadow mode (needs flag flip after 50 stories)
- TTRC-359: Content filtering (parked for future)

New ticket: TTRC-366 for Supabase linter issues (security + performance)
```

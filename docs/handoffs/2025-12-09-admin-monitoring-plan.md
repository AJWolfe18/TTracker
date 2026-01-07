# Handoff: Admin Dashboard & Monitoring System Plan

**Date:** 2025-12-09
**Status:** Plan Complete, Ready for Implementation
**Plan File:** `C:\Users\Josh\.claude\plans\admin-dashboard-2.0-plan.md`

---

## Summary

Comprehensive plan created for admin dashboard (stories/articles/feeds) and monitoring dashboard (system health, costs, jobs).

## Key Decisions Made

- **Epics:** Keep separate - TTRC-18 (Admin) + TTRC-249 (Monitoring)
- **Auth:** GitHub PAT (current pattern)
- **No hard delete in v1** - only hide/archive
- **Re-enrichment in Phase 4** - AFTER monitoring exists (safety!)
- **Alerting:** Dashboard-only for now, no email/Slack

## Implementation Order

| Phase | Focus | Week |
|-------|-------|------|
| 1 | Story management (list/edit/hide/archive) + hidden columns | Week 1 |
| 2 | Monitoring dashboard (health/costs/feeds) | Week 2 |
| 3 | Article + Feed management | Week 3 |
| 4 | AI Re-enrichment (after monitoring!) | Week 4 |
| 5 | Polish (job queue panel, mobile, etc.) | Week 4+ |

## Files to Create

- `public/admin-stories.html` - Story/Article admin UI
- `public/admin-monitoring.html` - Health dashboard
- `migrations/040_admin_soft_delete.sql` - Hidden columns
- `supabase/functions/admin-enrich/index.ts` - Re-enrichment (Phase 4)
- `supabase/functions/admin-stats/index.ts` - Dashboard data

## Next Session Start

1. Read plan file: `C:\Users\Josh\.claude\plans\mossy-greeting-cocoa.md`
2. Create JIRA stories under TTRC-18 and TTRC-249
3. Start Phase 1: hidden column migration first
4. Then: admin-stories.html base layout

## Total Effort

- **46 story points** across 2 epics
- **4-5 weeks** estimated
- **$0** additional monthly cost

# Handoff: ADO-336/337 Testing Fixes

**Date:** 2026-02-06
**ADO:** #336 (Testing), #337 (Testing)
**Branch:** test
**Commits:** d4872a5, 560c75d, 900da63, c358360, 5e44be3

## What Was Done

1. **Migrations 081-083 applied to TEST** — admin schema, content_history, action_log, RPC functions
2. **GITHUB_PAT secret set** on Supabase TEST
3. **Grant undo_content_change to anon** — needed for client-side undo calls
4. **PR #74 merged to main** — enrich-story.yml workflow + enrich-single-story.js (required for workflow_dispatch API)
5. **Replaced severity with alarm_level** in admin-stories edge function and admin.html (spicy names now match public site)
6. **Fixed enrichment filter** — enriched filter now handles NULL enrichment_status correctly, pending filter catches re-enriching stories
7. **Default sort changed** to last_updated_at (matches public site ordering)
8. **Fixed enrich-single-story.js** — added missing enrichment_failure_count to select
9. **Improved error reporting** — re-enrich toast now extracts real error from edge function response

## Still Needs Testing

- [ ] Edit modal: open, edit headline, save, verify update
- [ ] Edit modal: validation (clear headline, invalid URL)
- [ ] Re-enrich button: click, verify spinner + toast + workflow triggers
- [ ] Undo toast: edit → save → undo within 10 seconds → verify revert
- [ ] Alarm level column shows spicy names correctly
- [ ] Stories order matches public site (active + enriched, sorted newest)
- [ ] content_history table logs changes after edit

## Known Issues

- enrichment_status doesn't get cleared after re-enrichment completes (enrich-stories-inline.js doesn't set it back to null) — low priority, filter handles it now
- stories-active edge function (public site) still queries `severity` field, not `alarm_level` — separate issue, not part of admin work

## After Testing Passes

1. Move ADO-336 and ADO-337 to Ready for Prod
2. Deploy to PROD: admin-update-story, trigger-enrichment, admin-stories, admin-stats edge functions
3. Apply migrations 081-083 to PROD
4. Add GITHUB_PAT + ADMIN_DASHBOARD_PASSWORD to PROD Supabase secrets
5. Cherry-pick commits to deployment branch, create PR to main

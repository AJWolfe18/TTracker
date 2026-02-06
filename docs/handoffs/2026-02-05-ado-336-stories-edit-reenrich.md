# Handoff: ADO-336 Edit Story Details + Re-enrich Story

**Date:** 2026-02-05
**ADO:** #336 (State: Testing)
**Branch:** test
**Commits:** eb5466c, e69bf60, d92a0a1

## Summary

Implemented Edit modal and Re-enrich button for Stories tab in Admin Dashboard. This completes the edit/re-enrich portion of Phase 2 (ADO-328).

## What Was Done

1. **trigger-enrichment edge function** - Triggers re-enrichment for stories (and other entity types)
2. **admin-update-story edge function** - Securely updates story fields with field whitelist validation
3. **Edit modal** - 9 editable fields with form validation
4. **Re-enrich button** - Shows spinner during request, toast on completion
5. **Toast notification system** - React Context-based toast for success/error feedback

## Edge Functions Deployed

✅ **Deployed to TEST** (2026-02-05):
- `trigger-enrichment` - 71.7kB
- `admin-update-story` - 71.73kB

Dashboard: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/functions

## Test Checklist (for Josh)

- [x] Deploy edge functions to TEST
- [ ] Open admin.html on test site
- [ ] Edit a story headline → Save → Verify it updated
- [ ] Click Re-enrich → Verify spinner + toast appears

## Next Up: ADO-337

**Content History & Undo Support** - adds undo capability after edits.
- Plan is complete in tech-spec.md (Sections 3.1, 3.2, 4.5, 6.1, 6.5)
- State: New (not started)

## After Testing ADO-336

1. If pass → Move ADO-336 to Ready for Prod
2. Start ADO-337 (Content History & Undo)

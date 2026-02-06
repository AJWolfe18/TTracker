# Handoff: ADO-336 Edit Story Details + Re-enrich Story

**Date:** 2026-02-05
**ADO:** #336 (State: Testing)
**Branch:** test
**Commit:** eb5466c

## Summary

Implemented Edit modal and Re-enrich button for Stories tab in Admin Dashboard. This completes Phase 2 of the Admin Dashboard epic (ADO-328).

## What Was Done

1. **trigger-enrichment edge function** - Triggers re-enrichment for stories (and other entity types in the future)
2. **admin-update-story edge function** - Securely updates story fields with field whitelist validation
3. **Edit modal** - 9 editable fields with form validation
4. **Re-enrich button** - Shows spinner during request, toast on completion
5. **Toast notification system** - React Context-based toast for success/error feedback

## Edge Functions Deployed

**Not yet deployed** - need to run:
```bash
supabase functions deploy trigger-enrichment --project-ref wnrjrywpcadwutfykflu
supabase functions deploy admin-update-story --project-ref wnrjrywpcadwutfykflu
```

## Test Checklist

- [ ] Deploy edge functions to TEST
- [ ] Open admin.html on test site
- [ ] Edit a story - verify all 9 fields save correctly
- [ ] Click Re-enrich - verify spinner shows, toast appears on completion
- [ ] Verify story shows "Pending" enrichment status after re-enrich
- [ ] Test error handling (invalid URL, budget exceeded simulation)

## Next Steps

1. Deploy edge functions to TEST
2. Verify on test site
3. Move ADO-336 to Ready for Prod
4. Cherry-pick to main for PROD deployment

# Handoff: ADO-336/337 Round 2 Bugfixes — Feb 7, 2026

## What happened
Code review found 16 issues total. Round 1 fixed 8 (Feb 6). Round 2 fixed the remaining 4 real issues plus 3 additional bugs caught during review and QA:

- **Enrichment polling**: 15s auto-refresh when stories are pending (toast on completion)
- **409 conflict handling**: Edit modal shows "Close & Refresh" button on stale data conflict
- **Re-enrich button**: Respects DB `enrichment_status=pending` (survives page refresh)
- **Server-side duplicate guard**: Atomic `UPDATE...WHERE neq pending` prevents double workflow dispatch
- **Admin defaults**: Now matches public site (active + enriched, sorted by recently updated)
- **Edit modal cleanup**: Removed lifecycle_state, confidence_score, summary_neutral (unused, lifecycle caused constraint error)
- **NULL fix**: `.neq()` excludes NULLs — used `.or('enrichment_status.is.null,enrichment_status.neq.pending')` for atomic check

Commits: `5c4806d` through `6999fb0` (5 commits). Edge function `trigger-enrichment` deployed to TEST.

## What needs QA
1. Trigger re-enrichment on a story → badge auto-updates after ~30-60s, toast appears
2. Edit a story with stale data → 409 shows "Close & Refresh" button
3. Refresh page while story is pending → button shows "Pending..." and is disabled
4. Double-click re-enrich → second attempt returns 409 (not a duplicate workflow)
5. Admin default view matches public site order (ICE/CBP story should be near top)

## ADO status
ADO-336/337 still in Testing. Move to Ready for Prod after QA passes.

## Next steps
- Manual QA on test site for the 5 items above
- If QA passes → cherry-pick to deployment branch → PR to main
- Check `.claude/test-only-paths.md` for any test-only files to skip

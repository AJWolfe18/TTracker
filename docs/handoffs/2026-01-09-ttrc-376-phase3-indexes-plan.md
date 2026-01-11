# Handoff: TTRC-376 Phase 3 - Drop Unused Indexes

**Date:** 2026-01-09
**Ticket:** TTRC-376
**Status:** PLANNED (not yet implemented)

---

## Summary

Created revised plan for dropping unused database indexes. Ready to implement next session.

---

## What Was Done This Session

1. Verified assumptions in original plan (`ttrc-376-phase3-unused-indexes.md`)
2. Found some indexes marked "safe" are actually in use:
   - Admin indexes (23 files reference them)
   - Deduplication indexes (used by clustering)
3. Created revised plan with verified safe list
4. User approved dropping dormant merge/split indexes

---

## Next Session: Pick Up Here

### Plan Location
```
C:\Users\Josh\.claude\plans\zazzy-whistling-popcorn.md
```

### Tasks to Execute
1. Create `migrations/053_add_fk_indexes.sql` (2 indexes)
2. Create `migrations/054_drop_unused_indexes.sql` (21 indexes)
3. Apply to TEST: `node scripts/apply-migrations.js`
4. Run QA: `npm run qa:smoke`
5. Trigger RSS tracker to verify no regressions
6. Cherry-pick to PROD via PR

### Quick Stats
- **Indexes to add:** 2 (FK indexes for openai_usage)
- **Indexes to drop:** 21 (job queue, geo, experimental, merge/split)
- **Risk level:** LOW

---

## Key Decision Made

User approved dropping merge/split feature indexes (7 total) since:
- Feature dormant since Oct 2025
- No GitHub workflow triggers it
- Can recreate if needed (rollback SQL in plan)

---

## Files to Reference

| File | Purpose |
|------|---------|
| `C:\Users\Josh\.claude\plans\zazzy-whistling-popcorn.md` | Full implementation plan |
| `C:\Users\Josh\.claude\plans\ttrc-376-phase3-unused-indexes.md` | Original plan (some assumptions incorrect) |

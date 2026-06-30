# Handoff: PROD Visibility Fix (SCOTUS + Pardons)

**Date:** 2026-06-29
**Session type:** Production issue investigation + fix

## What Happened

Josh asked to review items across SCOTUS, EOs, and Pardons that hadn't been "pushed to live." Investigation found:

### Root Cause: Missing anon GRANT (migration 046 pattern)
- Migration `046_security_lockdown.sql` does `REVOKE ALL ON ALL TABLES FROM anon` then re-grants SELECT to only 5 tables
- `ALTER DEFAULT PRIVILEGES` also auto-revokes anon on any NEW tables created after 046
- `scotus_cases` (migration 066) and `pardons` (migration 056) were created after 046 and never got their anon GRANT back
- Result: frontend queries via anon key returned empty/403 for both tables
- **Fix:** `GRANT SELECT ON public.scotus_cases TO anon` + `GRANT SELECT ON public.pardons TO anon` (applied directly on PROD by Josh)

### Secondary Fix: EO prompt description column (PR #101)
- EO agent prompt referenced `description` in SELECT list - column doesn't exist on PROD
- Agent silently failed and reported 0 unenriched EOs
- Fixed by removing `description` from the select, merged to main

### Also Merged: Agent batch size increase (PR #100)
- All three agent prompts changed from limit=5-10 to limit=20 per run
- Clears backlogs faster

## PROD State After Fix

| Domain | Published | Unpublished | Notes |
|--------|-----------|-------------|-------|
| SCOTUS | 186 (v1.1) | 818 null + 433 old GPT | Agent working, auto-publishing correctly |
| EOs | 263 (v1.1) | 0 | Fully clean |
| Pardons | 112 (67 v1 + 44 null + 1 locked) | 6 (needs_review=true) | Review gate working correctly |

## Critical Lesson Learned

**The local .env `SUPABASE_URL` points to TEST, not PROD.** Wasted significant time querying/modifying TEST data thinking it was PROD. The cloud agents connect to PROD via their environment variables. Always verify: `grep -o '[a-z]*\.supabase' .env` before any data operations.

## Next Session
1. Review 6 flagged pardons (Bell, Sittenfeld, Sotelo x2, Hinshaw, Smith)
2. Create a migration to codify the GRANT (prevent regression if 046 re-runs)
3. Consider updating 046's allowlist to include scotus_cases + pardons
4. Verify SCOTUS and pardons are actually rendering on trumpytracker.com

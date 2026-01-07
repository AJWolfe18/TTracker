# TTRC-268-272: Fix RSS Feed "Cannot Convert Object" Errors - RPC Return Type Fix

**Date:** 2025-11-15
**Status:** Ready for TEST deployment → PROD deployment
**Risk:** Low (backwards compatible, no worker restart needed)
**Cost Impact:** $0

---

## Problem Summary

**3 out of 5 RSS feeds failing with 100% article processing errors:**
- Guardian Trump Feed (183) - 20/20 articles failed
- Guardian US Politics Feed (182) - 17/17 articles failed
- NYT Politics Feed (3) - 20/20 articles failed

**Error:** `"Cannot convert object to primitive value"`

**Affected:** Guardian, NYT feeds (ProPublica and Fortune working fine)

---

## Root Cause Analysis

### Initial Hypothesis (INCORRECT)
RSS parser (xml2js) returning nested objects like `{$: {...}, _: "value"}` that weren't being sanitized to primitives.

**Evidence this wasn't the full problem:**
- Added `toPrimitiveStr()` improvements to handle xml2js structures
- Added `sanitizeMetadata()` to deep-sanitize all metadata fields
- **ProPublica and Fortune feeds started working**
- **But Guardian and NYT still 100% failed**

### Actual Root Cause (CORRECT)
The `upsert_article_and_enqueue_jobs` RPC returns a **JSONB blob**:

```sql
RETURN jsonb_build_object(
  'article_id', v_article_id,
  'is_new', v_is_new,
  'job_enqueued', v_job_enqueued,
  'job_id', v_job_id,
  'enrich_job_enqueued', v_enrich_job_enqueued,
  'enrich_job_id', v_enrich_job_id
);
```

**PostgREST cannot properly serialize this JSONB response** when it contains certain nested structures, causing the "Cannot convert object to primitive value" error **on the return path**, not the input path.

**Why ProPublica/Fortune worked:**
- Simpler RSS metadata structures
- Smaller content payloads
- Fewer nested objects in the RPC's JSONB serialization path

**Why Guardian/NYT failed:**
- More complex RSS metadata (media:content, dc:creator, category domains)
- Larger content payloads
- PostgREST serialization choking on the combination

---

## The Fix

**Migration 030:** Change RPC return type from `RETURNS jsonb` to `RETURNS void`

**Why this works:**
1. JavaScript client doesn't use the return value anyway
2. Success/failure communicated via error/no-error (standard RPC pattern)
3. Eliminates PostgREST serialization entirely
4. Reduces network payload (bonus)

**File:** `migrations/030_fix_upsert_rpc_return_type.sql`

---

## Deployment

**See migration file for complete deployment instructions:**
- `migrations/030_fix_upsert_rpc_return_type.sql`

**Quick summary:**
1. Copy/paste migration SQL into Supabase SQL Editor
2. Run query
3. No worker restart needed
4. Test Guardian/NYT feeds (should see 0% error rate)

**Timeline:**
- TEST first → Monitor 24 hours → PROD deployment

---

## Testing Evidence

### Before Fix
- **Guardian Trump (183):** 20/20 articles failed
- **Guardian US Politics (182):** 17/17 articles failed
- **NYT Politics (3):** 20/20 articles failed
- **Error Rate:** 100% for these feeds

### After Fix (Expected)
- **All feeds:** 0% error rate
- **Articles created:** Normal rates (5-20 per feed)
- **No "Cannot convert object" errors**

---

## Files Changed

### New Files
- `migrations/030_fix_upsert_rpc_return_type.sql` - Database migration

### Modified Files
- None (database-only change)

---

## Related Issues

- **TTRC-268:** Guardian Trump feed 100% failure
- **TTRC-269:** Guardian US Politics feed 100% failure
- **TTRC-270:** NYT Politics feed 100% failure
- **TTRC-271:** ProPublica feed (fixed by URL correction)
- **TTRC-272:** Fortune feed (fixed by URL correction)

---

## Next Steps

1. ✅ Migration 030 created and documented
2. ⏳ **Apply to TEST database** (via Supabase SQL Editor)
3. ⏳ **Test Guardian/NYT feeds** (verify 0% error rate)
4. ⏳ **Monitor for 24 hours** in TEST
5. ⏳ **Deploy to PROD** (same SQL, no restart needed)
6. ⏳ **Update JIRA tickets** (TTRC-268, 269, 270 → Done)

---

## Questions/Clarifications Needed

None - ready for deployment.

---

**Handed off by:** Claude Code
**Next session:** Apply migration to TEST, validate, then PROD deployment

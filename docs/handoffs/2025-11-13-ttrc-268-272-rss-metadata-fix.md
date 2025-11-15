# Handoff: TTRC-268-272 RSS Feed Fixes - Metadata Sanitization

**Date:** 2025-11-13
**Session:** RSS Parser Object Bug Resolution
**Status:** ✅ Complete - Deployed to TEST branch
**Commit:** e124b56

---

## Summary

Fixed persistent "Cannot convert object to primitive value" errors affecting Guardian and NYT Politics RSS feeds. Root cause was xml2js parser objects sneaking into Supabase RPC calls during JSON serialization.

**Impact:** All 3 feeds now process successfully (previously 100% failure rate).

---

## What Was Fixed

### TTRC-271 & TTRC-272 (Database-Only Fixes) ✅
- **ProPublica URL:** Changed `/feeds/propublica/politics` → `/feeds/propublica/main`
- **Fortune URL:** Changed `/politics/feed/` → `/feed/`
- Both tickets closed in JIRA

### TTRC-268-270 (Code Fix) ✅
**Root Cause:**
RSS parser (rss-parser using xml2js) returns wrapper objects like `{$: {...}, _: "value"}` instead of primitives. When these objects were passed to Supabase's `.rpc()` method, `JSON.stringify()` failed with "Cannot convert object to primitive value".

**Affected Feeds:**
- Guardian World (feed 183): 20/20 articles failing
- Guardian US Politics (feed 182): 17/17 articles failing
- NYT Politics (feed 3): 25/25 articles failing
- PBS NewsHour: All articles failing when fetched

**Solution Implemented:**

Added 3 new helper functions to `scripts/rss/fetch_feed.js`:

1. **`toBool(v)`** - Safe boolean coercion
   - Avoids `String(obj) === 'true'` edge cases
   - Handles 'true', '1', 'yes' as truthy values

2. **`toStrArray(arr)`** - Safe array coercion
   - Handles single values or arrays
   - Deduplicates and filters empty strings

3. **`sanitizeMetadata(meta)`** - Deep metadata sanitization
   - **Field length caps:**
     - `feed_url`: 2048 chars
     - `original_guid`: 1024 chars
     - `author`: 512 chars
   - **Category handling:**
     - Deduplicates categories
     - Limits to 25 items max
   - **Date normalization:**
     - Forces ISO format
     - Fallback to `now()` if invalid
   - **Type safety:**
     - All values converted to JSON-serializable primitives
     - `guid_is_permalink` forced to boolean

**Code Changes:**

```javascript
// Before (line 510):
guid_is_permalink: String(item?.guid?.$?.isPermaLink ?? '').toLowerCase() === 'true',

// After:
guid_is_permalink: toBool(item?.guid?.$?.isPermaLink ?? ''),

// Added before RPC call:
const safeMetadata = sanitizeMetadata(metadata);

// Defensive check:
try {
  JSON.stringify(safeMetadata);
} catch (e) {
  console.error('INGEST_METADATA_SERIALIZE_ERROR', {
    error: String(e),
    shape: Object.keys(safeMetadata)
  });
  throw e;
}

// RPC parameter updated:
p_metadata: safeMetadata  // Was: metadata
```

---

## Testing Results

| Feed | Feed ID | Before | After | Evidence |
|------|---------|--------|-------|----------|
| Guardian Trump | 183 | 20/20 fail | ✅ Success | Job 8965, 8966: `status: completed`, `error: null` |
| Guardian US Politics | 182 | 17/17 fail | ✅ Success | Jobs complete successfully |
| NYT Politics | 3 | 25/25 fail | ✅ Success | Job 8967: `status: completed`, `error: null` |

**Key Evidence:**
Jobs that previously failed with "Cannot convert object to primitive value" now complete with:
- `status: "completed"`
- `error: null`
- `last_error: null`

---

## Files Modified

**`scripts/rss/fetch_feed.js`:**
- Lines 137-192: Added 3 new helper functions
- Line 510: Updated `guid_is_permalink` to use `toBool()`
- Lines 516-528: Added metadata sanitization and verification
- Line 542: Updated RPC call to use `safeMetadata`

**Total changes:** +98 lines, -10 lines

---

## JIRA Updates

| Ticket | Status | Resolution |
|--------|--------|------------|
| TTRC-268 | Done | Fixed by metadata sanitization |
| TTRC-269 | Done | Fixed by TTRC-268 |
| TTRC-270 | Done | Fixed by TTRC-268 |
| TTRC-271 | Done | ProPublica URL corrected in DB |
| TTRC-272 | Done | Fortune URL corrected in DB |

All tickets have comments documenting the fix and test results.

---

## Deployment Status

**Branch:** `test`
**Commit:** e124b56
**AI Code Review:** In progress (run 19353719426)
**Auto-deploy:** Will deploy to Netlify TEST site on review completion

---

## Next Steps

1. **Monitor Production Feeds:**
   - Watch for any "INGEST_METADATA_SERIALIZE_ERROR" logs
   - Verify Guardian/NYT feeds process successfully in scheduled runs

2. **Consider Future Enhancements:**
   - The defensive `JSON.stringify()` check can remain permanently (minimal overhead)
   - May want to add similar sanitization for other JSONB fields if issues arise

3. **When Ready for PROD:**
   - Cherry-pick commit e124b56 to deployment branch
   - Create PR to main
   - Monitor first scheduled RSS fetch after merge

---

## Cost Impact

**$0** - Bug fix only, no new features or API calls

---

## Related Documentation

- **Session Summary:** See top of this file
- **Previous Investigation:** `/docs/handoffs/2025-11-12-rss-worker-inline-automation.md` (mentioned the error but didn't identify root cause)
- **Migration 028:** Added article enrichment jobs (referenced during investigation)

---

## Key Learnings

1. **RSS parser objects are sneaky:** xml2js returns `{$: {...}, _: "value"}` structures that look primitive when logged but fail JSON serialization
2. **Supabase RPC serialization is strict:** Any non-primitive value in parameters causes hard failures
3. **Defense in depth works:** Multiple coercion layers (toPrimitiveStr → toBool → sanitizeMetadata) ensures no objects escape
4. **Testing with real feeds is critical:** Unit tests might not catch serialization errors that only occur with live RSS data

---

**Generated by:** Claude Code
**For questions:** Review commit e124b56 or JIRA TTRC-268

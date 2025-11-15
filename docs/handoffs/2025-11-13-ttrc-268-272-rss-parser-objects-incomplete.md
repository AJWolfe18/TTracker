# Handoff: TTRC-268-272 RSS Feed Fixes (INCOMPLETE)

**Date:** 2025-11-13
**Status:** 🚨 **PARTIALLY COMPLETE - CRITICAL BUG REMAINS**
**Branch:** `test`
**Tickets:** TTRC-268, TTRC-269, TTRC-270, TTRC-271, TTRC-272

---

## Executive Summary

Attempted to fix RSS parser object bugs causing "Cannot convert object to primitive value" errors across 5 feeds (Guardian x2, NYT Politics, PBS NewsHour, ProPublica, Fortune).

**✅ COMPLETED:**
- Fixed ProPublica & Fortune feed URLs (database fixes)
- Added 5 safe coercion helper functions to handle RSS parser objects
- Applied coercion to most extraction fields

**🚨 CRITICAL ISSUE UNRESOLVED:**
- Errors **PERSIST** on Guardian/NYT/PBS feeds despite all fixes
- 100% failure rate on these feeds when articles are processed
- Root cause: **Unidentified field still passing RSS parser objects to PostgreSQL**

---

## What Was Fixed

### 1. Database Fixes (COMPLETE)

**TTRC-271 - ProPublica Feed:**
```sql
UPDATE feed_registry
SET url = 'https://www.propublica.org/feeds/propublica/main'
WHERE id = 177;
```
- Old URL: `/feeds/propublica/politics` (404)
- New URL: `/feeds/propublica/main` (works)
- **Status:** ✅ Feed operational

**TTRC-272 - Fortune Feed:**
```sql
UPDATE feed_registry
SET url = 'https://fortune.com/feed/'
WHERE id = 188;
```
- Old URL: `/politics/feed/` (404)
- New URL: `/feed/` (works)
- **Status:** ✅ Feed operational

### 2. Code Fixes (INCOMPLETE)

**File:** `scripts/rss/fetch_feed.js`

**Added 5 Safe Coercion Functions:**

```javascript
// 1. Core primitive converter
function toPrimitiveStr(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return toPrimitiveStr(v[0]);
  if (typeof v === 'object') {
    if ('_' in v) return toPrimitiveStr(v._);    // xml2js node text
    if ('#' in v) return toPrimitiveStr(v['#']); // alternative format
    return null;                                  // avoid "[object Object]"
  }
  const s = String(v);
  const trimmed = s.trim();
  return trimmed.length ? trimmed : null;
}

// 2. Author extraction
function safeAuthor(item) {
  const a =
    toPrimitiveStr(item.creator) ??
    toPrimitiveStr(item['dc:creator']) ??
    toPrimitiveStr(item.author) ??
    toPrimitiveStr(item.contributor);
  return a ? he.decode(a) : null;
}

// 3. GUID extraction
function safeGuid(item) {
  const rawGuid = toPrimitiveStr(item.guid) ?? toPrimitiveStr(item.id);
  const link = toPrimitiveStr(item.link);
  const guidIsPermalink = String(item?.guid?.$?.isPermaLink ?? '')
    .toLowerCase() === 'true';
  const chosen = rawGuid || (guidIsPermalink ? link : null) || link;
  return chosen ? he.decode(chosen).slice(0, 512) : null;
}

// 4. Categories extraction
function safeCategories(item) {
  const cats = item.categories || item.category || [];
  const arr = Array.isArray(cats) ? cats : [cats];
  const out = Array.from(
    new Set(
      arr
        .map(toPrimitiveStr)
        .filter(Boolean)
        .map(s => he.decode(s).slice(0, 128))
    )
  );
  return out.slice(0, 25);
}

// 5. Published date normalization (handles objects + clock skew)
function normalizePublishedAt(item) {
  const raw =
    toPrimitiveStr(item.isoDate) ??
    toPrimitiveStr(item.pubDate) ??
    null;

  if (!raw) return new Date().toISOString();

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();

  // Guard against future-dated feeds (clock skew)
  const now = Date.now();
  const ts = d.getTime();
  return new Date(Math.min(ts, now + 5 * 60 * 1000)).toISOString();
}
```

**Applied Coercion To:**
- Line 408: `articleUrl = toPrimitiveStr(item.link) || toPrimitiveStr(item.guid)`
- Line 409: `title = toPrimitiveStr(item.title) || '(untitled)'`
- Line 416: `publishedAt = normalizePublishedAt(item)`
- Lines 424-427: Content extraction (`item.contentEncoded`, `item.description`, `item.summary`)
- Lines 433-439: Metadata object (`author`, `guid`, `categories`)

---

## 🚨 UNRESOLVED CRITICAL BUG

### Error Symptoms

**Error Message:**
```
Cannot convert object to primitive value
```

**Affected Feeds:**
- Guardian Donald Trump feed (183): 20/20 articles fail
- Guardian US Politics feed (182): 17/17 articles fail
- NYT Politics feed (3): 25/25 articles fail
- PBS NewsHour Politics (176): 20/20 articles fail (when fetched)

**Failure Rate:** 100% of articles in affected feeds

### What We Tested

✅ **Already Coerced (NOT the problem):**
- `item.link` → Used `toPrimitiveStr()`
- `item.guid` → Used `toPrimitiveStr()`
- `item.title` → Used `toPrimitiveStr()`
- `item.isoDate` / `item.pubDate` → Used `normalizePublishedAt()`
- `item.contentEncoded` / `item.description` / `item.summary` → Used `toPrimitiveStr()`
- `item.author` / `item.creator` → Used `safeAuthor()`
- `item.categories` → Used `safeCategories()`

❌ **Root Cause Unknown:**
The error happens **during `processArticleItemAtomic()`** but AFTER all our coercion logic. This suggests:
1. There's another field we haven't identified yet
2. The RPC call to PostgreSQL (`upsert_article_and_enqueue_jobs`) is receiving an object somewhere
3. It could be in a field we haven't looked at (e.g., `item.enclosure`, `item.media`, etc.)

### Evidence

**Test Results:**
1. Worker restarted 3 times with progressively more coercion
2. Errors persist identically after each fix
3. PBS NewsHour returns 304 "not modified" (cached) → NO errors
4. When PBS feed DOES fetch fresh articles → 20/20 errors

**🚨 CRITICAL CONFIRMATION (2025-11-14 03:22 UTC):**
After implementing `normalizePublishedAt()` for date field handling and restarting the worker:
- **NYT Politics:** 25/25 articles STILL failed
- **Guardian (feed 183):** 20/20 articles STILL failed
- **PBS NewsHour:** 20/20 articles STILL failed
- **Guardian US Politics (feed 182):** 17/17 articles STILL failed

**Proof:** Date fields (isoDate/pubDate) are **NOT** the root cause. The problematic field is elsewhere.

**Conclusion:** The bug is triggered when RSS **content changes** and articles are **actually processed**. Date coercion did NOT fix the issue.

---

## Next Steps (URGENT)

### Immediate Actions Needed

1. **Add Debug Logging** to capture failing article structure:
   ```javascript
   // Add before RPC call in processArticleItemAtomic()
   console.log('DEBUG - Full item:', JSON.stringify(item, null, 2));
   console.log('DEBUG - Metadata:', JSON.stringify(metadata, null, 2));
   ```

2. **Test Single Article Manually:**
   - Fetch ONE Guardian article RSS item
   - Log EVERY field in the item object
   - Identify which field contains the problematic object

3. **Check RPC Function:**
   - Review `upsert_article_and_enqueue_jobs` PostgreSQL function
   - Verify it's not trying to access raw item fields

4. **Check for Missed Fields:**
   - `item.enclosure` (media attachments)
   - `item['media:content']` (media RSS namespace)
   - `item['dc:*']` (Dublin Core metadata)
   - Any other custom fields from rss-parser

### Investigation Questions

1. **What field is causing the error?**
   - Add comprehensive logging to find it

2. **Is it in the metadata object?**
   - The metadata is passed as JSONB - could PostgreSQL be failing to serialize it?

3. **Is it in a field we're NOT extracting?**
   - Check if there are additional RSS fields being accessed somewhere

---

## Files Changed

### Modified
- `scripts/rss/fetch_feed.js` (+86 lines)
  - Added 5 coercion helper functions
  - Updated article extraction logic

### Database Updates
- `feed_registry` table: Updated ProPublica and Fortune URLs

---

## Git Status

**Branch:** `test`
**Last Commit:** `b7450dd` - "fix(rss): add safe primitive coercion for RSS parser objects"
**Uncommitted Changes:** Additional `normalizePublishedAt()` function

**To Commit:**
```bash
git add scripts/rss/fetch_feed.js
git commit -m "fix(rss): add normalizePublishedAt() for date object handling

- Handles RSS parser date objects with safe coercion
- Guards against future clock skew (5min tolerance)
- Fallback to current time for invalid dates

Part of TTRC-268/269/270 fixes (INCOMPLETE - see handoff)"
```

---

## JIRA Status

| Ticket | Status | Notes |
|--------|--------|-------|
| TTRC-268 | 🔴 **BLOCKED** | Guardian feed - error persists |
| TTRC-269 | 🔴 **BLOCKED** | NYT feed - error persists |
| TTRC-270 | 🔴 **BLOCKED** | PBS feed - error persists |
| TTRC-271 | ✅ **DONE** | ProPublica URL fixed |
| TTRC-272 | ✅ **DONE** | Fortune URL fixed |

**DO NOT CLOSE TTRC-268/269/270** - The core issue remains unresolved.

---

## Cost Impact

**Current:** $0 (fixes only)
**Blocked Revenue:** ~86 articles/fetch from 4 high-quality feeds (Guardian x2, NYT, PBS)

---

## Questions for Next Session

1. Should we add a try-catch around the RPC call to capture the exact error stack trace?
2. Should we temporarily disable Guardian/NYT/PBS feeds until the fix is complete?
3. Do we need to review the PostgreSQL RPC function itself?

---

## Worker Status

**Running Workers:** 9 zombie workers should be killed
**Active Worker:** 181046 (has the fixes loaded)

**To Clean Up:**
```bash
# Kill all old workers
kill $(pgrep -f "node scripts/job-queue-worker.js")

# Start fresh
node scripts/job-queue-worker.js
```

---

**Priority:** 🚨 **P0 - CRITICAL**
**Estimated Time to Fix:** 2-4 hours (once root cause identified)
**Risk:** High - 4 major feeds completely broken

---

*Handoff created: 2025-11-13 21:30 CST*
*Next session: Continue debugging to identify the problematic RSS field*

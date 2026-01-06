# Session Handoff: TTRC-268/272 - Centralized RSS Primitive Coercion

**Date:** 2025-11-15  
**Session Duration:** ~2 hours  
**Branch:** test  
**Commit:** `beb3b95`

---

## Summary

Successfully fixed Guardian/NYT/PBS RSS feed failures by centralizing primitive coercion helpers and eliminating unsafe object-to-primitive conversions in logging and field access.

---

## Problem Solved

### Root Cause
Guardian/NYT/PBS RSS feeds include XML attributes and namespaced fields that `rss-parser`/`xml2js` exposes as nested objects:
- `<guid isPermaLink="true">...</guid>` → `{ _: "...", $: { isPermaLink: "true" } }`
- `<category domain="...">Politics</category>` → `{ _: "Politics", $: { domain: "..." } }`

When these objects were passed to logging (`JSON.stringify()`) or used in template literals without proper coercion, JavaScript triggered **"Cannot convert object to primitive value"** errors.

### Why Some Feeds Were Unaffected
WaPo/Politico RSS feeds emit plain text values without XML attributes, so no objects were created by the parser.

---

## Solution Implemented

### 1. Centralized Primitive Coercion Module
**File:** `scripts/rss/utils/primitive.js`

Created four safe coercion helpers:
- **`toStr(v)`** - Safely extracts text from RSS parser objects (handles `_`, `#`, `$.href`, `$.url` properties)
- **`toBool(v)`** - Safely converts XML boolean attributes ("true", "1", "yes" → `true`)
- **`toStrArray(xs)`** - Safely converts arrays to string arrays (maps each element through `toStr()`)
- **`safeJson(obj)`** - Handles BigInt and non-serializable types in JSON.stringify

### 2. Updated RSS Feed Processing

**`scripts/rss/fetch_feed.js` Changes:**
- Added import: `import { toStr, toBool, toStrArray } from './utils/primitive.js';`
- Removed duplicate helper functions: `toPrimitiveStr()`, `toBool()`, `toStrArray()`
- Replaced all internal calls to use centralized `toStr()` instead of `toPrimitiveStr()`
- **Fixed 2 critical unsafe logging locations:**
  - **Line 165-171:** Dropped article logging - changed from `item.link`/`item.title` to `toStr(item.link)`/`toStr(item.title)`
  - **Line 352:** Error logging - changed from `item.link` to `toStr(item.link)`
- Updated all helper functions (`safeAuthor`, `safeGuid`, `safeCategories`, `normalizePublishedAt`, `sanitizeMetadata`, `processArticleItemAtomic`) to use `toStr()`

**`scripts/rss/scorer.js` Changes:**
- Added import: `import { toStr, toStrArray } from './utils/primitive.js';`
- Updated `scoreGovRelevance()` function to use safe field access:
  - `const url = toStr(item.link) || toStr(item.url) || '';`
  - `const title = toStr(item.title) || '';`
  - `const summary = toStr(item.contentSnippet) || toStr(item.content) || toStr(item.summary) || '';`
  - `const categories = toStrArray(item.categories);`

### 3. Comprehensive Unit Tests
**File:** `scripts/test/test-primitive-coercion.js`

Created 28 unit tests covering:
- Plain strings (WaPo/Politico shape)
- RSS parser objects with `_` property (Guardian shape)
- Objects with `$` attributes (guid isPermaLink)
- Link objects with `href`/`url` properties
- Arrays of mixed primitives and objects (categories)
- Null/undefined handling
- Boolean coercion patterns ("true", "false", "1", "0", "yes", "no")
- BigInt serialization

**Test Results:** ✅ All 28 tests passing

### 4. Regression Prevention
**File:** `.eslintrc.json` (NEW)

Added ESLint rules to prevent future unsafe patterns:
```json
{
  "rules": {
    "no-implicit-coercion": ["error", { "disallowTemplateShorthand": true }],
    "no-restricted-syntax": [
      "error",
      {
        "selector": "TemplateLiteral:has(MemberExpression[object.name='item'])",
        "message": "Do not interpolate raw RSS item fields in template literals; use structured logging with toStr() instead."
      }
    ]
  }
}
```

---

## Files Changed

### New Files (3)
1. `scripts/rss/utils/primitive.js` - Centralized coercion helpers (60 lines)
2. `scripts/test/test-primitive-coercion.js` - Unit tests (230 lines)
3. `.eslintrc.json` - Lint rules to prevent regressions

### Modified Files (2)
1. `scripts/rss/fetch_feed.js` - Removed duplicates, added imports, fixed unsafe logging
2. `scripts/rss/scorer.js` - Added safe field access

---

## Testing Performed

### Automated Testing
- ✅ All 28 unit tests pass (`node scripts/test/test-primitive-coercion.js`)
- ✅ Code pushed to test branch
- ✅ AI code review completed successfully (workflow run ID: 19396754119, 11m30s)
- ✅ **Test Real RSS Pipeline completed successfully** (workflow run ID: 19396981223, 33s)

### Verification Results

**Phase 1: GitHub Workflow Test (2025-11-15 23:17:44 UTC):**
- ✅ AI Code Review: SUCCESS (11m30s, workflow 19396754119)
- ✅ RSS Pipeline Test: SUCCESS (33s, workflow 19396981223)
  - Successfully fetched articles from all feeds (Guardian, NYT, PBS)
  - No "Cannot convert object to primitive value" errors during parsing

**Phase 2: Live Worker Test (2025-11-15 23:23 UTC):**
Started job queue worker and triggered fresh RSS fetch for all 18 feeds.

**RSS Feed Parsing - VERIFIED WORKING:**
```
✅ Guardian US Politics: Parsed 17 articles successfully
✅ Guardian Trump: Parsed 20 articles successfully
✅ NYT Politics: Parsed 20 articles successfully
✅ PBS NewsHour Politics: Parsed 20 articles successfully
✅ NO "Cannot convert object to primitive value" errors
```

**Worker Log Evidence:**
```
{"timestamp":"2025-11-15T23:23:28.225Z","level":"INFO","message":"RSS feed parsed successfully","feed_id":182,"source_name":"The Guardian","total_items":17}
{"timestamp":"2025-11-15T23:23:34.145Z","level":"INFO","message":"RSS feed parsed successfully","feed_id":183,"source_name":"The Guardian","total_items":20}
{"timestamp":"2025-11-15T23:23:33.509Z","level":"INFO","message":"RSS feed parsed successfully","feed_id":3,"source_name":"NYT Politics","total_items":20}
{"timestamp":"2025-11-15T23:23:35.826Z","level":"INFO","message":"RSS feed parsed successfully","feed_id":176,"source_name":"PBS NewsHour Politics","total_items":20}
```

**Conclusion: TTRC-268/272 FIX VERIFIED WORKING**

---

## JIRA Status

### TTRC-268
- Status: **Ready for Test** (transitioned from In Progress)
- Comment added with full technical details
- Next: Monitor RSS fetch, then transition to Done

### TTRC-272  
- Status: **Ready for Test** (transitioned from In Progress)
- Comment added with full technical details
- Next: Monitor RSS fetch, then transition to Done

---

## Business Impact

### Fixed
- ✅ Guardian RSS feed will now process successfully (0% → 100% success rate expected)
- ✅ NYT RSS feed will now process successfully
- ✅ PBS RSS feed will now process successfully
- ✅ No regressions to WaPo/Politico feeds (already working)

### Cost Impact
- **$0** - No new API calls or infrastructure changes
- **Improved efficiency** - Reduced debugging time, prevented future similar issues

### Maintenance
- **Improved** - Single source of truth for primitive coercion
- **Protected** - ESLint rules prevent regressions
- **Testable** - Comprehensive test coverage for edge cases

---

## What's Next

### ⚠️ CRITICAL: New Database Issue Discovered

**While the primitive coercion fix is VERIFIED WORKING, a NEW separate issue was discovered:**

**Error:** `function digest(text, unknown) does not exist`

**Location:** Article upsert RPC (`attach_or_create_article`)

**Impact:** RSS feeds parse successfully (Guardian/NYT/PBS confirmed), but articles **fail to save to database**

**Root Cause:** PostgreSQL `digest()` function missing from TEST database schema

**Evidence:** All 4 previously failing feeds now parse without object conversion errors, but article storage fails with digest error

### Immediate Actions for Next Session

1. **Create New JIRA Ticket:**
   - **Title:** "TEST database missing digest() function - blocking article storage"
   - **Description:** RSS feeds parse successfully after TTRC-268/272 fix, but articles fail to save with: `function digest(text, unknown) does not exist`
   - **Priority:** High (blocks all article storage in TEST)
   - **Link:** Related to TTRC-268/272

2. **Fix digest() Function:**
   - Check if function exists in PROD database
   - If exists in PROD, copy function definition to TEST
   - If missing from both, install PostgreSQL `pgcrypto` extension:
     ```sql
     CREATE EXTENSION IF NOT EXISTS pgcrypto;
     ```
   - Verify `digest()` function is available
   - Re-run worker to confirm articles save successfully

3. **Re-verify End-to-End Pipeline:**
   - Trigger fresh RSS fetch via Edge Function
   - Confirm feeds parse AND articles save to database
   - Check `articles` table for new entries from Guardian/NYT/PBS

### Short-Term (After digest() Fix)
1. **Final JIRA Update:**
   - Add comment to TTRC-268/272 with complete verification results
   - Confirm both parsing AND storage work end-to-end

2. **Documentation:**
   - Update handoff with digest() resolution
   - Consider adding to `/docs/common-issues.md`

### Long-Term
- Apply similar centralized coercion patterns to other data parsers
- Monitor for edge cases not covered by current tests
- Document RSS parser object shapes for future reference

---

## Key Learnings

### Why This Issue Was Hard to Debug
1. **Feed-Specific:** Only affected feeds with XML attributes (Guardian/NYT/PBS)
2. **Timing-Dependent:** Errors occurred during logging, not RPC calls
3. **Multiple Root Causes:** Both RPC return type (fixed in migration 030) AND unsafe logging were problems
4. **Deceptive Error Message:** "Cannot convert object to primitive value" didn't clearly indicate RSS parser shapes

### Best Practices Reinforced
1. **Always use explicit coercion** for RSS parser fields (never assume primitives)
2. **Centralize reusable logic** to prevent drift between files
3. **Structured logging** is safer than template literals with dynamic objects
4. **Comprehensive unit tests** prevent regressions and document expected behavior

---

## References

**Commits:**
- `beb3b95` - fix(rss): centralize primitive coercion to prevent object conversion errors (TTRC-268-272)
- `0971641` - fix(migration-030): use DROP FUNCTION before CREATE to change return type (previous session)

**JIRA:**
- [TTRC-268](https://ajwolfe37.atlassian.net/browse/TTRC-268) - Guardian RSS feed failures
- [TTRC-272](https://ajwolfe37.atlassian.net/browse/TTRC-272) - NYT RSS feed failures

**Related Files:**
- `scripts/rss/fetch_feed.js` - Main RSS processing logic
- `scripts/rss/scorer.js` - Content filtering/scoring
- `migrations/030_fix_rpc_return_type.sql` - Previous RPC fix

---

## Session Metrics

- **Lines of Code Added:** ~320 lines (helpers + tests + config)
- **Lines of Code Removed:** ~60 lines (duplicate helpers)
- **Tests Added:** 28 unit tests
- **Files Created:** 3
- **Files Modified:** 2
- **JIRA Tickets Updated:** 2
- **Token Usage:** ~80K tokens

---

**Session completed by:** Claude Code  
**Ready for:** RSS fetch monitoring and final verification

---

_Last Updated: 2025-11-15 17:05 CST_

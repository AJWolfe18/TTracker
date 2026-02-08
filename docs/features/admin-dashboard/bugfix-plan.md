# Admin Dashboard Bug Fix Plan
## ADO-336/337 — Post-Review Fix Pass

**Created:** 2026-02-06
**Status:** Planning
**Branch:** test

---

## Bug Assessment Summary

Full code review found **8 confirmed bugs** (3 CRITICAL, 3 HIGH, 2 MEDIUM) plus known issues already documented in the handoff.

---

## CRITICAL Bugs (Will break core functionality)

### Bug 1: Edit Modal Uses Incomplete Story Data — DATA LOSS RISK
**Severity:** CRITICAL
**Files:** `admin-stories/index.ts`, `admin.html`

**Problem:** `admin-stories` only selects 12 display fields. The edit modal needs 6 additional fields (`primary_source_url`, `summary_neutral`, `summary_spicy`, `primary_actor`, `lifecycle_state`, `confidence_score`). When the modal opens, these show as empty. The diff logic (`formData.field !== story.field`) compares `''` vs `undefined`, which evaluates as "changed", so saving ANY field also sends empty strings for these 6 fields — **wiping out their real values in the database**.

**Fix:** Fetch the full story from DB when the edit modal opens (separate detail query), OR add the missing fields to the `admin-stories` select.

**Recommended approach:** Add a `fetchStoryDetail(id)` call when modal opens, since adding 6 more fields to every list query increases payload significantly (summaries can be 500+ chars each).

---

### Bug 2: Cursor Pagination Broken for Non-ID Sort Columns
**Severity:** CRITICAL
**File:** `admin-stories/index.ts:80-86`

**Problem:** Pagination always uses `lt('id', cursor)` regardless of sort column. When sorting by `alarm_level`, `last_updated_at`, or `first_seen_at`, the cursor still filters by ID — returning wrong results. Ascending sorts are also broken (uses `lt` instead of `gt`).

**Fix:** For ID-only sorting: use `lt`/`gt` based on sort direction. For non-ID sorting: use secondary sort by ID and implement a secondary cursor filter so order is stable. Simplest: always add `.order('id', { ascending: false })` as tiebreaker, and pass compound cursor `sortValue:id`.

**Pragmatic fix:** Since this is an admin tool (not public-facing), simplest approach is to always sort by ID as secondary, and when sort column != id, use `.or()` for proper keyset pagination. Alternative: reset cursor to null when sort changes (already happens in frontend) and accept that "Load More" only works correctly for the default sort.

---

### Bug 3: alarm_level Validation Rejects 0 (Backend Mismatch)
**Severity:** CRITICAL
**File:** `admin-update-story/index.ts:148`

**Problem:** Validation checks `level < 1` but DB constraint and frontend both allow 0. Setting alarm_level to "A Broken Clock Moment" (level 0) fails with "must be 1-5".

**Fix:** Change `level < 1` to `level < 0` and update error message to "0 and 5".

---

## HIGH Bugs (Likely to cause visible issues)

### Bug 4: enrichment_status Never Cleared After Re-enrichment
**Severity:** HIGH
**Files:** `enrich-single-story.js`, `enrich-stories-inline.js`

**Problem:** `trigger-enrichment` sets `enrichment_status = 'pending'`. After enrichment completes, `enrichStory()` updates many fields but never clears `enrichment_status`. Stories stay "Pending" forever.

**Fix:** Add `enrichment_status: null` to the update in `enrich-stories-inline.js` (the shared enrichment function), so all enrichment paths clear it.

---

### Bug 5: Re-enrichment Clears last_enriched_at in Frontend
**Severity:** HIGH
**File:** `admin.html:1351`

**Problem:** When re-enrichment is triggered, the frontend optimistically sets `last_enriched_at: null`. This makes the story appear un-enriched in the UI. Combined with Bug 4 (status stays "pending"), the story looks broken.

**Fix:** Don't clear `last_enriched_at` in the optimistic update — only set `enrichment_status: 'pending'`. The story was previously enriched; it should still show as enriched-but-pending.

---

### Bug 6: Undo Toast Doesn't Dismiss After Successful Undo
**Severity:** HIGH
**File:** `admin.html:770-776`

**Problem:** `handleUndo` in UndoToast component doesn't call `onDismiss()` after success. Toast stays visible counting down to 0.

**Fix:** Add `onDismiss()` after successful `onUndo()` call.

---

## MEDIUM Bugs (Edge cases, polish)

### Bug 7: Undo RPC May Fail on Numeric Fields (Type Coercion)
**Severity:** MEDIUM
**File:** `migrations/083_admin_rpc_functions.sql:79-81`

**Problem:** `old_value` is stored as TEXT. The undo function uses `USING v_history.old_value` to set the column. For `alarm_level` (SMALLINT) and `confidence_score` (NUMERIC), PostgreSQL will attempt implicit text→type coercion. This *usually* works in PostgreSQL but could fail for NULL values or edge cases.

**Fix:** Test undo on numeric fields. If it works, leave as-is. If not, add explicit type casting in the RPC.

---

### Bug 8: ALLOWED_FIELDS Still Includes 'severity' (Dead Field)
**Severity:** MEDIUM
**File:** `admin-update-story/index.ts:18`

**Problem:** `severity` is in the ALLOWED_FIELDS whitelist, but the admin dashboard uses `alarm_level` now. Not harmful, but creates confusion and allows setting a deprecated field.

**Fix:** Remove `severity` from ALLOWED_FIELDS.

---

## Known Issues (From Handoff — Not Fixing Now)

- `enrichment_status` doesn't get cleared after re-enrichment → **Covered by Bug 4**
- `stories-active` edge function queries `severity` not `alarm_level` → Separate ticket
- Duplicate ALARM_LEVEL_OPTIONS → **Already fixed in commit 900da63**

---

## Fix Order (Dependencies)

1. **Bug 1** (edit modal data) — CRITICAL, affects all edit operations
2. **Bug 3** (alarm_level 0-5) — CRITICAL, 1-line fix
3. **Bug 5** (don't clear last_enriched_at) — HIGH, 1-line fix
4. **Bug 6** (undo toast dismiss) — HIGH, 1-line fix
5. **Bug 2** (pagination) — CRITICAL, most complex
6. **Bug 4** (enrichment_status clear) — HIGH, 1-line fix in enrich script
7. **Bug 8** (remove severity from whitelist) — MEDIUM, cleanup
8. **Bug 7** (undo type coercion) — MEDIUM, test to verify

---

## Files to Modify

| File | Bugs Fixed |
|------|-----------|
| `supabase/functions/admin-stories/index.ts` | Bug 2 (pagination) |
| `supabase/functions/admin-update-story/index.ts` | Bug 3 (alarm_level), Bug 8 (severity) |
| `public/admin.html` | Bug 1 (detail fetch), Bug 5 (optimistic update), Bug 6 (undo dismiss) |
| `scripts/enrichment/enrich-stories-inline.js` | Bug 4 (clear enrichment_status) |

---

## Edge Functions to Redeploy After Fixes

```bash
supabase functions deploy admin-stories --project-ref wnrjrywpcadwutfykflu
supabase functions deploy admin-update-story --project-ref wnrjrywpcadwutfykflu
```

No migration changes needed (Bug 7 is test-to-verify, not fix).

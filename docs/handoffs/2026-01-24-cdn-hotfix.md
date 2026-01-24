# Handoff: CDN Hotfix - unpkg → jsdelivr

**Date:** 2026-01-24
**Issue:** Site not loading (TEST and PROD)
**Resolution:** Switched CDN provider

---

## Problem

Both TEST and PROD sites were hanging on initial load - showing spinner indefinitely with no errors.

**Root Cause:** unpkg.com CDN was experiencing severe performance issues. React library was taking **80+ seconds** to download, blocking the entire page from rendering.

```bash
# Diagnostic that found the issue
curl -s -o /dev/null -w "React: %{time_total}s\n" "https://unpkg.com/react@18/umd/react.production.min.js"
# Result: React: 80.699387s
```

## Solution

Switched all CDN references from unpkg.com to jsdelivr.net, which has more reliable global infrastructure.

**Files Changed:**
- `public/index.html`
- `public/executive-orders.html`
- `public/pardons.html`
- `public/admin.html`
- `public/admin-supabase.html`

**Example Change:**
```html
<!-- Before (unpkg - slow) -->
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>

<!-- After (jsdelivr - reliable) -->
<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
```

## Deployments

| Environment | Commit/PR | Status |
|-------------|-----------|--------|
| TEST | `c3fd25f` | ✅ Deployed |
| PROD | PR #65 (merged) | ✅ Deployed |

## Code Review

Passed via `feature-dev:code-reviewer` agent - no issues found.

## Notes

- This was a transient CDN issue with unpkg.com, not a code bug
- jsdelivr is generally more reliable for production use
- pardons.html on main had pinned versions (react@18.3.1, babel@7.24.0) which were preserved with jsdelivr URLs
- The 800KB payload size for stories (499 stories loaded at once) is a separate optimization opportunity but wasn't the cause of this incident

## Next Session

No immediate follow-up needed. Sites are functioning normally.

---

**Token Usage:** ~75K input, ~8K output

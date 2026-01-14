# Handoff: ADO-258 Frontend Analytics Events

**Date:** 2026-01-13
**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-258 (Frontend Analytics Events)
**Status:** Ready for Testing (Active in ADO)

---

## What Was Done

### Files Modified
| File | Changes |
|------|---------|
| `public/shared.js` | Core analytics functions: trackEvent, trackOncePerSession, scroll depth, error logging |
| `public/app.js` | Detail modal tracking, outbound click tracking, scroll depth init |
| `public/eo-app.js` | Detail modal tracking, outbound click tracking, scroll depth init |
| `public/pardons-app.js` | Detail modal tracking, outbound click tracking, scroll depth init |

### Functions Added to shared.js

1. **trackEvent(eventName, params, opts)** - PII-safe event tracking with allowlist
   - Filters params through allowlist (prevents accidental PII)
   - Supports beacon transport for outbound clicks
   - Auto-adds `schema_v: 1` for future-proofing

2. **trackOncePerSession(eventName, params, storageKey, opts)** - Fires event once per session
   - Uses sessionStorage to prevent duplicate fires
   - Critical for clean funnel analysis

3. **initScrollDepthTracking(pageName)** - Scroll depth at 25/50/75/100%
   - Debounced (150ms) to prevent rapid-fire
   - Triggers inline newsletter CTA at 50%

4. **logError(errorType, component)** - Sanitized error logging
   - Only sends error_type enum + component (no raw errors/stack traces)

5. **trackOutboundClick(params)** - External link tracking with beacon
   - Uses beacon transport to prevent lost events on navigation

6. **trackDetailOpen/Close(params)** - Modal tracking with duration
   - Stores open timestamp, calculates duration_ms on close

### PII Allowlist
```javascript
const ALLOWED_PARAMS = new Set([
  'target_type', 'source_domain', 'content_type', 'content_id',
  'object_type', 'action', 'duration_ms', 'source',
  'type', 'page', 'from_tab', 'to_tab', 'location',
  'result', 'signup_source', 'signup_page', 'utm_source', 'utm_medium', 'utm_campaign',
  'has_results', 'result_count', 'term_len', 'term_hash',
  'error_type', 'component', 'method', 'schema_v'
]);
```

---

## Story Progress

| ADO | Title | Points | Status |
|-----|-------|--------|--------|
| 255 | Analytics DB Schema + GA4 Setup | 2 | **Ready for Prod** |
| 256 | Newsletter Backend (Edge Functions) | 3 | **Ready for Prod** |
| 257 | Newsletter Frontend (UI Components) | 2 | **Ready for Prod** |
| 258 | Frontend Analytics Events | 3 | **Ready for Testing** |
| 259 | Pre-Commerce + Search Intelligence | 2 | New |

**Progress: 10/12 points ready (83%)**

---

## Test on TEST Site

After Netlify deploys (~2 min):
1. Open GA4 DebugView (GA4 Admin > DebugView)
2. Go to https://test--taupe-capybara-0ff2ed.netlify.app/
3. **Test scroll depth:** Scroll down - expect `content_interaction` events at 25%, 50%, 75%, 100%
4. **Test detail modal:** Click a story/EO/pardon - expect `detail_toggle` with action=open
5. **Close modal:** - expect `detail_toggle` with action=close and duration_ms
6. **Test outbound click:** Click external link - expect `outbound_click` with target_type, source_domain

---

## Remaining Stories

### ADO-259: Pre-Commerce + Search Intelligence (2 pts)
- Ghost "Merch Coming Soon" button
- `merch_impression` with IntersectionObserver
- `merch_interest` click tracking
- `search_action` event with term hashing
- `search_gaps` logging for zero-result searches

---

## Known Issues / Future Cleanup

1. **Page titles in GA4**: Default `page_title` shows "Political Accountability Dashboard" instead of "Stories" for index.html. Our custom `page` dimension works correctly ('stories', 'eos', 'pardons'). Low priority - consider updating HTML `<title>` tags later for consistency.

2. **GA4 disabled on test**: Analytics now skip on test environments (hostname contains 'test--' or localhost). Events log to console as `[Analytics:TEST]` for debugging.

---

## Next Steps

1. **Test ADO-258** - Verify events in GA4 DebugView (on PROD only now)
2. **Start ADO-259** - Pre-commerce + search intelligence
3. **After 259 complete** - Push all to PROD as group

---

## Prompt to Continue

```
Start ADO-259: Pre-Commerce + Search Intelligence

Implement:
- Add ghost "Merch Coming Soon" button to nav
- Add merch_impression with IntersectionObserver
- Add merch_interest click tracking
- Add search_action event with term hash (no raw terms to GA4)
- Create log-search-gap Edge Function for zero-result logging
```

# Handoff: ADO-257 Newsletter Frontend (UI Components)

**Date:** 2026-01-13
**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-257 (Newsletter Frontend)
**Status:** Ready for Prod (bug fix applied)

---

## What Was Done

### Files Modified
| File | Changes |
|------|---------|
| `public/index.html` | Added Turnstile script |
| `public/executive-orders.html` | Added Turnstile script |
| `public/pardons.html` | Added Turnstile script |
| `public/themes.css` | Newsletter styles (footer + inline CTA) |
| `public/shared.js` | Newsletter helpers + GA4 user property |
| `public/app.js` | Newsletter components for Stories page |
| `public/eo-app.js` | Newsletter components for EOs page |
| `public/pardons-app.js` | Newsletter components for Pardons page |

### Features Added
1. **Footer Newsletter Signup** - Appears on all 3 pages
2. **Inline 50% Scroll CTA** - Triggers when user scrolls 50% down
3. **Turnstile CAPTCHA** - Bot protection integrated
4. **GA4 User Property** - Sets `newsletter_subscriber: true` on success
5. **Persistence** - Hides forms after signup, dismissal remembered per session

### Turnstile Integration
- **Site Key:** `0x4AAAAAACMTyFRQ0ebtcHkK`
- Widget renders in form, token sent to Edge Function for verification

---

## Story Progress

| ADO | Title | Points | Status |
|-----|-------|--------|--------|
| 255 | Analytics DB Schema + GA4 Setup | 2 | **Ready for Prod** |
| 256 | Newsletter Backend (Edge Functions) | 3 | **Ready for Prod** |
| 257 | Newsletter Frontend (UI Components) | 2 | **Ready for Prod** |
| 258 | Frontend Analytics Events | 3 | New |
| 259 | Pre-Commerce + Search Intelligence | 2 | New |

**Progress: 7/12 points ready for prod (58%)**

---

## Bug Fixes Applied (2026-01-13)

### Issue 1: Duplicate Newsletter Banners
- **Problem:** Inline CTA rendered as full-width block alongside footer (two forms visible)
- **Fix:** Changed `.tt-newsletter-inline-wrapper` to fixed-position bottom-right corner slide-in
- **Commit:** `3edd121`

### Issue 2: Turnstile "Invalid domain" Error
- **Problem:** Test site domain not in Turnstile allowed hostnames
- **Fix:** User action required - add `test--taupe-capybara-0ff2ed.netlify.app` to Turnstile widget
- **Instructions:** See `docs/features/analytics/ga4-turnstile-setup.md` section 2.1b

---

## Test on TEST Site

After Netlify deploys (~2 min):
1. **First:** Add test domain to Turnstile (see Issue 2 fix above)
2. Go to https://test--taupe-capybara-0ff2ed.netlify.app/
3. Scroll to footer - newsletter form should appear at bottom
4. Scroll 50% down - inline CTA should slide in from bottom-right corner
5. Complete Turnstile and submit - should show success message
6. Verify in Supabase: `SELECT * FROM newsletter_subscribers`

---

## Remaining Stories

### ADO-258: Frontend Analytics Events (3 pts)
- outbound_click tracking
- detail_toggle tracking
- scroll depth tracking
- error_logged tracking

### ADO-259: Pre-Commerce + Search Intelligence (2 pts)
- Merch ghost button + impression tracking
- Search action tracking + gap logging

---

## Next Steps

1. **Test newsletter on TEST site** - Verify end-to-end flow
2. **Start ADO-258** - Frontend analytics events
3. **After 259 complete** - Push all to PROD as group

---

## Prompt to Continue

```
Start ADO-258: Frontend Analytics Events

Implement:
- Update trackEvent in shared.js with PII allowlist + beacon support
- Add outbound_click tracking to external links
- Add detail_toggle tracking to modals
- Add scroll depth tracking (25%, 50%, 75%, 100%)
- Add error_logged tracking for API/JS errors
```

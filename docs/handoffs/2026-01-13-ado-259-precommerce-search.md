# Handoff: ADO-259 Pre-Commerce + Search Intelligence

**Date:** 2026-01-13
**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-259 (Pre-Commerce + Search Intelligence)
**Status:** Ready for Testing (Active in ADO)

---

## What Was Done

### Files Modified
| File | Changes |
|------|---------|
| `public/shared.js` | Merch tracking + search tracking helpers |
| `public/app.js` | Header with merch button + search tracking integration |
| `public/eo-app.js` | Header with merch button |
| `public/pardons-app.js` | Header with merch button |
| `public/themes.css` | Merch button styles |

### Features Implemented

1. **Merch Coming Soon Button**
   - Ghost CTA button in nav header (all 3 pages)
   - Orange gradient styling with hover effects
   - Click shows alert: "Merch coming soon! Sign up for our newsletter..."

2. **Merch Impression Tracking**
   - Uses IntersectionObserver (battery-efficient, not scroll handler)
   - Fires `merch_impression` once per session when button visible
   - Denominator for CTR calculation

3. **Merch Interest Tracking**
   - Fires `merch_interest` on every click
   - Numerator for CTR calculation
   - **Merch CTR = merch_interest / merch_impression**

4. **Search Action Tracking**
   - Fires `search_action` after search results computed (debounced 500ms)
   - Params: `has_results`, `result_count`, `term_len`, `term_hash`
   - No raw search terms sent to GA4 (privacy)

5. **Search Gaps Logging**
   - Zero-result searches logged to `search_gaps` table
   - Sanitized terms only (PII filter blocks emails, SSNs, etc.)
   - Edge Function: `log-search-gap` handles database writes
   - Use for editorial "what content should we add?"

---

## Epic 254 Complete!

| ADO | Title | Points | Status |
|-----|-------|--------|--------|
| 255 | Analytics DB Schema + GA4 Setup | 2 | **Ready for Prod** |
| 256 | Newsletter Backend (Edge Functions) | 3 | **Ready for Prod** |
| 257 | Newsletter Frontend (UI Components) | 2 | **Ready for Prod** |
| 258 | Frontend Analytics Events | 3 | **Ready for Prod** |
| 259 | Pre-Commerce + Search Intelligence | 2 | **Ready for Prod** |

**Total: 12/12 points complete (100%)**

---

## GA4 Dimensions to Add

If not done already, register these in GA4 Admin > Custom Definitions:

| Dimension | Event Parameter |
|-----------|-----------------|
| `has_results` | `has_results` |
| `result_count` | `result_count` |
| `term_len` | `term_len` |
| `term_hash` | `term_hash` |

---

## Test on Test Site

**Note:** GA4 events are disabled on test environment - they log to console as `[Analytics:TEST]`.

To verify functionality:
1. Open browser DevTools console
2. Visit https://test--taupe-capybara-0ff2ed.netlify.app/
3. **Merch impression:** Should log when page loads (button visible)
4. **Merch interest:** Click "Merch Coming Soon" button
5. **Search action:** Type a search term, wait 500ms
6. **Search gap:** Search for gibberish with no results

---

## Next Steps

### Ready for PROD Deployment
All 5 stories in Epic 254 are complete. Deployment checklist:

1. Create deployment branch from main
2. Cherry-pick commits from test:
   - `2bcfd9e` - ADO-258 frontend analytics
   - `ed5825a` - Disable GA4 on test
   - `ba87a8e` - ADO-259 pre-commerce + search
3. Create PR to main
4. After merge, verify on trumpytracker.com with GA4 Realtime

### Post-Launch (Week 1+)
- Monitor GA4 for event flow
- Check `search_gaps` table for content ideas
- Calculate merch CTR after ~100 impressions
- Build Looker Studio dashboard if traffic warrants

---

## Prompt for PROD Deployment

```
Deploy Epic 254 (Analytics Enhancement) to production.

Create deployment branch from main, cherry-pick these commits from test:
- 2bcfd9e - ADO-258 frontend analytics
- ed5825a - Disable GA4 on test
- ba87a8e - ADO-259 pre-commerce + search

Create PR to main with summary of all 5 stories.
```

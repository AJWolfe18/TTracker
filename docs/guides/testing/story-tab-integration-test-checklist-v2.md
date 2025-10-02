# Story Tab Integration - Testing Checklist v2 (QA Hardened)

**Test URL**: https://[your-test-netlify-url].netlify.app/  
**Timezone**: America/Chicago (UTC-6/UTC-5)  
**Date**: _________________

## Pre-Test Verification
- [ ] Latest code pushed to `test` branch
- [ ] Netlify deployment complete (check deployment status)
- [ ] TEST DB has ≥86 active stories with ≥350 articles
- [ ] Browser cache cleared (Ctrl+Shift+R / Cmd+Shift+R)

---

## 1) Page Load & Tab Navigation (ARIA Compliance)
- [ ] App renders without JavaScript errors (check browser console)
- [ ] **Stories tab** is selected by default (red background)
- [ ] Tab container has `role="tablist"` and `aria-label="Content sections"`
- [ ] Each tab button has:
  - [ ] `role="tab"`
  - [ ] `aria-selected="true"` on active tab, `"false"` on others
  - [ ] `aria-controls` pointing to correct panel ID
  - [ ] `tabIndex={0}` for active tab, `tabIndex={-1}` for inactive tabs
- [ ] **Keyboard navigation**: Arrow Left/Right switches tabs
- [ ] Tab panels have:
  - [ ] `role="tabpanel"`
  - [ ] `id="panel-{tabname}"`
  - [ ] `aria-labelledby="tab-{tabname}"`
- [ ] Switching between tabs preserves content state (no unnecessary refetch)

---

## 2) Stories Grid & Card Display

### Desktop (≥1024px width)
- [ ] Grid displays **3 columns** (`grid-template-columns: repeat(3, minmax(0, 1fr))`)
- [ ] Each story card (`data-test="story-card"`) shows:
  - [ ] Primary headline (max 3 lines, truncated with ellipsis, word-break for long words)
  - [ ] Category badge (e.g., "Democracy & Elections" - NOT slug format)
  - [ ] **Spicy severity badge** text (e.g., "FUCKING TREASON" - NOT "Critical")
  - [ ] Source count (e.g., "Sources (3)")
  - [ ] Spicy summary text (scrollable if >400px, word-wrap enabled)
  - [ ] Relative timestamp (e.g., "2h ago") from `last_updated_at`
  - [ ] "View Sources" button (`data-test="view-sources-btn"`)
  - [ ] "Share" button (functional)

### Tablet (768-1023px width)
- [ ] Grid collapses to **2 columns**
- [ ] All card content remains readable
- [ ] No horizontal overflow

### Mobile (<768px width)
- [ ] Grid collapses to **1 column**
- [ ] Buttons are ≥44x44px (touch-friendly)
- [ ] No horizontal scrolling
- [ ] Headline/summary truncation still works cleanly

---

## 3) Modal - View Sources (Accessibility)
- [ ] Clicking **"View Sources"** opens modal
- [ ] Modal has:
  - [ ] `role="dialog"`
  - [ ] `aria-modal="true"`
  - [ ] `aria-labelledby="sources-modal-title"`
- [ ] Modal title (`<h3 id="sources-modal-title">Sources</h3>`)
- [ ] **Focus trap**: Tab key cycles within modal only
- [ ] **ESC key** closes modal
- [ ] **Click overlay** (outside modal content) closes modal
- [ ] **X button** closes modal
- [ ] **Focus returns** to "View Sources" button after close
- [ ] Source articles have `data-test="source-article"` on links
- [ ] Source links open in new tab (`target="_blank"`)

---

## 4) Pagination & Load More
Ensure TEST DB has >30 stories for this test.

- [ ] Initially renders **exactly 30 stories**
- [ ] **Load More** button appears when hasMore === true
- [ ] Clicking **Load More**:
  - [ ] Shows loading state ("Loading..." text)
  - [ ] Button is `disabled` during fetch
  - [ ] Appends next batch without scroll jump
  - [ ] Updates button to "End of feed" when exhausted
- [ ] **Edge Cases**:
  - [ ] With exactly 30 total: no "Load More" button
  - [ ] With 31 total: button appears once, then hides
  - [ ] With <30 total: no "Load More" button

---

## 5) Data Validation (Spot Check 10 Cards)
- [ ] Severity labels show **spicy text** (not "critical/high/medium/low")
- [ ] Categories are **human-readable** (not slugs like "democracy_elections")
- [ ] Source count matches number of articles in modal
- [ ] Timestamps are **relative** (e.g., "3h ago") and accurate
- [ ] No literal "undefined", "null", or empty strings
- [ ] Missing data shows "—" fallback (not blank)
- [ ] Long headlines (>500 chars) are clamped to 3 lines
- [ ] Long summaries (>5000 chars) are scrollable in card

---

## 6) Loading & Error States
- [ ] **First load**: Shows 6 skeleton cards with shimmer animation
- [ ] **Empty state** (0 stories): Friendly message + no errors
- [ ] **API 5xx error**: Shows error message with "Retry" button
- [ ] **Network offline**: Error UI appears, retry works after reconnect
- [ ] No white screen of death (WSOD)
- [ ] Console shows handled errors, not unhandled promises

---

## 7) Sort Order & Determinism
- [ ] Default sort: **Newest first** by `last_updated_at DESC, id DESC`
- [ ] Re-rendering same data doesn't reshuffle cards
- [ ] Pagination maintains stable order across pages

### SQL Verification (Run in TEST Supabase)
```sql
-- Should return stories in DESC order with ID tie-breaker
SELECT id, last_updated_at, primary_headline
FROM public.stories
WHERE status = 'active'
ORDER BY last_updated_at DESC, id DESC
LIMIT 50;
```

---

## 8) Performance & Resilience
- [ ] **Slow 3G throttle** (Chrome DevTools): List remains usable
- [ ] Quick tab switches (Stories → Political → Stories): No duplicate fetches
- [ ] Open/close modal 5 times: Memory stays stable (check Performance tab)
- [ ] Interactions remain responsive (no lag >500ms)

---

## 9) Console Quick Checks
Open browser console and run:

```javascript
// Verify components loaded
console.log('StoryFeed:', window.StoryComponents?.StoryFeed);
console.log('StoryCard:', window.StoryComponents?.StoryCard);
console.log('StoryAPI:', window.StoryAPI);

// Count rendered cards
console.log('Story cards on page:', document.querySelectorAll('[data-test="story-card"]').length);

// Check tablist ARIA
console.log('Tablist present:', !!document.querySelector('[role="tablist"]'));
console.log('Active tab has aria-selected=true:', 
  document.querySelector('[role="tab"][aria-selected="true"]') !== null
);
```

Expected output:
- All components should be `function` types (not undefined)
- Story card count should be ≤30 initially
- Tablist and ARIA checks should be true

---

## 10) Timezone & Timestamp Behavior
- [ ] "2 hours ago" reflects event time from `last_updated_at`
- [ ] Time is computed using browser's `Date.now()` (local time)
- [ ] API returns ISO UTC timestamps (verify with Network tab)
- [ ] Optional: Timestamps update live after 60s (not implemented in v1)

---

## Success Criteria
✅ All sections 1-9 pass with no critical issues  
✅ ARIA roles/labels complete and functional  
✅ `data-test` attributes present for automation  
✅ Grid breakpoints match spec (3/2/1 cols)  
✅ No regressions in Political/Executive tabs  
✅ Smooth navigation across all 3 tabs  

---

## Issues Found
### Critical (Blocks Release)
- [ ] None

### Major (Fix Before Release)
- [ ] None

### Minor (Fix in Polish Phase)
- [ ] None

---

## Testing Notes
_Use this space for observations, edge cases, or behavior questions_

---

**Tester**: Josh  
**Result**: ☐ Pass  ☐ Fail  
**Date Completed**: _________________

---

## Playwright Automation (Optional)
After manual testing passes, run automated smoke test:

```bash
# Install Playwright if needed
npm install -D @playwright/test

# Create test file: tests/story-tab.spec.ts
# Copy test code from expert review document

# Run test
npx playwright test tests/story-tab.spec.ts
```

# Story Tab Integration - Testing Checklist

## Environment: TEST
**Test URL**: https://[your-test-netlify-url].netlify.app/

## Pre-Test Verification
- [ ] Commit all changes to `test` branch
- [ ] Push to GitHub
- [ ] Wait for Netlify deployment to complete
- [ ] Confirm TEST Supabase has stories data (86+ stories expected)

---

## Test Checklist

### 1. Page Load
- [ ] Page loads without errors
- [ ] Browser console shows no critical errors
- [ ] **Stories tab is selected by default** (red background)
- [ ] Tab shows "Stories" with no count initially

### 2. Story Feed Display
- [ ] Story cards display in 3-column grid (desktop)
- [ ] Each card shows:
  - [ ] Primary headline
  - [ ] Category badge (e.g., "Democracy & Elections")
  - [ ] Severity badge with spicy label (e.g., "Fucking Treason" not "Critical")
  - [ ] Source count (e.g., "Sources (3)")
  - [ ] Spicy summary text
  - [ ] Timestamp (relative, e.g., "2 hours ago")
  - [ ] "View Sources" and "Read More" buttons

### 3. Story Card Interactions
- [ ] Click "View Sources" opens modal with article list
- [ ] Modal shows all source articles
- [ ] Modal closes with X button
- [ ] Modal closes with Escape key
- [ ] "Read More" button is clickable

### 4. Pagination/Load More
- [ ] If >30 stories, "Load More" button appears
- [ ] Clicking "Load More" loads next batch
- [ ] Loading state shows during fetch

### 5. Tab Switching
- [ ] Click "Political Entries" tab → switches correctly
- [ ] Click "Executive Orders" tab → switches correctly
- [ ] Click back to "Stories" tab → stories still display
- [ ] Filters/Stats sections ONLY show on Political/Executive tabs
- [ ] Filters/Stats sections HIDDEN on Stories tab

### 6. Mobile Responsive (resize browser to <768px)
- [ ] Grid collapses to single column
- [ ] Cards remain readable
- [ ] Buttons are touch-friendly (44x44px+)
- [ ] No horizontal scroll

### 7. Error Handling
- [ ] If no stories exist, shows empty state message
- [ ] If API fails, shows error with retry button
- [ ] Network errors don't crash the page

### 8. Data Validation
- [ ] Story data matches TEST database
- [ ] Severity labels are spicy (not technical)
- [ ] Categories are properly formatted
- [ ] Timestamps are accurate
- [ ] No "undefined" or "null" text visible

---

## Expected Story Count
**TEST Environment**: ~86 stories with 350+ articles

---

## Issues to Report

### Critical (Blocks Testing)
- [ ] Stories tab doesn't load
- [ ] Page crashes/white screen
- [ ] Can't switch between tabs

### Major (Impacts UX)
- [ ] Story cards missing data
- [ ] Buttons don't work
- [ ] Layout breaks on mobile
- [ ] Wrong severity labels showing

### Minor (Polish Items)
- [ ] Styling inconsistencies
- [ ] Performance slow (>3s load)
- [ ] Missing loading states

---

## Quick Debug Commands

### Check if Story components loaded:
Open browser console and type:
```javascript
console.log('StoryFeed:', window.StoryComponents?.StoryFeed);
console.log('StoryCard:', window.StoryComponents?.StoryCard);
console.log('StoryAPI:', window.StoryAPI);
```

### Check active stories in database:
```sql
SELECT COUNT(*) FROM stories WHERE status = 'active';
```

---

## Success Criteria
✅ All items checked in sections 1-7
✅ No critical or major issues
✅ Stories display with real data from TEST environment
✅ Can navigate between all 3 tabs smoothly

---

**Testing Date**: _________________
**Tester**: Josh
**Result**: ☐ Pass  ☐ Fail (see issues above)

# Unified Search/Filter Architecture - Session Handoff
**Date:** 2025-10-09
**Session Context:** TTRC-193 UI refinements → New work: Unified search across tabs
**Status:** Planning phase complete, ready for implementation
**Related JIRA:** TTRC-193 (completed), TTRC-194 (new - to be created)

---

## Executive Summary

User wants **consistent search/filter UI across all tabs** (Stories, Executive Orders). Currently:
- ✅ Stories tab has clean pill-based search/filter
- ❌ Executive Orders tab has old dropdown-based filters (different UX)
- ❌ Political Entries tab (hidden) also has old filters

**Goal:** Single reusable search component that adapts to each tab's data model while maintaining identical visual design.

---

## Architectural Analysis

### Current State Assessment

**What Works Well:**
1. **StoryFeed component** (public/story-feed.js) has excellent search UX:
   - Left-aligned search bar with pill shape
   - Horizontal category pills (compact text-xs sizing)
   - Client-side filtering with 300ms debounce
   - Clean visual hierarchy
   - No severity/sort clutter

2. **Data Models:**
   - Stories: `category` field (11 enum values)
   - Executive Orders: `eo_impact_type` field (4 enum values)
   - Political Entries: `severity` field (4 enum values)

**What Needs Refactoring:**

1. **dashboard-filters.js** - Old module with dropdown-heavy UI:
   - Search input + multiple dropdowns (category, date range, sort, severity)
   - Collapsible filter section (unnecessary complexity)
   - Different visual language from Stories tab
   - **Decision: Deprecate this module entirely**

2. **Inconsistent Search Logic:**
   - Stories: Self-contained in StoryFeed component
   - Executive Orders: Uses DashboardFilters module + filterUtils
   - **Problem:** Two different filter implementations = maintenance nightmare

3. **No Component Reusability:**
   - Search/filter logic duplicated between modules
   - Visual styling inconsistent
   - Props pattern not established

---

## Proposed Architecture

### Design Principles

1. **Single Source of Truth:** One component handles all tab search/filter
2. **Data-Driven Configuration:** Component receives filter config as props
3. **Visual Consistency:** Identical styling across all tabs
4. **Tab-Specific Logic:** Smart filtering based on tab type
5. **Performance:** Debounced search, memoized filters, client-side only

### Component Structure

```
TabSearchFilter (new component in dashboard-components.js)
├── Props:
│   ├── searchTerm (string)
│   ├── onSearchChange (function)
│   ├── selectedFilter (string) - currently selected pill
│   ├── onFilterChange (function)
│   ├── filterConfig (object) - defines available filters per tab
│   └── placeholder (string) - search bar placeholder text
│
├── Renders:
│   ├── Search bar (left-aligned, rounded-full, bg-white)
│   └── Filter pills row (horizontal flex, gap-3, text-xs)
│
└── Behavior:
    ├── No internal state (controlled component)
    ├── No debouncing (parent handles it)
    └── Pure presentation logic
```

### Filter Configuration Schema

```javascript
// In dashboard.js - define configs per tab
const FILTER_CONFIGS = {
  stories: {
    filterKey: 'category',
    allLabel: 'All Categories',
    filters: [
      { value: 'corruption_scandals', label: 'Corruption & Scandals' },
      { value: 'democracy_elections', label: 'Democracy & Elections' },
      // ... all 11 categories
      { value: 'other', label: 'Other' } // Always last
    ]
  },

  executive: {
    filterKey: 'eo_impact_type',
    allLabel: 'All Types',
    filters: [
      { value: 'fascist_power_grab', label: 'Fascist Power Grab', color: 'red' },
      { value: 'authoritarian_overreach', label: 'Authoritarian Overreach', color: 'orange' },
      { value: 'corrupt_grift', label: 'Corrupt Grift', color: 'yellow' },
      { value: 'performative_bullshit', label: 'Performative Bullshit', color: 'green' }
    ]
  },

  political: { // Future use if re-enabled
    filterKey: 'severity',
    allLabel: 'All Severity',
    filters: [
      { value: 'critical', label: 'Fucking Treason', color: 'red' },
      { value: 'high', label: 'Criminal Bullshit', color: 'orange' },
      { value: 'medium', label: 'Swamp Shit', color: 'yellow' },
      { value: 'low', label: 'Clown Show', color: 'green' }
    ]
  }
};
```

### Search Logic Architecture

**Current Problem:** Stories tab loads all stories and filters client-side. Executive Orders uses server pagination + client filtering hybrid.

**Proposed Solution:** Standardize on **client-side filtering for all tabs**

**Rationale:**
- Dataset size: Stories ~86, Executive Orders ~717 (manageable in browser)
- UX benefit: Instant filter response, no loading states
- Simplicity: One filtering pattern across all tabs
- Cost: Zero (no API calls)

**Implementation:**

```javascript
// In dashboard.js - unified filter function
function applyUnifiedFilters(data, searchTerm, selectedFilter, filterKey) {
  let filtered = [...data];

  // 1. Search filter (searches across title, summary fields)
  if (searchTerm.trim()) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(item =>
      item.title?.toLowerCase().includes(term) ||
      item.summary?.toLowerCase().includes(term) ||
      item.spicy_summary?.toLowerCase().includes(term) ||
      item.description?.toLowerCase().includes(term)
    );
  }

  // 2. Category/Type filter
  if (selectedFilter !== 'all') {
    filtered = filtered.filter(item => item[filterKey] === selectedFilter);
  }

  // 3. Default sort: Most recent first
  filtered.sort((a, b) => {
    const dateA = new Date(a.date || a.last_updated_at);
    const dateB = new Date(b.date || b.last_updated_at);
    return dateB - dateA;
  });

  return filtered;
}
```

---

## Implementation Plan

### Phase 1: Create TabSearchFilter Component

**File:** `public/dashboard-components.js`

**Location:** Add after LoadingOverlay component (~line 634)

**Component Code:**

```javascript
// ==================== Component: TabSearchFilter ====================
window.DashboardComponents.TabSearchFilter = ({
  searchTerm,
  onSearchChange,
  selectedFilter,
  onFilterChange,
  filterConfig,
  placeholder = 'Search...'
}) => {
  return React.createElement(
    'div',
    { className: 'mb-4' },

    // Search Bar
    React.createElement(
      'div',
      { className: 'mb-3' },
      React.createElement('input', {
        type: 'text',
        placeholder: placeholder,
        value: searchTerm,
        onChange: (e) => onSearchChange(e.target.value),
        className: 'w-full md:w-96 px-6 py-2 bg-white text-gray-800 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'
      })
    ),

    // Filter Pills
    React.createElement(
      'div',
      { className: 'flex items-center gap-3 flex-wrap' },

      // "All" button
      React.createElement(
        'button',
        {
          onClick: () => onFilterChange('all'),
          className: `px-3 py-1 rounded-full text-xs font-medium transition-all ${
            selectedFilter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-800 border border-gray-300 hover:border-blue-500'
          }`
        },
        filterConfig.allLabel
      ),

      // Individual filter buttons
      filterConfig.filters.map(filter =>
        React.createElement(
          'button',
          {
            key: filter.value,
            onClick: () => onFilterChange(filter.value),
            className: `px-3 py-1 rounded-full text-xs font-medium transition-all ${
              selectedFilter === filter.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-800 border border-gray-300 hover:border-blue-500'
            }`
          },
          filter.label
        )
      )
    )
  );
};
```

**Export:** Add to DashboardComponents exports

### Phase 2: Update Dashboard.js

**File:** `public/dashboard.js`

**Changes Required:**

1. **Add filter state** (around line 140):
```javascript
// Unified search/filter state (replaces old filters object)
const [searchTerm, setSearchTerm] = useState('');
const [selectedFilter, setSelectedFilter] = useState('all');
const searchDebounceRef = useRef(null);
```

2. **Add FILTER_CONFIGS** constant (after imports, ~line 90):
```javascript
// Filter configurations per tab
const FILTER_CONFIGS = {
  executive: {
    filterKey: 'eo_impact_type',
    allLabel: 'All Types',
    placeholder: 'Search executive orders...',
    filters: [
      { value: 'fascist_power_grab', label: 'Fascist Power Grab' },
      { value: 'authoritarian_overreach', label: 'Authoritarian Overreach' },
      { value: 'corrupt_grift', label: 'Corrupt Grift' },
      { value: 'performative_bullshit', label: 'Performative Bullshit' }
    ]
  }
  // Add 'political' config later if tab is re-enabled
};
```

3. **Add debounced filter handler** (after state declarations):
```javascript
// Handle search with debouncing
const handleSearchChange = useCallback((value) => {
  setSearchTerm(value);

  if (searchDebounceRef.current) {
    clearTimeout(searchDebounceRef.current);
  }

  searchDebounceRef.current = setTimeout(() => {
    // Filtering happens in useEffect below
  }, 300);
}, []);

// Apply filters when search/filter changes
useEffect(() => {
  if (activeTab === 'executive') {
    const config = FILTER_CONFIGS.executive;
    const filtered = applyUnifiedFilters(
      allExecutiveOrders,
      searchTerm,
      selectedFilter,
      config.filterKey
    );

    // Paginate filtered results
    const paginated = filtered.slice(0, EO_ITEMS_PER_PAGE);
    setExecutiveOrders(paginated);
    setTotalEoPages(Math.ceil(filtered.length / EO_ITEMS_PER_PAGE));
    setEoPage(1);
  }
}, [searchTerm, selectedFilter, allExecutiveOrders, activeTab]);
```

4. **Replace FilterSection with TabSearchFilter** (around line 474):
```javascript
// OLD CODE (remove):
{activeTab !== 'stories' && (
  <FilterSection
    filters={filters}
    onFilterChange={handleFilterChange}
    // ... props
  />
)}

// NEW CODE:
{activeTab === 'executive' && (
  <TabSearchFilter
    searchTerm={searchTerm}
    onSearchChange={handleSearchChange}
    selectedFilter={selectedFilter}
    onFilterChange={setSelectedFilter}
    filterConfig={FILTER_CONFIGS.executive}
    placeholder={FILTER_CONFIGS.executive.placeholder}
  />
)}
```

5. **Remove old FilterSection import** (line 65):
```javascript
// DELETE THIS:
const {
  FilterSection,
  filterUtils
} = window.DashboardFilters || {};
```

6. **Remove old filter state** (line 151):
```javascript
// DELETE THIS:
const [filters, setFilters] = useState(filterUtils.getDefaultFilters());
```

7. **Reset filters on tab change**:
```javascript
// In onTabChange handler
onTabChange={(tab) => {
  setActiveTab(tab);
  setSearchTerm(''); // Reset search
  setSelectedFilter('all'); // Reset filter
  // ... rest of tab change logic
}}
```

### Phase 3: Remove Deprecated Code

**File:** `public/dashboard-filters.js`

**Action:** Delete entire file (no longer needed)

**File:** `public/index.html`

**Action:** Remove script tag loading dashboard-filters.js:
```html
<!-- DELETE THIS LINE: -->
<script src="dashboard-filters.js"></script>
```

**File:** `public/dashboard.js` (line 11)

**Action:** Remove from module requirements:
```javascript
// DELETE from requiredModules array:
{ name: 'DashboardFilters', path: 'dashboard-filters.js' }
```

---

## Data Migration Notes

### Executive Orders Data Structure

**Relevant Fields:**
- `title` (string) - Primary search field
- `summary` (string) - Neutral summary (search field)
- `spicy_summary` (string) - Spicy translation (search field)
- `eo_impact_type` (enum) - Filter field
  - Values: `fascist_power_grab`, `authoritarian_overreach`, `corrupt_grift`, `performative_bullshit`
- `date` (timestamptz) - Sort field
- `order_number` (integer) - Display field

**Current Data Sample:**
```sql
SELECT eo_impact_type, COUNT(*)
FROM executive_orders
GROUP BY eo_impact_type;

-- Expected distribution:
-- fascist_power_grab: ~180
-- authoritarian_overreach: ~200
-- corrupt_grift: ~150
-- performative_bullshit: ~187
```

**Note:** User mentioned "we don't have categories [yet]" for EOs. The `eo_impact_type` field serves as the category equivalent.

---

## Testing Strategy

### Manual QA Checklist

**Executive Orders Tab:**
- [ ] Search bar appears left-aligned, rounded pill shape
- [ ] Search filters across title, summary, spicy_summary fields
- [ ] Search has 300ms debounce (typing doesn't lag)
- [ ] Filter pills display: All Types, Fascist Power Grab, Authoritarian Overreach, Corrupt Grift, Performative Bullshit
- [ ] Pills are text-xs size, px-3 py-1 padding
- [ ] Active filter has blue background
- [ ] Inactive filters have white background with border
- [ ] Hover on inactive pills shows blue border
- [ ] Clicking filter updates results immediately
- [ ] Clicking "All Types" shows all results
- [ ] Combining search + filter works correctly
- [ ] Pagination updates when filters change
- [ ] Page resets to 1 when filters change
- [ ] Results count accurate

**Tab Switching:**
- [ ] Switching from Stories → Executive Orders clears previous search
- [ ] Switching from Executive Orders → Stories clears previous search
- [ ] Filter pills change appropriately per tab
- [ ] No console errors during tab switching

**Edge Cases:**
- [ ] Search with no results shows "No results found" message
- [ ] Filter with no results shows "No results found" message
- [ ] Search + filter with no results shows appropriate message
- [ ] Empty search term shows all results
- [ ] Special characters in search don't break (test: quotes, apostrophes, ampersands)

**Performance:**
- [ ] Initial load time unchanged (client-side filtering = instant)
- [ ] No visible lag when typing in search
- [ ] Filter clicks feel instant
- [ ] Page doesn't freeze with all 717 EOs loaded

---

## Rollback Plan

If unified search causes issues:

1. **Quick Fix:** Comment out TabSearchFilter in dashboard.js, restore old FilterSection
2. **File Restore:** `git checkout HEAD~1 -- public/dashboard-filters.js`
3. **Re-add script tag** in index.html
4. **Revert dashboard.js changes**

**Files to revert:**
- public/dashboard.js (filter state + TabSearchFilter usage)
- public/dashboard-components.js (remove TabSearchFilter component)
- public/index.html (restore dashboard-filters.js script tag)

---

## Performance Considerations

### Memory Impact

**Before:**
- Stories tab: ~86 items loaded client-side
- Executive Orders tab: ~25 items per page, paginated server-side

**After:**
- Stories tab: ~86 items (unchanged)
- Executive Orders tab: ~717 items loaded client-side

**Analysis:**
- Each EO object: ~2KB (title, summaries, metadata)
- Total memory: 717 * 2KB = ~1.4MB
- Modern browser limit: 2GB+ per tab
- **Verdict:** Negligible impact, well within limits

### Rendering Performance

**Concern:** Filtering 717 items on every keystroke?

**Mitigation:**
1. 300ms debounce (prevents excessive re-renders)
2. Memoized filter results (React.useMemo)
3. Pagination (only renders 25 items max)
4. Virtual scrolling NOT needed (small DOM size)

**Expected Performance:**
- Search filter time: <10ms for 717 items
- Re-render time: <50ms for 25 cards
- Total latency: <60ms (imperceptible to user)

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| EO dataset grows to 5000+ items | Slow filtering | Low | Add virtualization or server-side search |
| Filter config becomes complex | Hard to maintain | Medium | Extract to separate config file |
| Tab-specific logic creeps into component | Breaks reusability | Medium | Strict props interface, no tab awareness in component |
| Old FilterSection has hidden dependencies | Breaking changes | Low | Full regression test before deleting |
| Search doesn't match user expectations | Poor UX | Low | QA test with sample searches first |

---

## Success Metrics

**User Experience:**
- ✅ Search/filter UI identical across Stories and Executive Orders tabs
- ✅ Filter pills fit on one row (text-xs sizing)
- ✅ Search feels instant (<300ms perceived latency)
- ✅ Visual consistency maintained (white pills, blue active state)

**Code Quality:**
- ✅ Single reusable TabSearchFilter component
- ✅ dashboard-filters.js module deleted (300+ lines removed)
- ✅ Consistent client-side filtering pattern
- ✅ No code duplication between tabs

**Maintainability:**
- ✅ Adding new tabs requires only config addition
- ✅ Filter logic centralized in one function
- ✅ Component props clearly defined
- ✅ No breaking changes to Stories tab

---

## Open Questions for User

1. **Political Entries Tab:** Currently hidden. When re-enabled, should it use severity filters (Fucking Treason, Criminal Bullshit, etc)?
2. **Filter Pill Colors:** Should EO impact type pills have colored backgrounds like severity pills? (e.g., Fascist Power Grab = red background)
3. **Search Placeholder:** "Search executive orders..." or just "Search..."?
4. **Stats Section:** Currently shows below filters for Political/Executive tabs. Keep or remove?
5. **Results Count:** Should we show "Showing X of Y results" below filters like Stories tab used to?

---

## Next Session Checklist

**Before Starting:**
- [ ] Read this handoff document completely
- [ ] Review JIRA TTRC-194 for any user comments
- [ ] Check if user answered open questions above

**Implementation Order:**
1. [ ] Create TabSearchFilter component in dashboard-components.js
2. [ ] Add FILTER_CONFIGS to dashboard.js
3. [ ] Add search/filter state to dashboard.js
4. [ ] Add applyUnifiedFilters function to dashboard.js
5. [ ] Replace FilterSection with TabSearchFilter in Executive Orders tab
6. [ ] Test thoroughly (use checklist above)
7. [ ] Remove dashboard-filters.js and cleanup imports
8. [ ] Commit with descriptive message
9. [ ] Update JIRA TTRC-194 to Done
10. [ ] Create handoff doc if any issues arise

**Estimated Effort:** 45-60 minutes (including testing)

---

## Technical Debt Created

1. **StoryFeed Still Independent:** Stories tab doesn't use TabSearchFilter yet. Future work: migrate StoryFeed to use shared component.
2. **No Category Management:** Filter configs hardcoded in dashboard.js. Future: Extract to central config file.
3. **No A/B Testing Support:** User mentioned eventual A/B test between layouts. Current architecture doesn't support this.

---

## References

**Key Files:**
- `/public/dashboard-components.js` - Component location
- `/public/dashboard.js` - Main integration point
- `/public/story-feed.js` - Reference implementation for search UX
- `/public/dashboard-filters.js` - To be deleted

**Related JIRA:**
- TTRC-193: Frontend polish with RSS enrichment (completed)
- TTRC-194: Unified search/filter across tabs (new)

**Database Schema:**
- Executive Orders: `eo_impact_type` enum field
- Stories: `category` enum field (11 values)
- Political Entries: `severity` enum field (4 values)

---

**Handoff Created By:** Claude Code
**Session End:** 2025-10-09
**Token Usage:** ~89,000 / 200,000 (44.5%)

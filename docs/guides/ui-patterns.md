# TrumpyTracker UI Patterns Guide

**Created:** 2025-12-30
**Last Updated:** 2026-01-12
**Status:** Active standard for all new UI work

This document defines UI patterns established in the theme preview implementation (TTRC-334) that should be followed for all future frontend development.

---

## File Structure

```
public/
├── index.html          # Stories page (main entry)
├── executive-orders.html  # EO page
├── app.js              # Stories components (React)
├── eo-app.js           # EO components (React)
├── shared.js           # Shared utilities
├── themes.css          # CSS variables (light/dark)
└── supabase-config.js  # Environment-aware config
```

---

## CSS Patterns

### 1. CSS Variable Naming

All theme-aware styles use CSS custom properties with this naming convention:

```css
/* Page-level */
--page-bg: #ffffff;
--page-text: #1f2937;

/* Cards */
--card-bg: #ffffff;
--card-border: #e5e7eb;
--card-shadow: 0 1px 3px rgba(0,0,0,0.1);

/* Text hierarchy */
--text-headline: #111827;
--text-body: #374151;
--text-muted: #6b7280;
--text-secondary: #9ca3af;

/* Interactive */
--text-link: #1d4ed8;
--text-link-hover: #1e40af;

/* Semantic colors */
--severity-critical: #dc2626;
--severity-severe: #ea580c;
--severity-moderate: #ca8a04;
--severity-minor: #16a34a;
```

### 2. Component Class Naming

All component classes use `tt-` prefix (TrumpyTracker):

```css
.tt-header { }
.tt-card { }
.tt-modal-overlay { }
.tt-detail-modal { }
.tt-btn { }
.tt-btn-primary { }
.tt-dropdown { }
.tt-filter-bar { }
```

### 3. Theme Toggle

Theme is stored in localStorage and applied immediately to prevent FOUC:

```html
<!-- In <head> before any CSS -->
<script>
  (function() {
    const saved = localStorage.getItem('tt-theme');
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
```

CSS uses attribute selector:
```css
:root { /* light theme defaults */ }
[data-theme="dark"] { /* dark overrides */ }
```

---

## JavaScript Patterns

### 1. React Without JSX

We use `React.createElement` directly (no build step):

```javascript
// Component definition
function MyComponent({ title, onClick }) {
  return React.createElement('div', { className: 'tt-card' },
    React.createElement('h2', null, title),
    React.createElement('button', { onClick }, 'Click me')
  );
}

// Usage
React.createElement(MyComponent, { title: 'Hello', onClick: handleClick })
```

### 2. State Management

Use React hooks for local state:

```javascript
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);
```

For refs that shouldn't trigger re-renders:
```javascript
const openedViaPush = useRef(false);
const closingRef = useRef(false);
```

### 3. Shared Utilities (TTShared)

All shared functions are exposed via `window.TTShared`:

```javascript
// URL/History
TTShared.getUrlParam('story')
TTShared.setUrlParam('story', id)      // replaceState
TTShared.pushUrlParam('story', id)     // pushState
TTShared.removeUrlParam('story')

// Storage
TTShared.getLocalStorage('key', defaultValue)
TTShared.setLocalStorage('key', value)
TTShared.getSessionStorage('key', defaultValue)
TTShared.setSessionStorage('key', value)

// Scroll lock (for modals)
TTShared.lockScroll()
TTShared.unlockScroll()

// Caching
TTShared.getCachedArticles(storyId)
TTShared.setCachedArticles(storyId, data)
TTShared.clearArticlesCache()

// Data helpers
TTShared.formatActorName('US-ERIC-ADAMS')  // → 'Eric Adams'
TTShared.getCategoryLabel('corruption_scandals')
TTShared.getSeverityLabel('critical')
TTShared.timeAgo(isoDate)
TTShared.formatDate(isoDate)

// API
TTShared.supabaseRequest('stories?select=id,title&limit=10')
```

---

## Modal Patterns

### 1. Required A11y Attributes

```javascript
React.createElement('div', {
  className: 'tt-modal-overlay',
  role: 'dialog',
  'aria-modal': 'true',
  'aria-labelledby': 'modal-headline-id'
}, /* content */)
```

### 2. Scroll Lock

Always lock body scroll when modal opens:

```javascript
// On open
TTShared.lockScroll();

// On close
TTShared.unlockScroll();
```

CSS for modal content:
```css
.tt-detail-modal {
  overflow-y: auto;
  overscroll-behavior: contain;  /* Prevents rubber-band on iOS */
}
```

### 3. Close Behavior

Support multiple close methods:
- Escape key
- Backdrop click
- Close button
- Browser back button

```javascript
// Escape key
useEffect(() => {
  const handleEsc = (e) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('keydown', handleEsc);
  return () => document.removeEventListener('keydown', handleEsc);
}, [onClose]);

// Backdrop click
onClick: (e) => e.target === e.currentTarget && onClose()
```

### 4. Deep Linking

Modals support URL params for sharing:

```javascript
// Track how modal was opened
const openedViaPush = useRef(false);

// Open from click → push to history
TTShared.pushUrlParam('story', id);
openedViaPush.current = true;

// Open from URL (deep link) → don't push
openedViaPush.current = false;

// Close
if (openedViaPush.current) {
  history.back();  // Go back in history
} else {
  TTShared.removeUrlParam('story');  // Just update URL
}
```

**Race Condition Guard:**
```javascript
const closingRef = useRef(false);

// Before closing
closingRef.current = true;

// In deep-link useEffect
if (closingRef.current) return;  // Skip if closing

// After close completes
setTimeout(() => { closingRef.current = false; }, 50);
```

---

## Filter Patterns

### 1. Filter Bar Layout

Standard filter bar has 3 rows:

```
Row 1: [🔍 Search...        ] [Category ▼] [Sort ▼]
Row 2: [All] [Option1] [Option2] ... (severity/status pills)
Row 3: X results (of Y)  [Filter: X] [Clear all]
```

CSS classes:
- `.tt-filters` - Main container
- `.tt-filters-row` - Row for search + dropdowns
- `.tt-severity-filters` - Row for pills
- `.tt-filters-status` - Row for results + chips

### 2. Search Input (No Button)

Search uses Enter-to-submit, no explicit button:

```javascript
React.createElement('div', { className: 'tt-search-wrapper' },
  React.createElement('span', { className: 'tt-search-icon' }, '🔍'),
  React.createElement('input', {
    type: 'text',
    className: 'tt-search',
    placeholder: 'Search...',
    value: searchTerm,
    onChange: (e) => setSearchTerm(e.target.value),
    onKeyDown: (e) => e.key === 'Enter' && handleSearch()
  }),
  searchTerm && React.createElement('button', {
    className: 'tt-search-clear',
    onClick: clearSearch
  }, '×')
)
```

### 3. Pill Filters (Severity/Status)

Use text labels, not numbers. Always include "All" option first:

```javascript
const SEVERITY_PILLS = [
  { value: null, label: 'All' },
  { value: 'critical', label: 'Critical', color: '#dc2626' },
  { value: 'severe', label: 'Severe', color: '#ea580c' },
  // ...
];

React.createElement('div', { className: 'tt-severity-filters' },
  React.createElement('span', { className: 'tt-filter-label' }, 'Severity:'),
  SEVERITY_PILLS.map(({ value, label, color }) =>
    React.createElement('button', {
      className: `tt-severity-pill ${selected === value ? 'active' : ''}`,
      onClick: () => setSelected(value),
      style: selected === value && color ? { backgroundColor: color } : {}
    }, label)
  )
)
```

### 4. Native Dropdowns

Use native `<select>` for accessibility:

```javascript
React.createElement('select', {
  className: 'tt-dropdown',
  value: category || 'all',
  onChange: (e) => setCategory(e.target.value === 'all' ? null : e.target.value)
},
  React.createElement('option', { value: 'all' }, 'All Categories'),
  // ... more options
)
```

### 5. Active Filter Chips

Show active filters as removable chips:

```javascript
hasActiveFilters && React.createElement('div', { className: 'tt-active-filters' },
  selectedFilter && React.createElement('span', { className: 'tt-filter-chip' },
    `Filter: ${filterLabel}`,
    React.createElement('button', {
      className: 'tt-chip-remove',
      onClick: () => clearFilter()
    }, '×')
  ),
  React.createElement('button', {
    className: 'tt-clear-all',
    onClick: clearAllFilters
  }, 'Clear all')
)
```

### 6. State Persistence

| State | Storage | Scope |
|-------|---------|-------|
| Theme | localStorage | Cross-session |
| Filters | URL params | Shareable/bookmarkable |
| Search | URL params | Shareable/bookmarkable |

**Prefer URL params for filters** - allows deep linking and sharing.

### 7. Empty State

Always provide recovery:

```javascript
if (filteredItems.length === 0) {
  return React.createElement('div', { className: 'tt-empty-state' },
    'No results found.',
    React.createElement('button', { onClick: clearFilters }, 'Clear filters')
  );
}
```

---

## External Links

All external links must have security attributes:

```javascript
React.createElement('a', {
  href: article.url,
  target: '_blank',
  rel: 'noopener noreferrer'
}, 'Read article ↗')
```

---

## Data Normalization

### Severity Mapping

```javascript
const SEVERITY_LABELS = {
  critical: 'Fucking Treason',
  severe: 'Criminal Bullshit',
  moderate: 'Swamp Shit',
  minor: 'Clown Show'
};
```

### Category Mapping

```javascript
const CATEGORY_LABELS = {
  corruption_scandals: 'Corruption & Scandals',
  democracy_elections: 'Democracy & Elections',
  // ... see theme-shared.js for full list
};
```

### Actor Name Formatting

```javascript
// Convert entity codes to display names
formatActorName('US-ERIC-ADAMS')  // → 'Eric Adams'
formatActorName('ORG-FBI')        // → 'Fbi' (needs entities table for proper names)
```

---

## Supabase Queries

Use PostgREST syntax:

```javascript
// Basic query
await TTShared.supabaseRequest('stories?select=id,title&limit=10');

// With filters
await TTShared.supabaseRequest('stories?status=eq.active&order=last_updated_at.desc');

// Specific fields only (minimize egress!)
await TTShared.supabaseRequest('articles?select=id,title,url,published_at&story_id=eq.123');
```

**NEVER fetch `embedding` or `content` fields unless absolutely necessary!**

---

## Caching Strategy

Articles are cached per-story with LRU eviction:

```javascript
const CACHE_MAX_SIZE = 50;

// Check cache first
const cached = TTShared.getCachedArticles(storyId);
if (cached) {
  // Use cached data
  return;
}

// Fetch and cache
const data = await fetchArticles(storyId);
TTShared.setCachedArticles(storyId, { articles: data, error: null });
```

---

## Error Handling

### Loading States

```javascript
if (loading) {
  return React.createElement('div', { className: 'tt-loading' },
    React.createElement('div', { className: 'tt-spinner' }),
    React.createElement('p', null, 'Loading...')
  );
}
```

### Error States

```javascript
if (error) {
  return React.createElement('div', { className: 'tt-error' },
    React.createElement('p', null, 'Failed to load data.'),
    React.createElement('button', { onClick: retry }, 'Retry')
  );
}
```

---

## Future Considerations

1. **Entities Table (TTRC-338):** Replace `formatActorName()` with DB lookup
2. **Mobile UI (TTRC-337):** Simplify layout for small screens
3. **Playwright Tests:** Automate critical paths (deep-link, Esc close)
4. **Build Step:** Consider Vite/esbuild if complexity grows

---

## Related Tickets

- TTRC-334: Theme Preview V2 - UI Iteration (DONE)
- TTRC-335: Promote Theme Preview to Main Frontend
- TTRC-337: Mobile UI Simplification
- TTRC-338: Create entities table for actor display names

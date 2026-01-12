# Theme Preview Iteration Plan

**Date:** 2025-12-27
**Status:** Planning
**Branch:** test

## User Requests Summary

1. Fix "Read More" button (card footer) - currently does nothing
2. UX review of filters - pills vs dropdowns, optimization
3. Clarify two "Read More" behaviors - inline expand vs full detail
4. Add Executive Orders page with new theme styling
5. Add placeholder tabs for Supreme Court & Merchandise

---

## Issue Analysis

### 1. Read More Button (BROKEN)

**Current State:**
- **Inline "Read More"** (in summary) - WORKS - toggles `expanded` state
- **Card Footer "Read More"** - NO onClick handler, does nothing

**Code Location:** `public/theme-preview.js` lines 257-260
```javascript
// Current (broken)
React.createElement('button', { className: 'tt-read-more' },
  'Read More',
  React.createElement('span', null, ' →')
)
// Missing: onClick handler
```

---

### 2. Filter UX Analysis

**Current Theme Preview:**
- Search input + 11 category pills horizontally
- All pills visible at once

**Current EO Page:**
- Search + Category dropdown + Action Tier dropdown + Date Range dropdown
- Much cleaner, scales better

**UX Issues with Current Pill Approach:**
| Problem | Impact |
|---------|--------|
| 11 pills crowds UI | Visual clutter, overwhelms user |
| Long category names | Wrapping on mobile, inconsistent widths |
| Not scalable | Adding more filters = more chaos |
| No grouping | All categories appear equally important |

**Recommendation:** Hybrid approach
- Keep search bar (prominent)
- Dropdown for category (11 options too many for pills)
- Optional: 2-3 quick-filter pills for common actions (severity-based?)

---

### 3. Two "Read More" Behaviors

**Proposed UX Model:**

| Element | Action | Purpose |
|---------|--------|---------|
| Inline "Read more →" | Expands summary in-place | Quick scan without leaving feed |
| Card "Read More" button | Opens full story modal | Deep dive with all sources |

**Both serve different purposes - keep both.**

**Story Detail Modal Should Show:**
- Full headline
- Primary actor + severity badge + category
- Full summary (not truncated)
- All source articles (current modal functionality)
- Last updated timestamp

---

### 4. Executive Orders - Field Audit

**Current EO Page Fields:**
| Field | Current EO | New Theme Needed? |
|-------|-----------|-------------------|
| order_number | Yes | Yes |
| title | Yes | Yes |
| date | Yes | Yes |
| category | Yes (pill) | Yes |
| eo_impact_type | Yes (colored pill) | Yes |
| severity | Yes | Yes |
| section_what_it_means | Yes (truncated) | Yes |
| section_what_they_say | Detail only | Detail modal |
| section_reality_check | Detail only | Detail modal |
| section_why_it_matters | Detail only | Detail modal |
| action_tier | Yes (pill) | Yes |
| source_url | Yes | Yes |
| affected_agencies | Detail only | Optional |

**New Theme EO Card Design:**
- Match story card aesthetic (serif headlines, cream blocks, etc.)
- EO badge prominent
- Impact type color-coded
- Quick actions visible

---

### 5. Tab Navigation

**Current Tabs:** Stories | Executive Orders
**Future Tabs:** + Supreme Court | + Merchandise

**Design Options:**

| Option | Pros | Cons |
|--------|------|------|
| Horizontal pills | Familiar, current pattern | May overflow on mobile with 4+ tabs |
| Scrolling tabs | Scales infinitely | Hides options, less discoverable |
| Dropdown overflow | Clean on mobile | Extra click for hidden items |
| Icon + text tabs | Compact, visual | Needs good icons |

**Recommendation:** Horizontal pills with responsive collapse
- Desktop: All tabs visible as pills
- Mobile: Hamburger or dropdown for overflow

---

## Implementation Plan (Final)

### MUST-HAVES (Non-Negotiable)

| # | Item | Why |
|---|------|-----|
| 1 | Fix footer button onClick + rename labels | Button literally does nothing; two "Read More"s = confusion |
| 2 | Modal loading/error/empty states | Without it, modal feels broken |
| 3 | Modal close behavior (Esc, backdrop, scroll lock) | Minimum to avoid "stuck" feelings |
| 4 | Replace 11 pills with native `<select>` | Pills broken on mobile + don't scale |
| 5 | "Clear all" + zero-results recovery | Prevents filter trap |
| 6 | Tabs as real `<a>` nav links | Don't over-engineer; mobile must not overflow |
| 7 | Deep-linking done correctly OR dropped | Half-implemented = worse than none |

**Decision on #7:** Plan includes correct pushState/replaceState logic. Keep deep-linking.

**Decision on #6:** Tabs use `?tab=scotus`/`?tab=merch` for Coming Soon panels (already planned). Consistent approach.

---

### Phase 0: UX Guardrails (Do First)
**Files:** `public/theme-preview.js`, `public/themes.css`, `public/theme-shared.js` (new)

**0.1 Label Clarity - Fix "Read More" Confusion**
| Control | Old Label | New Label | Icon |
|---------|-----------|-----------|------|
| Inline (summary) | "Read more →" | "Expand summary" / "Show less" | chevron-down ▼ / chevron-up ▲ |
| Footer button | "Read More →" | "View details" | external/open icon ↗ |

**0.2 Modal A11y Checklist (Both Story + EO Modals)**

**MUST-HAVE (cheap, prevents real breakage):**
- [ ] Esc key closes modal
- [ ] Backdrop click closes modal
- [ ] Scroll lock on body while open (restore on close)
- [ ] `overscroll-behavior: contain` on modal (prevent scroll rubber-band)
- [ ] `role="dialog"` + `aria-modal="true"` (prevents screen reader reading page behind)
- [ ] `aria-labelledby` pointing to modal headline

**NICE-TO-HAVE (full a11y, defer if needed):**
- [ ] Focus trap inside modal (tab cycles within)
- [ ] `aria-busy="true"` during loading
- [ ] Tab order: close button reachable first or second
- [ ] Return focus to trigger button on close
- [ ] `prefers-reduced-motion`: skip modal animations

**0.3 Modal Loading/Error/Empty States**
- Loading: Skeleton UI immediately on open (don't show empty modal)
- Error: Clear message + "Retry" button (cache error state too)
- Empty: "No source links available for this story yet" (not blank list)

**0.4 Modal URL Deep-linking + History**

**URL Param Precedence (avoids weird states):**
```
Priority:
1. ?story=X (or ?eo=X) → open modal (takes precedence)
2. ?tab=scotus (or ?tab=merch) → show Coming Soon panel
3. Neither → show normal feed

Examples:
  ?story=123              → modal open
  ?tab=scotus             → Coming Soon panel
  ?tab=scotus&story=123   → modal open (story wins)
```

**History Behavior:**
```javascript
// Track HOW modal was opened
let openedViaPushState = false;

// Open modal from user click:
  → Guard: if modal already open for this ID, do nothing (prevent double-push)
  → Preserve existing ?tab= if present
  → history.pushState({ modal: 'story', id: X }, '', `?story=${id}${tabParam}`)
  → openedViaPushState = true

// Open modal from deep link (page load with ?story=X):
  → Fetch story by ID, open modal
  → openedViaPushState = false  // didn't push, so don't pop

// Close modal:
  → Remove ?story= but KEEP ?tab= if it was present
  → if (openedViaPushState) history.back()
  → else replaceState to remove ?story= only
  → openedViaPushState = false

// Back button pressed (popstate event):
  → Close modal (doesn't navigate away from page)
```

**Edge case - deep-link to story not in current results:**
→ Fetch story by ID directly (separate API call)
→ If not found: "Story not found" + "Go to all stories" CTA

**0.5 Filter UX Essentials**
- Active filters row: chips showing current filters (e.g., `Category: Justice & Legal ✕`)
- "Clear all" button (appears when any filter active)
- Preserve search text when changing category/severity
- **Results count** (shows filtered/total): `"3 stories (of 124)"`
- **Empty state with recovery:**
  - `"0 stories (of 124) — Clear all filters"`
  - Context-aware: "Remove severity filter" if that's the culprit

**0.6 Filter Defaults (Explicit)**
| Filter | Default | Persist? |
|--------|---------|----------|
| Category | All | Within session |
| Severity | All | Within session |
| Sort | Most recent update | Within session |
| Search | Empty | Within session |

**0.7 Sort Field Mapping (Story-Level Fields Only)**
```javascript
// RULE: Never fetch articles just to sort. Use story fields only.

// Most recent update - when story was last touched
mostRecentUpdate = story.last_updated_at
                   || story.updated_at
                   || story.created_at

// Newest created - when story first appeared
newestCreated = story.created_at

// Tie-breaker: story.id (deterministic)
```
*Do NOT use `articles.map(...)` — would force extra fetches for sort.*

**0.8 Data Normalization**
- Normalize severity to UI set: `critical | severe | moderate | minor`
- Map API values → normalized before filtering
- Same for categories: display labels vs stored enum values

**0.9 Cross-Page State Persistence**
| State | Storage | Scope |
|-------|---------|-------|
| Theme (light/dark) | `localStorage` | Cross-session |
| Last visited tab | `localStorage` | Cross-session |
| Search text | `sessionStorage` | Within session only |
| Category filter | `sessionStorage` | Within session only |
| Severity filter | `sessionStorage` | Within session only |
| Sort order | `sessionStorage` | Within session only |

*Note: sessionStorage = cleared when tab closes. No "why did my filters stick from yesterday?" bugs.*

**0.10 Article Caching (with eviction)**
```javascript
const CACHE_MAX_SIZE = 50;
const storyArticlesCache = new Map(); // preserves insertion order

function cacheArticles(storyId, data) {
  // Evict oldest if at capacity
  if (storyArticlesCache.size >= CACHE_MAX_SIZE) {
    const oldest = storyArticlesCache.keys().next().value;
    storyArticlesCache.delete(oldest);
  }
  storyArticlesCache.set(storyId, data); // { articles, error, loading }
}

// Second open = instant
// Error state cached too (for "Retry" to work correctly)
// Prevents "left tab open all day and it's sluggish"
```

**0.11 External Links (Security + UX)**
All source links that open new tabs MUST have:
```html
<a href="..." target="_blank" rel="noopener noreferrer">
  Article Title ↗
</a>
```
- `target="_blank"` = opens in new tab
- `rel="noopener noreferrer"` = security (prevents tab hijacking)

**0.12 Primary Source Badge (Deterministic Rule)**
```javascript
// Pick primary source consistently:
function isPrimarySource(article, story) {
  // 1. If API provides is_primary_source flag, use it
  if (article.is_primary_source === true) return true;

  // 2. Otherwise: earliest published article wins
  // (consistent, deterministic, not random fetch order)
  return article.id === story.primary_article_id
      || article.published_at === earliestPublishedAt;
}
```
*Never show "Primary" badge on random items based on fetch order.*

**0.13 Dropdowns: Use Native `<select>` for v1**
```html
<!-- Native select = free a11y (keyboard nav, screen reader, mobile) -->
<select class="tt-dropdown" value={category} onChange={...}>
  <option value="all">All Categories</option>
  <option value="corruption_scandals">Corruption & Scandals</option>
  ...
</select>
```
- Can still style with CSS (appearance, colors, padding)
- Custom dropdowns are a11y rabbit holes — save for v2 if needed

**0.14 Shared Helpers (DRY)**
Create `public/theme-shared.js` with reusable utilities:
- `createModal()` - modal shell + a11y behavior
- `useModalHistory()` - query param open/close + popstate
- `useLocalStorage()` / `useSessionStorage()` - persistence helpers
- `normalizeFilters()` - severity/category mapping
- `focusTrap()` - a11y focus management
- `isPrimarySource()` - deterministic primary badge logic

---

### Phase 1: Story Detail Modal
**Files:** `public/theme-preview.js`, `public/themes.css`

1. Create `StoryDetailModal` component with:
   - Full headline (large, serif) - used for `aria-labelledby`
   - Actor + severity badge + category pill
   - Full summary text (not truncated)
   - Sources list (simple, no grouping for v1):
     - Flat list sorted by published time (newest first)
     - Each row: outlet name + published time + title (linked)
     - "Primary" badge on primary source
     - External link icon ↗ (opens new tab)
     - *Future: group by outlet (naming inconsistency rabbit hole)*
   - Close button (top-right, keyboard accessible)
2. Add state: `selectedStory`, `showDetailModal`, `modalLoading`, `modalError`
3. Wire "View details" button → opens modal, fetches articles
4. Use `storyArticlesCache` from Phase 0.10 (instant on second open)
5. Implement all Phase 0 a11y requirements
6. **Deep-linking:** Support `?story=<id>` URL param
   - On load: if param present, fetch story by ID and open modal
   - On close: `history.back()` or `replaceState` to remove param
   - Handle "story not found" edge case

---

### Phase 2: Filter Redesign
**Files:** `public/theme-preview.js`, `public/themes.css`

1. Replace 11 category pills with native `<select>` dropdown (Phase 0.13)
2. Add 3 severity quick-filter pills: "All" | "Critical" | "Severe"
3. Layout: `[Search] [Category <select>] [Severity Pills] [Sort <select>]`
4. Add sort control: "Most recent update" | "Newest created" (native select)
5. Results count: `"3 stories (of 124)"` - updates live
6. Active filters row below (chips with ✕ remove)
7. "Clear all filters" button (appears when any filter active)
8. Empty state: `"0 stories (of 124) — Clear all filters"`
9. Wire all filter logic with normalization from Phase 0.8
10. Use `sessionStorage` for filter persistence (Phase 0.9)
11. Mobile: filters stack/wrap cleanly

---

### Phase 3: Tab Navigation + Placeholders
**Files:** `public/theme-preview.js`, `public/themes.css`

**Use nav links, NOT ARIA tabs** (EO is separate page, Coming Soon uses ?tab= param):
```html
<nav role="navigation" class="tt-tabs">
  <a href="/theme-preview.html" class="tt-tab active">Stories</a>
  <a href="/eo-theme-preview.html" class="tt-tab">Executive Orders</a>
  <a href="?tab=scotus" class="tt-tab">Supreme Court</a>
  <a href="?tab=merch" class="tt-tab">Merchandise</a>
</nav>
```

**Behavior:**
- Stories + EO = real page links (separate HTML files)
- Supreme Court + Merchandise = clickable, set `?tab=scotus` / `?tab=merch`
- When `?tab=` present, render "Coming Soon" panel in content area:
  ```
  ┌─────────────────────────────────────┐
  │  🚧 Supreme Court Tracker           │
  │  Coming Soon                        │
  │                                     │
  │  Track Supreme Court decisions      │
  │  and their impact on democracy.     │
  │                                     │
  │  [← Back to Stories]                │
  └─────────────────────────────────────┘
  ```
- Feels intentional, not "greyed out forever"

1. Normal `<a>` elements styled as tabs (no ARIA tablist)
2. Current page/tab = `active` class
3. Check URL on load: if `?tab=scotus` or `?tab=merch`, show placeholder panel
4. Style active/inactive/hover states for both themes
5. Persist last visited tab to localStorage
6. Mobile: horizontal scroll if needed

---

### Phase 4: Executive Orders Page (New Theme)
**New files:** `public/eo-theme-preview.html`, `public/eo-theme-preview.js`

1. Copy theme-preview.html structure, adapt for EO
2. Create `EOCard` component matching story card aesthetic:
   - EO number badge (prominent)
   - Title (serif headline)
   - Date + category + impact type pills (color-coded)
   - Truncated summary (section_what_it_means)
   - "View analysis" button (not "Read More")
3. Filters: Search + Category dropdown + Action Tier dropdown + Date Range dropdown + Sort
4. Active filters row + Clear all
5. Create `EODetailModal` with:
   - All 4 analysis sections (What They Say, What It Means, Reality Check, Why It Matters)
   - Action section (tier-aware)
   - Full a11y from Phase 0
6. **Deep-linking:** Support `?eo=<id>` URL param
7. Tab navigation (same component, EO tab active)
8. Both light/dark themes
9. Mobile: modal goes full-screen with sticky header (title + close)

---

### Phase 5: Polish Pass
1. Test all keyboard navigation
2. Test screen reader announcements
3. Verify deep-links work on refresh
4. Verify state persists across page navigation
5. Mobile responsive check on all views

---

## User Decisions (Confirmed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Story Detail Modal | Full story detail | headline, actor, category, severity, FULL summary, all sources |
| Filter Redesign | Native `<select>` + severity pills | Free a11y, styled with CSS |
| Tab Placeholders | Clickable with `?tab=` param | Click → shows Coming Soon panel in content area |
| EO Navigation | Separate HTML file | Modularity - `eo-theme-preview.html` as standalone page |
| Button Labels | Differentiated | Inline: "Expand summary ▼" / Footer: "View details ↗" |
| Deep-linking | URL params + history | `?story=<id>`, `?eo=<id>`, proper Back button behavior |
| Storage | Split localStorage/sessionStorage | Theme = cross-session, filters = session-only |

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `public/theme-shared.js` | Create | Shared utilities (modal, history, localStorage, filters) |
| `public/theme-preview.js` | Modify | Add StoryDetailModal, filter redesign, tab nav |
| `public/themes.css` | Modify | Modal + dropdown + tab + a11y styling |
| `public/eo-theme-preview.html` | Create | EO page with new theme |
| `public/eo-theme-preview.js` | Create | EO components (card, modal, filters) |

**Reference files (read-only):**
- `public/executive-orders.html` - Current EO structure to replicate
- `public/eo-page.js` - Current EO fetch/filter logic
- `public/story-card.js` - Current modal pattern

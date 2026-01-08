# TTRC-221: Executive Order Detail Page - Implementation Plan

**Date:** 2025-10-17
**Status:** Ready to Implement
**JIRA:** [TTRC-221](https://ajwolfe37.atlassian.net/browse/TTRC-221)
**Epic:** [TTRC-16 - Executive Orders Tracker](https://ajwolfe37.atlassian.net/browse/TTRC-16)
**Effort:** 5-6 hours
**Branch:** `test`

---

## Overview

Create a **dedicated detail page** for individual executive orders that displays the full 4-part editorial analysis. Users click cards from the dashboard or EO list page to view the full analysis on a standalone page.

### Key Design Decisions (Locked)

1. **All 4 sections visible by default** - NO accordion, NO truncation, NO expand/collapse
2. **"What It Actually Means" shows in full** - No longer clipped in header/teaser
3. **Breadcrumb navigation** - "Executive Orders → EO {order_number}"
4. **Action box tier-aware**:
   - Tier 1/2 (direct, systemic): Show validated actions with icons
   - Tier 3 (tracking): Hide actions, show small "Tracking only" note
5. **Mobile-first responsive** - Full content readable on all devices

---

## What We're Building

### 1. New Detail Page: `public/eo-detail.html`

**Purpose:** Standalone page for single EO display
**URL Pattern:**
- `/eo-detail.html?id=<eo_id>` (by database ID)
- `/eo-detail.html?order=<order_number>` (by order number, e.g., `?order=14333`)

**Features:**
- Full-screen layout optimized for reading long-form content
- Breadcrumb navigation at top
- Back button (uses browser history or fallback)
- OG meta tags for social sharing
- Semantic HTML for accessibility

### 2. New JavaScript Module: `public/eo-detail.js`

**React-based component with:**

#### Header Section
- **Breadcrumb:** "Executive Orders → EO {order_number}"
  - First link returns to `/executive-orders.html`
  - Second crumb is non-clickable (current page)
- **EO Badge:** Color-coded by severity (red/orange/yellow/gray)
- **Title:** `<h1>` with full order title
- **Metadata Pills:**
  - Category label (e.g., "Immigration & Border")
  - Severity level (Critical/Severe/Moderate/Minor)
  - Signed date (formatted)
  - Affected agencies (first 3, comma-separated)
- **Action Buttons:**
  - Share (Web Share API or clipboard fallback)
  - View Official Order → (external link to WhiteHouse.gov)
  - Back button

#### Body - 4-Part Analysis (All Fully Visible)

**No accordions. No truncation. All sections render in full.**

1. **📜 What They Say** (`section_what_they_say`)
   - Official language/government spin
   - Full text displayed

2. **🔍 What It Actually Means** (`section_what_it_means`)
   - Plain English translation
   - Full text displayed (no excerpt)

3. **✅ Reality Check** (`section_reality_check`)
   - Fact verification and analysis
   - Full text displayed

4. **⚠️ Why This Matters** (`section_why_it_matters`)
   - Long-term implications and impact
   - Full text displayed

#### Action Section (Conditional)

**Tier-Aware Display:**

- **Tier 1 (direct) / Tier 2 (systemic):**
  - Show "What We Can Do" section
  - Display action items with icons:
    - 💰 Donate → `type: 'support'`
    - 📞 Call → `type: 'call'`
    - ⚖️ Legal → `type: 'legal'`
    - 🗳️ Vote → `type: 'vote'`
    - 📢 Organize → `type: 'organize'`
  - Only show actions with **validated URLs or phone numbers**
  - Link external URLs with `target="_blank" rel="noopener noreferrer"`

- **Tier 3 (tracking):**
  - Hide action section entirely
  - Show small note: "🔍 Tracking only — no direct actions right now."

### 3. Update Existing Components

#### `public/dashboard-components.js` - ExecutiveOrderCard

**Changes:**
- Make entire card clickable → navigate to detail page
- Update "Read more →" to "View Full Analysis →"
- Add hover effect and visual cue (→ icon)
- onClick handler: `window.location.href = /eo-detail.html?id=${order.id}`

#### `public/eo-page.js` - EO List Page Cards

**Changes:**
- Update ExecutiveOrderCard instances to navigate to detail page
- Store return URL in sessionStorage for back button fallback

---

## Navigation Flow

```
Dashboard EO Tab → Click card → EO Detail Page
       ↑                              ↓
       └──────── Back button ──────────┘

EO List Page (/executive-orders.html) → Click card → EO Detail Page
       ↑                                                ↓
       └──────────── Back button ─────────────────────┘
```

**Back Button Logic:**
1. Try `history.back()` if history length > 1
2. Fallback: Check `sessionStorage.getItem('eoReturnTo')`
3. Final fallback: `/executive-orders.html`

---

## Technical Specifications

### Color Coding (Severity)

**Database Value → Display:**
- `critical` → Red badge (`bg-red-600 text-white`)
- `severe` → Orange badge (`bg-orange-600 text-white`)
- `moderate` → Yellow badge (`bg-yellow-600 text-white`)
- `minor` → Gray badge (`bg-gray-600 text-white`)

**Ring/Border Classes:**
- Critical: `ring-red-500`
- Severe: `ring-orange-500`
- Moderate: `ring-yellow-500`
- Minor: `ring-gray-500`

### Section Icons & Headings

```
📜 <h2>What They Say</h2>
🔍 <h2>What It Actually Means</h2>
✅ <h2>Reality Check</h2>
⚠️ <h2>Why This Matters</h2>
```

### Action Type Icon Mapping

```javascript
const ACTION_ICONS = {
  support: '💰',  // Donate/support organizations
  call: '📞',     // Call representatives
  legal: '⚖️',    // Legal actions
  vote: '🗳️',     // Voting/elections
  organize: '📢'  // Community organizing
};
```

### Database Schema Reference

**Fields Used:**
```javascript
{
  id: number,
  order_number: string,
  title: string,
  date: string (YYYY-MM-DD),
  source_url: string (WhiteHouse.gov link),
  severity: string (critical|severe|moderate|minor),
  category: string (enum),
  affected_agencies: string[],
  action_tier: string (direct|systemic|tracking),
  section_what_they_say: text,
  section_what_it_means: text,
  section_reality_check: text,
  section_why_it_matters: text,
  action_section: jsonb {
    title: string,
    actions: [{
      type: string,
      description: string,
      url: string,
      deadline: string (optional)
    }]
  },
  enriched_at: timestamp,
  prompt_version: string
}
```

### Accessibility Requirements

**ARIA & Semantic HTML:**
- Breadcrumb: `<nav aria-label="Breadcrumb">`
- Main heading: `<h1>` for EO title
- Section headings: `<h2>` for each of 4 parts
- Action list: `<ul>` with semantic list items
- External links: Include `rel="noopener noreferrer"`
- Keyboard navigation: All interactive elements focusable
- Focus management: Maintain logical tab order

**Heading Hierarchy:**
```html
<h1>Executive Order Title</h1>
  <h2>What They Say</h2>
  <h2>What It Actually Means</h2>
  <h2>Reality Check</h2>
  <h2>Why This Matters</h2>
  <h2>What We Can Do</h2> <!-- If applicable -->
```

### SEO & Social Sharing

**Open Graph Meta Tags:**
```html
<meta property="og:title" content="EO {order_number}: {title}">
<meta property="og:description" content="{first 200 chars of 'What It Means'}">
<meta property="og:url" content="{current page URL}">
<link rel="canonical" href="/executive-orders/{order_number}">
```

**Share Functionality:**
1. Try Web Share API (`navigator.share()`)
2. Fallback: Copy URL to clipboard
3. Alert user on success

---

## Files to Create

### 1. `public/eo-detail.html`
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Executive Order | TrumpyTracker</title>
  <link rel="canonical" id="canonical">
  <meta property="og:title" content="" id="og-title">
  <meta property="og:description" content="" id="og-desc">
  <meta property="og:url" content="" id="og-url">

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- React -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>

  <!-- Babel for JSX -->
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

  <style>
    /* Custom scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #1f2937; }
    ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
  </style>
</head>
<body class="bg-gray-900 text-gray-100">
  <main id="eo-root" class="mx-auto max-w-3xl p-4 min-h-screen"></main>

  <!-- Load dependencies -->
  <script src="supabase-browser-config.js"></script>
  <script src="dashboard-utils.js"></script>
  <script type="text/babel" src="eo-detail.js"></script>
</body>
</html>
```

### 2. `public/eo-detail.js`
Full React component with:
- URL parameter parsing (`?id=` or `?order=`)
- Supabase data fetching
- Breadcrumb rendering
- 4-section full display
- Tier-aware action section
- Share functionality
- Back button logic
- Error/loading states
- 404 handling for invalid IDs

---

## Files to Modify

### 1. `public/dashboard-components.js`

**ExecutiveOrderCard Component (line ~414):**

**Current:**
```javascript
return (
  <div className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 ...">
    {/* Card content */}
  </div>
);
```

**Updated:**
```javascript
const handleCardClick = () => {
  // Store return URL for back button
  sessionStorage.setItem('eoReturnTo', window.location.pathname);
  window.location.href = `/eo-detail.html?id=${order.id}`;
};

return (
  <div
    className="bg-gray-800/50 backdrop-blur-md rounded-lg p-6 ... cursor-pointer hover:border-blue-500"
    onClick={handleCardClick}
  >
    {/* Card content */}

    {/* Update "Read more" button */}
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCardClick();
      }}
      className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors"
    >
      View Full Analysis →
    </button>
  </div>
);
```

### 2. `public/eo-page.js`

**Update ExecutiveOrderCard usage (line ~408):**

```javascript
<ExecutiveOrderCard
  key={order.id}
  order={order}
  index={index}
  showShareButtons={true}
  onCardClick={(orderId) => {
    sessionStorage.setItem('eoReturnTo', '/executive-orders.html');
    window.location.href = `/eo-detail.html?id=${orderId}`;
  }}
/>
```

---

## Acceptance Criteria (Revised)

### Page Load & Navigation
- ✅ Page loads with `?id=<number>` parameter
- ✅ Page loads with `?order=<order_number>` parameter
- ✅ 404 state displays on invalid/missing ID
- ✅ Breadcrumb renders at top: "Executive Orders" → "EO {order_number}"
- ✅ "Executive Orders" link navigates to `/executive-orders.html`
- ✅ Back button works (browser history or fallback)

### Content Display
- ✅ All 4 sections fully visible, no expand/collapse, no truncation
- ✅ "What It Actually Means" rendered in full (no excerpt in header)
- ✅ Section headings use semantic `<h2>` tags with icons
- ✅ Empty sections handled gracefully (no console errors)

### Action Section
- ✅ Tier 1/2: Show "What We Can Do" with validated actions
- ✅ Tier 3: Hide actions, show "Tracking only" note
- ✅ Action icons display correctly based on type
- ✅ External action URLs open in new tab with security attributes

### Metadata & Styling
- ✅ Severity color coding via token map
- ✅ Category/agency/date pills render if present
- ✅ EO badge displays with correct severity color
- ✅ Ring/border matches severity level

### Accessibility
- ✅ Heading hierarchy: `<h1>` (title) then `<h2>` (sections)
- ✅ Breadcrumb uses `<nav aria-label="Breadcrumb">`
- ✅ Keyboard navigation works for all interactive elements
- ✅ Focus management maintains logical tab order
- ✅ Screen reader friendly (semantic HTML)

### Social & SEO
- ✅ Share button works (Web Share API or clipboard fallback)
- ✅ OG tags populated dynamically
- ✅ Canonical URL set to `/executive-orders/{order_number}`
- ✅ Page description uses first ~200 chars of "What It Means"

### Responsive Design
- ✅ Mobile responsive (320px+)
- ✅ Tablet optimized (768px+)
- ✅ Desktop layout (1024px+)
- ✅ No horizontal scroll on any device
- ✅ Touch targets minimum 44x44px

### Performance & Error Handling
- ✅ Loading state displays while fetching
- ✅ Error state with retry option
- ✅ No console errors if sections are empty
- ✅ Graceful handling of missing data

---

## Implementation Todo List

### Phase 1: Core Page Setup (1.5 hours)
- [ ] Create `public/eo-detail.html` with HTML shell
- [ ] Add Tailwind, React, Babel dependencies
- [ ] Add OG meta tags with dynamic ID attributes
- [ ] Add custom scrollbar styles
- [ ] Create `public/eo-detail.js` module skeleton
- [ ] Set up Supabase client connection
- [ ] Implement URL parameter parsing (`?id` and `?order`)
- [ ] Create data fetching function with error handling
- [ ] Implement 404 state for invalid IDs

### Phase 2: Layout & Components (2 hours)
- [ ] Build breadcrumb component with navigation
- [ ] Create header section with EO badge + title
- [ ] Add metadata pills (category, severity, date, agencies)
- [ ] Implement severity color mapping function
- [ ] Add action buttons (Share, View Official, Back)
- [ ] Create 4-section full-text display
- [ ] Add section icons (📜 🔍 ✅ ⚠️)
- [ ] Implement tier-aware action section
- [ ] Add action type icon mapping
- [ ] Style with Tailwind (responsive + dark theme)

### Phase 3: Functionality (1.5 hours)
- [ ] Implement Share button logic (Web Share API + fallback)
- [ ] Implement Back button logic (history + fallback)
- [ ] Set OG meta tags dynamically from EO data
- [ ] Add sessionStorage for return URL tracking
- [ ] Validate action URLs before rendering
- [ ] Handle empty sections gracefully
- [ ] Add loading state animation
- [ ] Add error state with retry button
- [ ] Test with enriched and non-enriched EOs

### Phase 4: Integration (1 hour)
- [ ] Update `ExecutiveOrderCard` in `dashboard-components.js`
- [ ] Make cards clickable → navigate to detail page
- [ ] Change "Read more" to "View Full Analysis →"
- [ ] Add hover effects and cursor pointer
- [ ] Store return URL in sessionStorage
- [ ] Update `eo-page.js` card click handlers
- [ ] Test navigation from dashboard
- [ ] Test navigation from EO list page
- [ ] Verify back button from both sources

### Phase 5: Testing & QA (1 hour)
- [ ] Test all URL parameter formats (`?id=`, `?order=`)
- [ ] Test 404 handling for invalid IDs
- [ ] Test breadcrumb navigation
- [ ] Test back button from different sources
- [ ] Test share functionality (desktop + mobile)
- [ ] Test on mobile devices (320px, 375px, 414px)
- [ ] Test on tablets (768px, 1024px)
- [ ] Test keyboard navigation
- [ ] Test screen reader compatibility
- [ ] Verify no console errors
- [ ] Test with empty/missing section data
- [ ] Test Tier 1/2/3 action section display
- [ ] Verify external links open correctly
- [ ] Check OG tags in social preview tools

### Phase 6: Documentation & Handoff (30 min)
- [ ] Update JIRA ticket with completion notes
- [ ] Create handoff document in `/docs/handoffs/`
- [ ] Document any edge cases discovered
- [ ] List follow-up tickets (TTRC-222, 223, 224)
- [ ] Update Confluence with screenshots
- [ ] Note any deviations from original spec

---

## Analytics Events (Optional)

**Page Events:**
- `eo_detail_open` - Fired when page loads
  - Properties: `order_number`, `source` (dashboard|list)
- `eo_breadcrumb_click` - Fired when breadcrumb clicked
- `eo_share_attempt` - Fired when share button clicked
  - Properties: `method` (native|clipboard)
- `eo_back_click` - Fired when back button clicked

**Engagement Events:**
- `eo_official_link_click` - External link clicked
- `eo_action_link_click` - Action item clicked
  - Properties: `action_type`, `has_url`

---

## PM Notes (User Impact)

### Why This Approach?

**Full Content Visible:**
- Reduces clicks and cognitive load
- Avoids hiding important context (builds trust)
- Better for accessibility (no accordion state management)
- Improves SEO (all content crawlable)

**Breadcrumbs:**
- Orient users within site structure
- Provide consistent escape hatch back to list
- Reduce bounce rate (clear navigation path)

**Tier-Aware Actions:**
- Only show actionable items (Tier 1/2)
- Prevents empty "What We Can Do" sections
- Sets clear expectations (Tier 3 = monitoring only)

### Success Metrics

**Watch for:**
- **Time on page:** Expect longer (2-4 min avg) due to full content
- **Scroll depth:** Track if users read all 4 sections
- **Bounce rate:** Should decrease with clear breadcrumb navigation
- **Share rate:** Track Web Share API usage vs clipboard fallback
- **Back button usage:** Validate navigation flow

**If bounce rises on mobile:**
- Consider sticky mini-TOC for long content
- Add "Jump to Actions" quick link
- Test collapsible sections A/B variant
- **But no need to implement now** ✅

---

## Follow-Up Tickets

### TTRC-222: EO Detail Page Filters
- Add category/tier filters on detail page
- "More EOs like this" recommendation section
- Related orders based on category/agencies

### TTRC-223: SEO Optimization
- Server-side rendering or static generation
- Rich snippets with structured data
- Improved meta descriptions per category

### TTRC-224: Deep Linking & Enhanced Sharing
- Pretty URLs: `/executive-orders/{order-number}/{slug}`
- Twitter Card meta tags
- Facebook OG image generation
- Native share to specific sections

---

## Technical Dependencies

### Required Files (Must Exist)
- ✅ `public/supabase-browser-config.js` - Supabase client setup
- ✅ `public/dashboard-utils.js` - Utility functions (formatDate, etc.)
- ✅ `public/dashboard-components.js` - Existing components

### Database Requirements
- ✅ `executive_orders` table with all enriched fields
- ✅ 185 enriched EOs available (from TTRC-219 backfill)
- ✅ Schema includes all 4 section fields

### External Dependencies
- Tailwind CSS (CDN)
- React 18 (CDN)
- Babel Standalone (CDN)
- Supabase JS client

---

## Risk Assessment

### Low Risk ✅
- Using proven React components from dashboard
- Database schema stable and tested
- Navigation patterns already established
- Supabase client connection reliable

### Medium Risk ⚠️
- Web Share API not supported in all browsers
  - **Mitigation:** Clipboard fallback implemented
- Long content may slow mobile load
  - **Mitigation:** React lazy loading, virtual scrolling if needed
- URL parameter handling edge cases
  - **Mitigation:** Validation + 404 handling

### No Blockers
- All dependencies met
- Schema complete
- Data backfilled
- Components reusable

---

## Cost Implications

**Direct Costs:** $0
- No new API calls
- No additional OpenAI usage
- Static page rendering

**Indirect Costs:** ~$5-6 hours dev time
- Matches TTRC-221 estimate
- No budget impact (<$50/month limit)

**Future Considerations:**
- If SSR/SSG needed (TTRC-223): Consider Netlify Functions (~$0)
- If OG image generation needed (TTRC-224): Consider Cloudinary free tier

---

## Definition of Done

- ✅ All acceptance criteria met
- ✅ Works on mobile, tablet, desktop
- ✅ Accessible (keyboard + screen reader)
- ✅ No console errors
- ✅ Share functionality works
- ✅ Navigation tested from all sources
- ✅ JIRA updated
- ✅ Handoff document created
- ✅ Code committed to `test` branch
- ✅ Deployed to Netlify test environment
- ✅ QA sign-off from Josh

---

**Last Updated:** 2025-10-17
**Author:** Claude Code + Josh
**Next Review:** After TTRC-221 implementation

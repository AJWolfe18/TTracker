# TrumpyTracker UI Design Brief for UX Designer AI

## Project Overview
TrumpyTracker is a political news aggregation platform that groups related articles into "stories" to reduce duplicate coverage. The site has a bold, unapologetic voice that validates reader frustration about political corruption. We need a fresh, modern UI that matches this energy while remaining professional and shareable.

## Brand Voice & Personality
- **Tone**: Angry but accurate, funny but factual
- **Audience**: Politically engaged citizens fed up with corruption
- **Goal**: Make truth viral, validate frustration, inspire action
- **Not**: Neutral, both-sides journalism or conspiracy theories

## Core UI Components Needed

### 1. Story Card (Collapsed State)
The main unit of content - shows one political story with multiple sources.

**Required Elements:**
- **Headline**: Primary story headline (bold, prominent, 18-24px)
- **Severity Badge**: Shows impact level with spicy label
  - 🔴 "Fucking Treason" (critical - red background)
  - 🟠 "Criminal Bullshit" (severe - orange background)
  - 🟡 "Swamp Shit" (moderate - yellow background)
  - 🟢 "Clown Show" (minor - green background)
- **Source Counter**: "5 sources, 12 articles" format
- **Time Indicator**: "Updated 2 hours ago" or "Breaking"
- **Summary Preview**: First 2 lines of spicy summary (italic or different weight)
- **Expand Button**: Chevron or plus icon to reveal more

**Visual Style:**
- Card with subtle shadow/border
- Clear visual hierarchy
- Severity badge prominent but not overwhelming
- Mobile-first responsive design

### 2. Story Card (Expanded State)
When user clicks expand, reveal additional content inline (not modal).

**Additional Elements:**
- **Full Spicy Summary**: 5-7 sentences of angry truth-telling
- **Article List**: Grouped by source
  ```
  CNN (3 articles)
  • "Trump Indicted Again" - 2 hours ago
  • "Legal Experts Weigh In" - 4 hours ago
  • "GOP Response Mixed" - 6 hours ago
  
  Washington Post (2 articles)
  • "Breaking: New Charges Filed" - 1 hour ago
  • "Timeline of Events" - 3 hours ago
  ```
- **Primary Source Button**: "Read Original Story" (opens primary_source_url)
- **Share Buttons**: Horizontal row
  - X/Twitter icon
  - Facebook icon
  - Copy Link icon
- **Topic Tags**: If present (e.g., #Corruption #DOJ #TrumpCrimes)
- **Collapse Button**: Same position as expand, rotated 180°

### 3. Story List/Feed View
Container for multiple story cards.

**Layout Requirements:**
- **Desktop**: Single column, max-width 800px, centered
- **Tablet**: Single column with padding
- **Mobile**: Full width with small margins
- **Spacing**: 16-24px between cards
- **Infinite Scroll**: Load more indicator at bottom

### 4. Header/Navigation
**Elements:**
- **Logo**: "TrumpyTracker" with bold font
- **View Toggle**: [Active Stories] | [Timeline] (like tabs)
- **Search Bar**: Prominent, "Search stories..."
- **Mobile**: Hamburger menu with search

### 5. Timeline View Filters
When "Timeline" is selected, show filter bar.

**Filter Components:**
- **Search Input**: Full-width on mobile
- **Date Range**: From/To date pickers
- **Severity Filter**: Multi-select dropdown with colored badges
- **Topic Filter**: Multi-select chips or dropdown
- **Status Toggle**: All | Active | Closed
- **Sort Dropdown**: Newest | Oldest | Recently Updated
- **Clear Filters**: Text button to reset all

**Mobile Behavior:**
- Collapse to single "Filters" button
- Opens filter panel/drawer from bottom

### 6. Status Indicators
**Active Story:**
- No special indicator (default state)
- Shows "Updated X ago"

**Closed Story:**
- Subtle gray overlay or border
- Text: "Closed on Dec 15" 
- Slightly reduced opacity

### 7. Loading & Empty States
**Loading:**
- Skeleton cards (3-4 visible)
- Pulsing animation
- Same height as real cards

**Empty State:**
- Friendly message: "No stories match your filters"
- Suggestion: "Try adjusting your filters or clearing them"
- Clear Filters button

**Error State:**
- Red/orange alert box
- Message: "Something went wrong loading stories"
- Retry button

## Data Fields Reference

### Story Object
```typescript
{
  id: string;
  primary_headline: string;           // Main display title
  primary_source: string;             // e.g., "CNN"
  primary_source_url: string;         // Link to original
  primary_source_domain: string;      // e.g., "cnn.com"
  severity: 'critical' | 'severe' | 'moderate' | 'minor';
  topic_tags: string[];               // ["Corruption", "DOJ"]
  source_count: number;               // Unique sources (5)
  article_count: number;              // Total articles (12)
  summary_neutral: string;            // Professional summary (hidden for now)
  summary_spicy: string;              // Angry truthful summary (always shown)
  last_updated_at: string;            // ISO timestamp
  first_seen_at: string;              // ISO timestamp
  status: 'active' | 'closed';        // Story state
  closed_at?: string;                 // When story was closed
  articles: Article[];                // Related articles array
}
```

### Article Object
```typescript
{
  id: string;
  title: string;                      // Article headline
  source_name: string;                // "CNN"
  source_domain: string;              // "cnn.com"
  url: string;                        // Full article URL
  published_at: string;               // ISO timestamp
  content_type: 'news_report' | 'opinion' | 'analysis' | 'editorial';
  excerpt?: string;                   // Brief description
}
```

## Interaction Patterns

### Expand/Collapse
- **Trigger**: Click anywhere on collapsed card (except links)
- **Animation**: Smooth height transition (200ms ease)
- **State**: Remembers expanded cards during session
- **Mobile**: Full-width expansion

### Infinite Scroll
- **Trigger**: When user scrolls to 80% of page height
- **Loading**: Show spinner below last card
- **End State**: "No more stories" message

### Share Flow
1. User clicks share button
2. For X/Twitter: Open share dialog with pre-filled text
3. For Facebook: Open share dialog with URL
4. For Copy: Copy formatted text, show toast "Copied!"

### Filter Behavior
- **Apply**: Instant on change (with debounce for search)
- **Combine**: All filters use AND logic
- **Persist**: Filters reflected in URL for bookmarking
- **Clear**: Resets all filters to default

## Mobile-Specific Considerations

### Touch Targets
- Minimum 44x44px for all interactive elements
- Adequate spacing between buttons
- Swipe gestures optional (not required)

### Responsive Breakpoints
- Mobile: < 768px (single column, full width)
- Tablet: 768px - 1024px (single column, centered)
- Desktop: > 1024px (single column, max 800px wide)

### Performance
- Lazy load images if present
- Virtual scrolling for very long lists
- Progressive enhancement (works without JS)

## Visual Design Direction

### Color Palette
- **Primary**: Dark blue/navy (#1e293b)
- **Backgrounds**: Light gray (#f8fafc) or white
- **Severity Colors**: Red, Orange, Yellow, Green (as badges)
- **Text**: Near-black (#0f172a) on light, white on dark
- **Borders**: Light gray (#e2e8f0)

### Typography
- **Headlines**: Bold, sans-serif (Inter, System UI)
- **Body**: Regular weight, good readability
- **Summary**: Slightly different (italic or lighter)
- **Badges**: Small caps or bold, high contrast

### Visual Style
- Clean, modern, news-like but not boring
- Clear information hierarchy
- Generous white space
- Subtle shadows for depth
- NO: Gradients, excessive animation, cluttered layouts

## Accessibility Requirements
- WCAG 2.1 AA compliant
- Keyboard navigable
- Screen reader friendly
- Color contrast 4.5:1 minimum
- Focus indicators visible
- Semantic HTML structure

## Deliverables Needed
1. **Mobile Design** (375px width)
   - Story feed with 3-4 cards
   - Expanded card state
   - Filter panel
   
2. **Desktop Design** (1440px width)
   - Story feed with cards
   - Expanded state
   - Timeline view with filters
   
3. **Component States**
   - Loading states
   - Empty states
   - Error states
   - Hover/focus states

4. **Interactive Prototype** (optional)
   - Expand/collapse animation
   - Filter interactions
   - Infinite scroll

## Examples to Avoid
- Traditional news sites (too boring)
- Reddit (too cluttered)
- Twitter/X (too chaotic)
- Medium (too minimal)

## Inspiration Direction
- The Guardian (clean cards)
- Axios (clear hierarchy)
- The Verge (bold typography)
- Substack (readable layouts)
- But with more personality and anger!

## Questions for Designer
Please provide:
1. Color variations for the severity badges that are bold but professional
2. Ideas for making the spicy summaries stand out visually
3. Suggestions for mobile gesture interactions
4. Thoughts on animation/micro-interactions that add personality
5. Alternative layouts if single-column feels too simple

## Success Metrics
- Users can scan 10+ stories quickly
- Clear what's new vs. old
- Share buttons get clicked
- Mobile experience feels native
- Site feels "angry but professional"

Remember: We're trying to make truth viral. The design should make people want to screenshot and share these stories!
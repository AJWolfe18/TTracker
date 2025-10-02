# TrumpyTracker UI Design Brief v2.1 - Story View Implementation

## Project Overview
TrumpyTracker is a political news aggregation platform that uses RSS feeds to group related articles into "stories", reducing duplicate coverage by ~40%. The backend RSS system is **COMPLETE** with 86 stories already clustered. We need UI components to display these grouped stories effectively.

## Current System Status
- **Backend**: ✅ Complete - RSS pipeline operational, 86 stories clustered
- **API**: ✅ Ready - `/api/v1/stories/active` returns grouped stories
- **Frontend**: 🚧 Needs building - Story View UI components required
- **Data Available**: Stories with headlines, summaries, severity, categories, source counts

## Brand Voice & Personality
- **Tone**: Angry but accurate, funny but factual
- **Audience**: Politically engaged citizens fed up with corruption
- **Goal**: Make truth viral, validate frustration, inspire action
- **Not**: Neutral journalism, conspiracy theories, or both-sides false equivalence
- **No AI mentions**: Don't reference AI, algorithms, or automated systems in UI

## Core UI Components Needed

### 1. Story Card Design
The main unit of content - shows one political story with multiple sources grouped together.

**Required Elements:**
- **Header Row**: 
  - Category badge (left, colored background)
  - Timestamp (right, gray text)
- **Headline**: Primary story headline (bold, prominent, 18-20px)
- **Actor/Topic Line**: 
  - Small icon (person/building)
  - "Main actor: [Actor Name]"
  - Severity badge inline (colored pill, no emoji)
- **Spicy Summary**: 
  - Always visible (no toggle/expansion)
  - Angry truthful take on the story
  - Subtle gray background (#f8f9fa)
  - 2-4 paragraphs, direct and punchy
  - Left border for visual distinction
- **Footer**:
  - Source count: "Sources (5): CNN WP NYT +2"
  - View Sources button (opens modal)
  - Read More button (primary CTA)

**Visual Style:**
- White cards on light gray (#f5f5f5) background
- 8px border radius
- Subtle shadow (0 1px 3px rgba(0,0,0,0.1))
- 16px padding
- Mobile-first responsive design

### 2. Severity System (Spicy Labels)
Display severity as colored pills with our branded labels:

**Severity Levels:**
- **Critical** → "FUCKING TREASON" (red #dc2626 background, white text)
- **Severe** → "CRIMINAL BULLSHIT" (orange #ea580c background, white text)
- **Moderate** → "SWAMP SHIT" (yellow #ca8a04 background, white text)
- **Minor** → "CLOWN SHOW" (green #16a34a background, white text)

**Style:**
- Small pills (padding: 4px 10px)
- Bold text (font-weight: 700)
- Font size: 11px
- ALL CAPS display (text-transform: uppercase)
- No emoji icons
- Inline with actor information

### 3. Category System Display
We have 11 specific categories that must be displayed correctly:

**Database Value → Display Name:**
1. `corruption_scandals` → "Corruption & Scandals"
2. `democracy_elections` → "Democracy & Elections"
3. `policy_legislation` → "Policy & Legislation"
4. `justice_legal` → "Justice & Legal"
5. `executive_actions` → "Executive Actions"
6. `foreign_policy` → "Foreign Policy"
7. `corporate_financial` → "Corporate & Financial"
8. `civil_liberties` → "Civil Liberties"
9. `media_disinformation` → "Media & Disinformation"
10. `epstein_associates` → "Epstein & Associates"
11. `other` → "Other"

**Visual Treatment:**
- Small badge in top-left of card
- Subtle colored backgrounds (pastels)
- Font size: 11px
- Text transform: uppercase
- Should be filterable (click to filter)

### 4. Story Feed Layout
Container for multiple story cards.

**Grid Layout:**
- **Desktop**: 3-column grid (gap: 20px)
- **Tablet**: 2-column grid
- **Mobile**: Single column
- **Max width**: 1400px centered
- **Padding**: 24px

### 5. Navigation
**Simple Tab Structure:**
- Stories (default view)
- Executive Orders
- NO Analytics or other tabs

### 6. Sources Modal
When "View Sources" clicked, show modal overlay.

**Modal Design:**
- White modal on dark semi-transparent overlay
- Max width: 600px
- Shows all articles for the story
- Each source shows:
  - Source name (e.g., "CNN Politics")
  - Timestamp
  - Article title
  - "Read →" link
- Close button (X) in top right

### 7. Summary Display Guidelines

**Summary Presentation:**
- **Always show spicy summary** - no toggles or buttons
- **No mention of "AI" or "generated"** - summaries are just part of the content
- **Visual style**: Subtle gray background that doesn't compete with other elements
- **Tone**: Angry, truthful, calling out the BS
- **Length**: 2-4 paragraphs visible by default

**Summary Generation Logic (Backend):**
- First high-tier source creates initial summary
- Incorporates details from all sources in cluster
- Does NOT regenerate as new sources arrive (cost control)
- Synthesis happens at story creation time only

## Data Fields Available (Backend Reality)

### Story Object
```typescript
{
  id: number;
  primary_headline: string;            // Main story title
  summary_spicy: string;               // The angry truthful summary (ALWAYS SHOWN)
  summary_neutral?: string;            // Not used in UI
  severity: 'critical' | 'severe' | 'moderate' | 'minor';
  category?: string;                   // One of 11 categories
  topic_tags?: string[];               // Additional tags (future use)
  source_count: number;                // Number of unique sources
  status: 'active' | 'closed';         
  last_updated_at: string;             // ISO timestamp
  first_seen_at: string;               // When first detected
  
  // From article_story join:
  articles?: Article[];                // Related articles
}
```

## Mockup-Inspired Design Direction

Based on the provided mockups, the design follows this clean, professional approach:

### Card Layout
- **White cards** on light gray (#f5f5f5) background
- **8px border radius** on all cards
- **16px padding** inside cards
- **16-24px gap** between cards
- **3-column grid** on desktop (single column on mobile)

### Story Card Structure (Top to Bottom)
1. **Header Row**: Category badge (left) | Timestamp (right)
2. **Headline**: Large (20-24px), bold, 2-3 lines max
3. **Main Topic**: Small text with icon and severity badge
4. **Spicy Summary**: Always visible, subtle background
5. **Footer**: Sources count | View Sources | Read More

### Color Coding
- **Categories**: Subtle pastel backgrounds for badges
- **Severity**: Strong colors for impact level
- **Text**: Dark gray for body, black for headlines
- **Background**: Light gray for page, white for cards

## What NOT to Include

### Remove These Elements:
- ❌ "AI Summary" or any AI references
- ❌ Toggle buttons for summary types
- ❌ Neutral/professional summaries
- ❌ Analytics tab or dashboard
- ❌ Share buttons (Phase 3)
- ❌ User authentication UI (Phase 3)
- ❌ Comment system (not planned)

### Defer to Later Phases:
- Article View toggle (Phase 3)
- Share functionality (Phase 3)
- Editorial structure expansion (Phase 3)
- Advanced filtering (Phase 2)

## Success Metrics
- Users can scan 20+ stories quickly
- Spicy severity labels grab attention (UPPERCASE)
- Summaries convey anger and truth
- Mobile experience feels native
- Professional appearance despite angry content

## Technical Implementation Notes
- Using vanilla JavaScript (no React/Vue)
- Supabase for backend (already configured)
- Stories are pre-clustered by backend
- API returns paginated results (30 per page)
- Categories use underscore format in database
- No summary regeneration on updates (cost control)
- Severity labels MUST be uppercase

## Accessibility Requirements
- WCAG 2.1 AA compliant
- Keyboard navigable
- Screen reader friendly
- Color contrast 4.5:1 minimum
- Semantic HTML structure
- Focus indicators visible

Remember: We're showing the unfiltered truth about political corruption. The design should feel professional enough to be credible, but angry enough to match the content!
# TrumpyTracker Story View - Junior Developer Implementation Guide v2

## Project Overview
You'll be building a news aggregation interface that displays political stories. Each "story" groups multiple articles about the same topic. The backend is complete - you just need to build the frontend.

## What You're Building
A responsive web page that shows political news stories in cards, similar to Google News but with an angry, truthful tone about political corruption.

## Getting Started

### 1. Review These Files First
```
/public/story-view-prototype.html   # Working prototype to copy from
/docs/ui-design-prompt-v2.1.md     # Complete design specifications
/docs/database/database-schema.md   # Backend data structure
```

### 2. Set Up Your Environment
```bash
# Clone the repo
git clone [repository-url]
cd TTracker

# Switch to test branch
git checkout test

# Install dependencies
npm install

# Get environment variables from team lead
# You need: SUPABASE_URL and SUPABASE_ANON_KEY
# NEVER commit these keys - add to .gitignore
```

### 3. API Endpoint Contract (LOCKED)

**Single endpoint for all story fetching:**

```javascript
GET {SUPABASE_URL}/rest/v1/stories
  ?status=eq.active
  &select=id,primary_headline,summary_spicy,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at
  &order=last_updated_at.desc,id.desc
  &limit=30
  &offset={page * 30}

Headers:
{
  "apikey": "{SUPABASE_ANON_KEY}",
  "Authorization": "Bearer {SUPABASE_ANON_KEY}",
  "Content-Type": "application/json",
  "Prefer": "count=exact"
}
```

## Step-by-Step Implementation

### Step 1: Create the HTML Structure
Start with `/public/dashboard.html` and add:

```html
<!-- Add this to the existing dashboard.html -->
<div id="storyView" class="story-view-container">
  <!-- Loading skeleton -->
  <div id="loadingState" class="loading-skeleton">
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  </div>
  
  <!-- Error state -->
  <div id="errorState" class="error-banner" style="display: none;">
    <p>Failed to load stories. Please try again.</p>
    <button onclick="retryLoad()">Retry</button>
  </div>
  
  <!-- Stories grid -->
  <div class="stories-grid" id="storiesGrid" style="display: none;">
    <!-- Story cards will be inserted here by JavaScript -->
  </div>
  
  <!-- Load more -->
  <button id="loadMoreBtn" class="btn-primary" style="display: none;">Load More Stories</button>
</div>

<!-- Sources Modal -->
<div class="modal-overlay" id="sourcesModal">
  <div class="modal" tabindex="-1">
    <div class="modal-header">
      <h3 class="modal-title">Sources</h3>
      <button class="modal-close" onclick="closeSourcesModal()">×</button>
    </div>
    <div class="modal-body" id="modalSourcesList">
      <!-- Sources will be inserted here -->
    </div>
  </div>
</div>
```

### Step 2: Add CSS Styles (Fixed Grid)

```css
/* Story Grid - FIXED BREAKPOINTS */
.stories-grid { 
  display: grid; 
  gap: 20px; 
  padding: 24px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 1200px) { 
  .stories-grid { 
    grid-template-columns: repeat(2, minmax(0, 1fr)); 
  } 
}

@media (max-width: 768px) { 
  .stories-grid { 
    grid-template-columns: 1fr; 
    padding: 16px; 
  } 
}

/* Story Card */
.story-card {
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* Severity Badges - UPPERCASE */
.severity-critical { background: #dc2626; color: white; }
.severity-severe { background: #ea580c; color: white; }
.severity-moderate { background: #ca8a04; color: white; }
.severity-minor { background: #16a34a; color: white; }

/* Loading Skeleton */
.skeleton-card {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: loading 1.5s infinite;
  height: 300px;
  border-radius: 8px;
  margin-bottom: 20px;
}

@keyframes loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error Banner */
.error-banner {
  background: #fee2e2;
  color: #dc2626;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
  margin: 20px;
}
```

### Step 3: JavaScript with All Fixes

Create `/public/js/story-view.js`:

```javascript
// Configuration (from environment - NEVER hardcode)
const SUPABASE_URL = window.ENV?.SUPABASE_URL || ''; 
const SUPABASE_KEY = window.ENV?.SUPABASE_ANON_KEY || '';

// Severity label mapping - UPPERCASE as decided
const SEVERITY_LABELS = {
  'critical': 'FUCKING TREASON',
  'severe': 'CRIMINAL BULLSHIT',
  'moderate': 'SWAMP SHIT',
  'minor': 'CLOWN SHOW'
};

// Category display names
const CATEGORY_LABELS = {
  'corruption_scandals': 'Corruption & Scandals',
  'democracy_elections': 'Democracy & Elections',
  'policy_legislation': 'Policy & Legislation',
  'justice_legal': 'Justice & Legal',
  'executive_actions': 'Executive Actions',
  'foreign_policy': 'Foreign Policy',
  'corporate_financial': 'Corporate & Financial',
  'civil_liberties': 'Civil Liberties',
  'media_disinformation': 'Media & Disinformation',
  'epstein_associates': 'Epstein & Associates',
  'other': 'Other'
};

// Pagination state
let currentPage = 0;
const PAGE_SIZE = 30;

// Relative time helper
function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const t = [[31536000,'y'], [2592000,'mo'], [604800,'w'], [86400,'d'], [3600,'h'], [60,'m']];
  for (const [sec, u] of t) {
    if (s >= sec) return `${Math.floor(s/sec)}${u} ago`;
  }
  return `${s}s ago`;
}

// Fetch stories with proper pagination
async function fetchStories() {
  const offset = currentPage * PAGE_SIZE;
  const url = new URL(`${SUPABASE_URL}/rest/v1/stories`);
  
  // Build query params
  url.searchParams.set('status', 'eq.active');
  url.searchParams.set('select', 'id,primary_headline,summary_spicy,severity,category,source_count,primary_actor,status,last_updated_at,first_seen_at');
  url.searchParams.set('order', 'last_updated_at.desc,id.desc');
  url.searchParams.set('limit', PAGE_SIZE);
  url.searchParams.set('offset', offset);
  
  try {
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    currentPage += 1;
    
    // Get total count from headers
    const contentRange = response.headers.get('content-range');
    const hasMore = data.length === PAGE_SIZE;
    
    // Analytics
    if (window.gtag) {
      window.gtag('event', 'stories_loaded', {
        page: currentPage,
        count: data.length
      });
    }
    
    return { stories: data, hasMore };
  } catch (error) {
    console.error('Failed to fetch stories:', error);
    showError();
    return { stories: [], hasMore: false };
  }
}

// Create story card HTML
function createStoryCard(story) {
  const severityLabel = SEVERITY_LABELS[story.severity] || story.severity;
  const categoryLabel = CATEGORY_LABELS[story.category] || story.category || 'Other';
  const relativeTime = timeAgo(story.last_updated_at);
  const fullTime = new Date(story.last_updated_at).toLocaleString();
  
  return `
    <div class="story-card" data-story-id="${story.id}">
      <div class="story-header">
        <span class="category-badge category-${story.category || 'other'}">
          ${categoryLabel}
        </span>
        <span class="timestamp" title="${fullTime}">Updated ${relativeTime}</span>
      </div>
      
      <h2 class="story-headline">${story.primary_headline}</h2>
      
      <div class="story-topic">
        <span class="topic-icon">👤</span>
        Main actor: ${story.primary_actor || 'Unknown'}
        <span class="severity-badge severity-${story.severity}">
          ${severityLabel}
        </span>
      </div>
      
      <div class="summary-preview active">
        ${story.summary_spicy || 'No summary available'}
      </div>
      
      <div class="story-footer">
        <div class="sources-info">
          <span class="sources-count">Sources (${story.source_count || 0})</span>
        </div>
        <div class="footer-buttons">
          <button class="btn-small" onclick="showSources(${story.id})">
            View Sources
          </button>
          <button class="btn-small btn-primary" onclick="readMore(${story.id})">
            Read More →
          </button>
        </div>
      </div>
    </div>
  `;
}

// Load and display stories
async function loadStories(append = false) {
  // Show loading state
  if (!append) {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('storiesGrid').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
  }
  
  const { stories, hasMore } = await fetchStories();
  
  // Hide loading
  document.getElementById('loadingState').style.display = 'none';
  
  if (stories.length === 0 && !append) {
    document.getElementById('errorState').style.display = 'block';
    return;
  }
  
  const storiesGrid = document.getElementById('storiesGrid');
  storiesGrid.style.display = 'grid';
  
  if (!append) {
    storiesGrid.innerHTML = '';
  }
  
  // Add cards
  stories.forEach(story => {
    storiesGrid.innerHTML += createStoryCard(story);
  });
  
  // Show/hide load more button
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  loadMoreBtn.style.display = hasMore ? 'block' : 'none';
}

// Show sources modal
async function showSources(storyId) {
  // Fetch story with articles
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/stories?id=eq.${storyId}&select=*,articles:article_story(*)`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  const [story] = await response.json();
  
  // Group articles by source
  const grouped = {};
  (story.articles || []).forEach(article => {
    const source = article.source_name || 'Unknown';
    if (!grouped[source]) grouped[source] = [];
    grouped[source].push(article);
  });
  
  // Sort sources by latest article
  const sorted = Object.entries(grouped)
    .map(([name, articles]) => ({
      name,
      articles: articles.sort((a, b) => 
        new Date(b.published_at) - new Date(a.published_at)
      )
    }))
    .sort((a, b) => 
      new Date(b.articles[0].published_at) - new Date(a.articles[0].published_at)
    );
  
  // Build modal content
  let html = '';
  sorted.forEach(({ name, articles }) => {
    const latest = articles[0];
    html += `
      <div class="source-item">
        <div class="source-info">
          <div class="source-name">${name}</div>
          <div class="source-time">${timeAgo(latest.published_at)} • ${articles.length} article${articles.length > 1 ? 's' : ''}</div>
          <div style="margin-top: 4px; font-size: 14px;">${latest.title}</div>
        </div>
        <a href="${latest.url}" target="_blank" class="source-link">Read ↗</a>
      </div>
    `;
  });
  
  document.getElementById('modalSourcesList').innerHTML = html;
  openSourcesModal();
  
  // Analytics
  if (window.gtag) {
    window.gtag('event', 'story_view_sources', {
      story_id: storyId,
      source_count: sorted.length
    });
  }
}

// Modal accessibility
function openSourcesModal() {
  const modal = document.getElementById('sourcesModal');
  modal.classList.add('open');
  modal.querySelector('.modal').focus();
}

function closeSourcesModal() {
  document.getElementById('sourcesModal').classList.remove('open');
}

// ESC to close modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSourcesModal();
});

// Click outside to close
document.getElementById('sourcesModal').addEventListener('click', function(e) {
  if (e.target === this) closeSourcesModal();
});

// Read More handler
function readMore(storyId) {
  // v1: Go to story detail page (stub)
  window.location.href = `/story/${storyId}`;
  
  // Analytics
  if (window.gtag) {
    window.gtag('event', 'story_click_read', {
      story_id: storyId
    });
  }
}

// Retry handler
function retryLoad() {
  currentPage = 0;
  loadStories();
}

// Load more handler
document.getElementById('loadMoreBtn')?.addEventListener('click', () => {
  loadStories(true);
  
  // Analytics
  if (window.gtag) {
    window.gtag('event', 'load_more', {
      page: currentPage
    });
  }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase configuration');
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorState').innerHTML = 
      '<p>Configuration error. Please contact support.</p>';
    return;
  }
  
  loadStories();
});
```

## Testing Checklist (Updated)

### Desktop Testing
- [ ] Stories load with proper 3-column grid (1200px+)
- [ ] Grid switches to 2 columns (768-1200px)
- [ ] Grid switches to 1 column (<768px)
- [ ] Relative timestamps show ("2h ago")
- [ ] Full timestamp shows on hover
- [ ] Severity badges show UPPERCASE labels
- [ ] Sources modal opens with sorted sources
- [ ] ESC key closes modal
- [ ] Click outside closes modal
- [ ] "Read More" goes to /story/{id}
- [ ] Load More button works until no more stories
- [ ] Error state shows on API failure
- [ ] Retry button works

### Security Checklist
- [ ] No API keys in committed code
- [ ] Authorization header included in all requests
- [ ] HTTPS only for production
- [ ] No console.log of sensitive data

### Analytics Events (if configured)
- [ ] `stories_loaded` - when stories fetch completes
- [ ] `story_view_sources` - when sources modal opened
- [ ] `story_click_read` - when Read More clicked
- [ ] `load_more` - when Load More clicked

## Common Gotchas & Solutions

### 1. CORS Errors
**Problem:** "Access to fetch at 'supabase.co' from origin 'localhost' has been blocked by CORS"
**Solution:** Include both `apikey` AND `Authorization: Bearer` headers

### 2. Pagination Stops Working
**Problem:** Load More button disappears too early
**Solution:** Check if returned array length < PAGE_SIZE (30)

### 3. Modal Focus Issues
**Problem:** Screen readers don't announce modal
**Solution:** Ensure `tabindex="-1"` on modal and `.focus()` when opened

### 4. Timestamps Look Wrong
**Problem:** Shows absolute time instead of relative
**Solution:** Use the `timeAgo()` function, not `toLocaleString()` directly

## API Response Structure

```json
[
  {
    "id": 1,
    "primary_headline": "GOP States Push Voter Suppression Laws",
    "summary_spicy": "The GOP isn't even hiding it anymore...",
    "severity": "critical",
    "category": "democracy_elections",
    "source_count": 5,
    "primary_actor": "State GOP",
    "status": "active",
    "last_updated_at": "2025-09-29T10:30:00Z",
    "first_seen_at": "2025-09-29T08:00:00Z"
  }
]
```

## Environment Setup

Create `/public/js/env.js` (DO NOT COMMIT):
```javascript
window.ENV = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...'
};
```

Add to `.gitignore`:
```
/public/js/env.js
*.env
```

## Definition of Done

- [ ] All 10 fixes implemented
- [ ] Code reviewed by senior developer
- [ ] Tested on desktop (Chrome, Firefox, Safari)
- [ ] Tested on mobile (iOS Safari, Chrome Android)
- [ ] No console errors
- [ ] Handles API errors gracefully
- [ ] Matches design prototype
- [ ] Analytics events firing (if configured)
- [ ] Accessibility tested with keyboard navigation
- [ ] No hardcoded API keys in code
- [ ] Committed to test branch with descriptive message

---

**Need Help?**
1. Check the prototype at `/public/story-view-prototype.html`
2. Test API with `/public/story-view-api-tester.html`
3. Review error messages in browser console
4. Ask in Slack #trumpytracker-dev channel

Remember: We're showing the truth about corruption - make it angry but professional!
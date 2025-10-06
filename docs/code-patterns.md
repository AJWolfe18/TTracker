# Code Patterns & Best Practices

## Purpose
Reusable code patterns for TrumpyTracker. **Follow these patterns to maintain consistency.** Claude Code adds new patterns here when implementing reusable solutions.

---

## Database Queries

### Cursor Pagination (REQUIRED)
**Use this pattern, NOT offset pagination.**

```javascript
// Frontend: StoryList.jsx pattern
const [stories, setStories] = useState([]);
const [cursor, setCursor] = useState(null);
const [hasMore, setHasMore] = useState(true);

const loadMore = async () => {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('created_at', { ascending: false })
    .lt('created_at', cursor) // Use cursor from last result
    .limit(20);

  if (error) {
    console.error('Load failed:', error);
    return;
  }

  setStories(prev => [...prev, ...data]);
  
  // Set cursor to last item's timestamp
  if (data.length > 0) {
    setCursor(data[data.length - 1].created_at);
  }
  
  // Check if more results exist
  setHasMore(data.length === 20);
};
```

**Why:** Performance at scale, cost optimization  
**Created:** Migration 018  
**Used in:** StoryList.jsx, ArticleList.jsx  
**Reference:** [Supabase Pagination Docs](https://supabase.com/docs/guides/api/pagination)

---

### Joining with Counts
**Pattern for story + article count queries**

```javascript
const { data, error } = await supabase
  .from('stories')
  .select(`
    *,
    article_count:story_articles(count)
  `)
  .order('created_at', { ascending: false })
  .limit(20);
```

**Why:** Single query instead of N+1  
**Created:** Story view implementation  
**Used in:** StoryList.jsx, StoryDetail.jsx

---

### Nested Relations
**Pattern for fetching story with articles and sources**

```javascript
const { data, error } = await supabase
  .from('stories')
  .select(`
    *,
    story_articles (
      *,
      sources (
        name,
        url
      )
    )
  `)
  .eq('id', storyId)
  .single();
```

**Why:** Single query for full story view  
**Created:** Story detail page  
**Used in:** StoryDetail.jsx

---

## Error Handling

### Edge Functions Pattern
**ALWAYS use this structure for Edge Functions**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  try {
    // Parse input
    const { param } = await req.json();
    
    // Validate input
    if (!param) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Main logic
    const result = await someOperation(param);

    // Success response
    return new Response(
      JSON.stringify({ data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Log for debugging in Supabase logs
    console.error('Function failed:', error);
    
    // User-friendly error response
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

**Why:** Consistent error handling, better debugging  
**Created:** RSS Edge Functions  
**Used in:** All Edge Functions in `supabase/functions/`

---

### React Component Error Boundaries
**Pattern for UI error handling**

```javascript
const [error, setError] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('stories')
        .select('*');

      if (error) throw error;
      
      setStories(data);
    } catch (err) {
      console.error('Fetch failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  fetchData();
}, []);

// UI rendering
if (loading) return <div>Loading...</div>;
if (error) return <div>Error: {error}</div>;
```

**Why:** User-friendly error states, prevent crashes  
**Created:** Story view components  
**Used in:** All data-fetching components

---

## React Patterns

### Custom Hook for Data Fetching
**Reusable hook pattern**

```javascript
// hooks/useStories.js
export function useStories() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('stories')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (cursor) {
        query = query.lt('created_at', cursor);
      }

      const { data, error } = await query;
      
      if (error) throw error;

      setStories(prev => cursor ? [...prev, ...data] : data);
      
      if (data.length > 0) {
        setCursor(data[data.length - 1].created_at);
      }
      
      setHasMore(data.length === 20);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMore();
  }, []);

  return { stories, loading, error, loadMore, hasMore };
}
```

**Why:** DRY principle, reusable logic  
**Created:** Story list refactor  
**Used in:** StoryList.jsx, HomePage.jsx

---

## TypeScript Types

### Supabase Generated Types
**ALWAYS use generated types**

```typescript
// Import generated types
import { Database } from '../types/supabase';

type Story = Database['public']['Tables']['stories']['Row'];
type StoryInsert = Database['public']['Tables']['stories']['Insert'];
type StoryUpdate = Database['public']['Tables']['stories']['Update'];

// Use in functions
async function getStory(id: string): Promise<Story | null> {
  const { data } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .single();
  
  return data;
}
```

**Why:** Type safety, auto-complete, catch errors  
**Created:** TypeScript migration  
**Generated via:** `supabase-test:generate_typescript_types`  
**Used in:** All TypeScript files

---

## File Organization

### Component Structure
```
src/
├── components/
│   ├── stories/
│   │   ├── StoryList.jsx          # List view
│   │   ├── StoryCard.jsx          # Individual card
│   │   └── StoryDetail.jsx        # Detail view
│   ├── articles/
│   │   ├── ArticleList.jsx
│   │   └── ArticleCard.jsx
│   └── common/
│       ├── LoadingSpinner.jsx     # Reusable loading
│       └── ErrorMessage.jsx       # Reusable error
├── hooks/
│   ├── useStories.js              # Data fetching
│   └── usePagination.js           # Pagination logic
├── utils/
│   ├── dateFormatting.js          # Date helpers
│   └── apiHelpers.js              # API utilities
└── types/
    └── supabase.ts                # Generated types
```

**Why:** Clear organization, easy to find code  
**Created:** Project structure  
**Reference:** Existing structure

---

## Styling Patterns

### Tailwind Class Organization
**Order classes for readability**

```jsx
// Layout → Spacing → Typography → Colors → Effects
<div className="
  flex flex-col              // Layout
  p-4 gap-4                  // Spacing
  text-lg font-semibold      // Typography
  bg-white text-gray-900     // Colors
  rounded-lg shadow-md       // Effects
  hover:shadow-lg            // States
">
```

**Why:** Consistent, scannable  
**Created:** UI refactor  
**Used in:** All components

---

## Environment Variables

### Supabase Client Setup
**ALWAYS use environment variables**

```javascript
// src/config/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

**Why:** Security, easy environment switching  
**Created:** Initial setup  
**Used in:** All components importing Supabase

---

## Testing Patterns

### Manual Test Checklist (Until Puppeteer Setup)
**Run before every PR**

```markdown
- [ ] Feature works in Chrome
- [ ] Feature works in Firefox  
- [ ] Mobile responsive (DevTools mobile view)
- [ ] No console errors
- [ ] Network tab shows efficient queries
- [ ] Loading states display correctly
- [ ] Error states display correctly
- [ ] Empty states display correctly
```

**Why:** Catch bugs before PR  
**Created:** QA process  
**Used in:** Every feature implementation

---

## Performance Patterns

### Debouncing User Input
**For search, filters, etc.**

```javascript
import { useState, useEffect } from 'react';

function SearchComponent() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTerm(searchTerm);
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch when debounced term changes
  useEffect(() => {
    if (debouncedTerm) {
      fetchResults(debouncedTerm);
    }
  }, [debouncedTerm]);

  return (
    <input 
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      placeholder="Search stories..."
    />
  );
}
```

**Why:** Reduce API calls, better UX  
**Created:** Search feature  
**Used in:** Search, filters

---

## Adding New Patterns

**When Code implements something reusable:**

1. Document the pattern here
2. Include:
   - Code example
   - Why use this pattern
   - Where it's used
   - When it was created
3. Note in PR: "Added pattern to code-patterns.md"

---

_Last Updated: October 5, 2025_  
_Maintained by: Claude Code_  
_Reference: `/docs/database-standards.md` for database patterns_

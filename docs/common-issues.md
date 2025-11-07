# Common Issues & Solutions

## Purpose
Document recurring issues and their solutions. **Claude Code adds entries here when fixing bugs that could repeat.** This prevents re-debugging the same problems.

---

## Database Issues

### Issue: RLS Blocking Authenticated Requests
**Symptom:** Query works in Supabase dashboard but fails in app with "permission denied"

**Cause:** RLS policy only allows `anon` role, not `authenticated` role

**Solution:**
```sql
-- ❌ Too restrictive
CREATE POLICY "Public read" ON stories
  FOR SELECT USING (auth.role() = 'anon');

-- ✅ Correct - allows both
CREATE POLICY "Public read" ON stories
  FOR SELECT USING (true);
```

**Fixed in:** TTRC-189  
**Date:** October 3, 2025

---

### Issue: Migration Fails with "Already Exists"
**Symptom:** Migration runs successfully on TEST, then fails on another branch or in PROD with "relation already exists"

**Cause:** Table was created in a different migration that ran on that environment

**Solution:**
```sql
-- ❌ Will fail if table exists
CREATE TABLE stories (...);

-- ✅ Idempotent - safe to run multiple times
CREATE TABLE IF NOT EXISTS stories (...);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at);
```

**Fixed in:** TTRC-190  
**Date:** October 3, 2025  
**Prevention:** Always use `IF NOT EXISTS` in migrations

---

### Issue: Foreign Key Constraint Violations
**Symptom:** Cannot delete record, error: "violates foreign key constraint"

**Cause:** Other tables reference this record with `ON DELETE RESTRICT` or no ON DELETE clause

**Solution:**
```sql
-- Check what's blocking deletion
SELECT 
  tc.table_name, 
  kcu.column_name,
  ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND ccu.table_name = 'your_table_name';

-- Fix: Update constraint to allow deletion
ALTER TABLE story_articles 
  DROP CONSTRAINT story_articles_story_id_fkey,
  ADD CONSTRAINT story_articles_story_id_fkey 
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE;
```

**Prevention:** Always specify ON DELETE behavior in foreign keys

---

### Issue: Slow Queries on Large Tables
**Symptom:** Page loads slowly, database queries taking > 1 second

**Cause:** Missing indexes on columns used in WHERE/ORDER BY

**Solution:**
```sql
-- Check query performance
EXPLAIN ANALYZE
SELECT * FROM stories
ORDER BY created_at DESC
LIMIT 20;

-- If you see "Seq Scan" instead of "Index Scan", add index
CREATE INDEX idx_stories_created_at ON stories(created_at);

-- Re-run EXPLAIN to verify improvement
```

**Fixed in:** Various tickets  
**Prevention:** Add indexes for pagination columns during migration

---

### Issue: Job Queue RPC Returns NULL Despite No Active Jobs
**Symptom:** RSS pipeline frozen - `enqueue_fetch_job()` RPC returns NULL for all feeds claiming "job already active" when database shows no active jobs exist

**Root Causes (Multiple):**
1. **SECURITY DEFINER search_path vulnerability** - Unqualified `digest()` call allowed search_path hijacking
2. **Hash instability** - `{"k":null}` vs `{"k":null,"x":null}` produced different hashes causing spurious deduplication misses
3. **Type mismatches** - `name[]` vs `text[]` in constraint cleanup query
4. **Failed job retry blocking** - Legacy cleanup marked failed jobs as processed, preventing retries
5. **Execution order** - Pre-flight dedupe ran AFTER index creation, causing TEST failures
6. **Silent PROD failures** - Missing index guard allowed broken deploys

**Solution (Migration 029):**
```sql
-- 1. SECURITY: Explicitly qualify digest() to prevent hijacking
CREATE OR REPLACE FUNCTION enqueue_fetch_job(...)
SET search_path = public  -- Tighten search_path
AS $$
  v_hash := encode(
    extensions.digest(  -- Explicitly qualified, not search_path-resolved
      convert_to(
        COALESCE(jsonb_strip_nulls(p_payload), '{}'::jsonb)::text,  -- Strip nulls for stability
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO job_queue (...)
  ON CONFLICT (job_type, payload_hash) WHERE (processed_at IS NULL) DO NOTHING
  RETURNING id INTO v_id;
$$;

-- 2. CORRECTNESS: Only mark done/completed as processed, NOT failed
UPDATE job_queue
SET processed_at = COALESCE(processed_at, completed_at, NOW())
WHERE processed_at IS NULL
  AND status IN ('done', 'completed');  -- Removed 'failed' - must stay retryable

-- 3. EXECUTION ORDER: Dedupe BEFORE index creation
-- Pre-flight dedupe runs first, then CREATE UNIQUE INDEX succeeds

-- 4. PROD SAFETY: Fail-fast index guard
DO $$
BEGIN
  IF COALESCE(current_setting('app.env', true), 'prod') <> 'test' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='ux_job_queue_payload_hash_active') THEN
      RAISE EXCEPTION 'Required index missing in PROD';
    END IF;
  END IF;
END$$;
```

**Client-Side Fix (seed script):**
```javascript
// Strip nulls from payload for stable hashing (matches DB jsonb_strip_nulls)
const stripNulls = (obj) => {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = typeof value === 'object' ? stripNulls(value) : value;
    }
  }
  return result;
};

const hash = (obj) =>
  crypto.createHash('sha256')
    .update(JSON.stringify(stripNulls(obj)))
    .digest('hex');
```

**Debugging Steps Used:**
1. ✅ Found blocking jobs (2574, 2575) from previous test session
2. ✅ Discovered RPC using old broken version from migration 013
3. ✅ Verified hash logic difference between client (32-char) and server (64-char expected)
4. ✅ Traced 11 rounds of issues: security, types, order, stability

**Fixed in:** TTRC-248, Migration 029
**Date:** November 3, 2025
**Review Rounds:** 11 (architectural, security, bytea, comprehensive, production, Supabase-specific, critical-7, ultra-critical-3, final hardening, PostgreSQL syntax, type compliance)
**Prevention:**
- Always use `extensions.digest()` explicitly in SECURITY DEFINER functions
- Always use `jsonb_strip_nulls()` for hash stability
- Always run deduplication BEFORE unique index creation
- Always add PROD index guard to fail-fast if prerequisites missing
- Always use GET DIAGNOSTICS for row counts, not temp table references
- Always check `pg_proc` for function existence, not `IF EXISTS` (unsupported)

---

## Frontend Issues

### Issue: Infinite Re-renders in useEffect
**Symptom:** Component crashes, console shows "Maximum update depth exceeded"

**Cause:** useEffect dependency array causing endless loop

**Problem Code:**
```javascript
// ❌ BAD - creates new object every render
useEffect(() => {
  fetchData(filters);
}, [filters]); // filters is an object, always "different"
```

**Solution:**
```javascript
// ✅ GOOD - depend on specific values
useEffect(() => {
  fetchData(filters);
}, [filters.search, filters.category]); // primitives, not objects

// OR use useMemo for complex dependencies
const filterString = useMemo(
  () => JSON.stringify(filters),
  [filters.search, filters.category]
);

useEffect(() => {
  fetchData(filters);
}, [filterString]);
```

**Fixed in:** Story filter implementation  
**Date:** September 2025

---

### Issue: Stale Data After Updates
**Symptom:** Updated data doesn't appear until page refresh

**Cause:** Not invalidating cache or re-fetching after mutation

**Solution:**
```javascript
// ❌ BAD - updates but doesn't refresh
const updateStory = async (id, updates) => {
  await supabase
    .from('stories')
    .update(updates)
    .eq('id', id);
};

// ✅ GOOD - updates and refreshes
const updateStory = async (id, updates) => {
  await supabase
    .from('stories')
    .update(updates)
    .eq('id', id);
  
  // Re-fetch data
  fetchStories();
  
  // OR update state optimistically
  setStories(prev => 
    prev.map(s => s.id === id ? { ...s, ...updates } : s)
  );
};
```

**Fixed in:** Story editing feature  
**Date:** September 2025

---

### Issue: Memory Leaks on Unmount
**Symptom:** Console warning "Can't perform React state update on unmounted component"

**Cause:** Async operation completes after component unmounts

**Solution:**
```javascript
useEffect(() => {
  let isMounted = true;

  const fetchData = async () => {
    const { data } = await supabase.from('stories').select('*');
    
    // Only update state if still mounted
    if (isMounted) {
      setStories(data);
    }
  };

  fetchData();

  // Cleanup function
  return () => {
    isMounted = false;
  };
}, []);
```

**Fixed in:** Various components  
**Prevention:** Always cleanup async operations in useEffect

---

## API/Edge Function Issues

### Issue: Edge Function Timeout
**Symptom:** Request takes > 30 seconds, returns 504 timeout

**Cause:** Edge Functions have 30-second limit

**Solution:**
```typescript
// ❌ BAD - processes everything in one request
Deno.serve(async (req) => {
  const items = await fetchAllItems(); // Could be thousands
  
  for (const item of items) {
    await processItem(item); // Takes minutes
  }
});

// ✅ GOOD - batch processing with limits
Deno.serve(async (req) => {
  const BATCH_SIZE = 50;
  
  const items = await fetchItems(BATCH_SIZE);
  
  await Promise.all(
    items.map(item => processItem(item))
  );
  
  // Return response under 30s
  return new Response(JSON.stringify({ 
    processed: items.length,
    hasMore: items.length === BATCH_SIZE 
  }));
});
```

**Fixed in:** RSS processing  
**Date:** September 2025  
**Prevention:** Keep Edge Function execution under 25 seconds

---

### Issue: CORS Errors in Edge Functions
**Symptom:** Browser shows "CORS policy blocked" error

**Cause:** Missing CORS headers in response

**Solution:**
```typescript
// ✅ Add CORS headers to all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Main logic...
    
    return new Response(
      JSON.stringify({ data: result }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
```

**Fixed in:** All Edge Functions  
**Prevention:** Use CORS headers template from code-patterns.md

---

## Build/Deploy Issues

### Issue: Build Fails with "Module Not Found"
**Symptom:** Local dev works, but Netlify build fails

**Cause:** Case-sensitive imports (Netlify is case-sensitive, Windows is not)

**Solution:**
```javascript
// ❌ BAD - works on Windows, fails on Netlify
import StoryCard from './components/storycard';

// ✅ GOOD - matches actual filename
import StoryCard from './components/StoryCard';
```

**Fixed in:** Various deploy issues  
**Prevention:** Match exact file capitalization in imports

---

### Issue: Environment Variables Not Found in Build
**Symptom:** App works locally, crashes in production with "undefined"

**Cause:** Env vars not set in Netlify dashboard

**Solution:**
1. Check `.env.example` for required variables
2. Add to Netlify: Site settings → Environment variables
3. Prefix with `VITE_` for Vite apps
4. Redeploy after adding env vars

**Fixed in:** Production deploy  
**Prevention:** Document all env vars in `.env.example`

---

## Git/Version Control Issues

### Issue: Merge Conflicts in package-lock.json
**Symptom:** Cannot merge, conflicts in lock file

**Solution:**
```bash
# Accept theirs and regenerate
git checkout --theirs package-lock.json
npm install

# Or accept ours and regenerate  
git checkout --ours package-lock.json
npm install

# Then commit the regenerated lock file
git add package-lock.json
git commit -m "chore: resolve lock file conflict"
```

**Prevention:** Keep dependencies updated, merge frequently

---

### Issue: Accidentally Committed to Main
**Symptom:** Commit pushed to main instead of feature branch

**Solution:**
```bash
# If not pushed yet
git reset HEAD~1  # Undo commit, keep changes
git stash         # Save changes
git checkout -b feature/my-feature  # Create feature branch
git stash pop     # Restore changes
git add .
git commit -m "feat: my feature"

# If already pushed (DANGEROUS, coordinate with team)
# Don't do this if others have pulled
git reset --hard HEAD~1
git push --force
```

**Prevention:** Enable branch protection on main (PR-only workflow)

---

## Performance Issues

### Issue: Slow Page Load Times
**Symptom:** Initial page load > 3 seconds

**Causes & Solutions:**

1. **Unused dependencies:**
```bash
# Analyze bundle size
npm run build
# Check dist folder size

# Remove unused dependencies
npm uninstall [unused-package]
```

2. **Large images:**
```javascript
// ✅ Use lazy loading
<img src="image.jpg" loading="lazy" alt="..." />

// ✅ Use optimized formats (WebP)
// ✅ Serve different sizes for mobile/desktop
```

3. **Too many API calls:**
```javascript
// ❌ BAD - N+1 queries
stories.forEach(story => {
  fetchArticles(story.id); // Separate query per story
});

// ✅ GOOD - Single query with join
const stories = await supabase
  .from('stories')
  .select('*, story_articles(*)')
  .limit(20);
```

**Fixed in:** Various performance optimizations

---

## Adding New Issues

**When Code fixes a bug:**

1. Document it here with:
   - Symptom (what user sees)
   - Cause (why it happens)
   - Solution (how to fix)
   - Prevention (how to avoid)
   - Ticket reference
   - Date fixed
2. Note in PR: "Documented in common-issues.md"
3. Consider if it needs a pattern in code-patterns.md

---

## Quick Debugging Checklist

When something breaks:

- [ ] Check browser console for errors
- [ ] Check Network tab for failed requests
- [ ] Check Supabase logs: `supabase-test:get_logs service="api"`
- [ ] Check Edge Function logs: `supabase-test:get_logs service="edge-function"`
- [ ] Check database: `supabase-test:execute_sql`
- [ ] Check RLS policies on affected tables
- [ ] Check if issue exists in common-issues.md
- [ ] Check if pattern exists in code-patterns.md

---

_Last Updated: October 5, 2025_  
_Maintained by: Claude Code_  
_Reference: `/docs/code-patterns.md` for prevention patterns_

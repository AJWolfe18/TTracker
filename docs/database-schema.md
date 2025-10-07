# Database Schema Reference

## Purpose
Living documentation of TrumpyTracker's database schema. **Claude Code updates this after every migration.**

Last Schema Query: October 5, 2025

---

## Tables Overview

| Table | Purpose | Migration | Key Relations |
|-------|---------|-----------|---------------|
| `stories` | RSS story clusters | 018 | Has many story_articles |
| `story_articles` | Articles within stories | 018 | Belongs to story, source |
| `sources` | News sources | 018 | Has many story_articles |
| `rss_queue` | RSS fetch queue | 018 | None |
| `articles` | Legacy article system | Pre-018 | Deprecated, to be removed |

---

## Table Details

### `stories`
**Purpose:** Grouped clusters of related articles from RSS feeds

```sql
CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  ai_summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  source_count integer DEFAULT 0 NOT NULL
);
```

**Indexes:**
- `idx_stories_created_at` - For pagination by date
- `idx_stories_updated_at` - For finding recently updated stories

**RLS:**
- Enabled
- Public read access via `FOR SELECT USING (true)`

**Relations:**
- Has many `story_articles` (CASCADE delete)

**Migration:** 018 (RSS system)

---

### `story_articles`
**Purpose:** Individual articles within a story cluster

```sql
CREATE TABLE story_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES stories(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  url text UNIQUE NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
```

**Indexes:**
- `idx_story_articles_story_id` - For story → articles lookup
- `idx_story_articles_source_id` - For source → articles lookup
- `idx_story_articles_published_at` - For date ordering
- `idx_story_articles_url` - For deduplication (UNIQUE)

**RLS:**
- Enabled
- Public read access via `FOR SELECT USING (true)`

**Relations:**
- Belongs to `stories` (CASCADE on delete)
- Belongs to `sources` (RESTRICT on delete)

**Migration:** 018 (RSS system)

---

### `sources`
**Purpose:** News sources for RSS feeds

```sql
CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text UNIQUE NOT NULL,
  rss_url text UNIQUE NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
```

**Indexes:**
- `idx_sources_is_active` - For filtering active sources
- `idx_sources_url` - For URL uniqueness (UNIQUE)
- `idx_sources_rss_url` - For RSS URL uniqueness (UNIQUE)

**RLS:**
- Enabled
- Public read access via `FOR SELECT USING (true)`

**Relations:**
- Has many `story_articles` (RESTRICT on delete to preserve articles)

**Migration:** 018 (RSS system)

---

### `rss_queue`
**Purpose:** Queue for processing RSS feeds

```sql
CREATE TABLE rss_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES sources(id) ON DELETE CASCADE,
  status varchar(50) DEFAULT 'pending' NOT NULL 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
```

**Indexes:**
- `idx_rss_queue_status` - For filtering by status
- `idx_rss_queue_source_id` - For source → queue lookups
- `idx_rss_queue_created_at` - For processing order

**RLS:**
- Enabled
- Public read access via `FOR SELECT USING (true)`

**Relations:**
- Belongs to `sources` (CASCADE on delete)

**Migration:** 018 (RSS system)

---

### `articles` (DEPRECATED)
**Purpose:** Legacy article tracking system (pre-RSS)

**Status:** ⚠️ To be removed after RSS migration complete

```sql
CREATE TABLE articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  url text UNIQUE NOT NULL,
  source text,
  published_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
```

**Migration Plan:** Remove in migration 020+ after data migration

---

## Migration History

| # | Date | Description | Tables Affected |
|---|------|-------------|-----------------|
| 018 | 2024-09-XX | RSS story clustering system | stories, story_articles, sources, rss_queue |
| 019 | 2024-10-XX | Add story backfill support | stories (added article_count) |

---

## Common Queries

### Get Stories with Article Count
```sql
SELECT 
  s.*,
  COUNT(sa.id) as article_count
FROM stories s
LEFT JOIN story_articles sa ON sa.story_id = s.id
GROUP BY s.id
ORDER BY s.created_at DESC
LIMIT 20;
```

### Get Articles for a Story
```sql
SELECT 
  sa.*,
  src.name as source_name
FROM story_articles sa
JOIN sources src ON src.id = sa.source_id
WHERE sa.story_id = '[story-uuid]'
ORDER BY sa.published_at DESC;
```

### Get Active Sources
```sql
SELECT *
FROM sources
WHERE is_active = true
ORDER BY name;
```

---

## Schema Update Process

**When Code creates/modifies schema:**

1. Create migration in `supabase/migrations/`
2. Test migration on TEST environment
3. Update this document with:
   - New table structure
   - Indexes added
   - RLS policies
   - Relations
   - Migration number
4. Note in PR description: "Updated database-schema.md"

---

## Schema Verification Commands

```bash
# List all tables in public schema
supabase-test:list_tables schemas=["public"]

# Query specific table structure
supabase-test:execute_sql query="
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'stories'
  ORDER BY ordinal_position;
"

# List all indexes
supabase-test:execute_sql query="
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname;
"
```

---

_Last Updated: October 5, 2025_  
_Next Update: After next migration by Claude Code_  
_Reference: `/docs/database-standards.md` for conventions_

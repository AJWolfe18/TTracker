# Database Standards & Conventions

## Purpose
This document defines the standards for all database schema changes in TrumpyTracker. Follow these rules to prevent schema drift and maintain consistency.

---

## Naming Conventions

### Tables
- **Format:** `snake_case`, plural nouns
- **Examples:** `stories`, `story_articles`, `sources`, `rss_queue`
- ❌ **Never:** camelCase, PascalCase, singular names

### Columns
- **Format:** `snake_case`
- **Examples:** `created_at`, `story_id`, `is_active`, `source_url`
- ❌ **Never:** camelCase, PascalCase

### Foreign Keys
- **Format:** `{referenced_table_singular}_id`
- **Examples:** `story_id`, `source_id`, `user_id`
- **Type:** Always `uuid` (match Supabase default)

### Indexes
- **Format:** `idx_{table}_{column(s)}`
- **Examples:** 
  - `idx_stories_created_at`
  - `idx_story_articles_story_id`
  - `idx_story_articles_published_at`

### Constraints
- **Format:** `{table}_{column}_{type}`
- **Examples:**
  - `stories_title_check` (CHECK constraint)
  - `story_articles_story_id_fkey` (Foreign key, Supabase default)
  - `sources_url_unique` (UNIQUE constraint)

---

## Column Types

### Standard Types
| Data Type | Use For | Example |
|-----------|---------|---------|
| `uuid` | Primary keys, foreign keys | `id`, `story_id` |
| `text` | Variable length strings | `title`, `description`, `content` |
| `varchar(n)` | Fixed max length strings | `status varchar(50)` |
| `timestamptz` | All timestamps (UTC) | `created_at`, `published_at` |
| `boolean` | True/false flags | `is_active`, `is_deleted` |
| `integer` | Counts, numbers | `article_count`, `view_count` |
| `jsonb` | Structured data | `metadata`, `ai_summary` |

### ❌ NEVER Use
- `timestamp` (without tz) - Always use `timestamptz`
- `datetime` - Not a PostgreSQL type
- `int` - Use `integer` for clarity

---

## Required Columns

### Every Table Must Have
```sql
CREATE TABLE table_name (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  -- other columns
);
```

### Optional Standard Columns
```sql
-- For soft deletes
deleted_at timestamptz DEFAULT NULL

-- For user tracking
created_by uuid REFERENCES auth.users(id)
updated_by uuid REFERENCES auth.users(id)
```

---

## Foreign Keys

### Standard Pattern
```sql
-- Reference with CASCADE delete
story_id uuid REFERENCES stories(id) ON DELETE CASCADE

-- Reference with RESTRICT (prevent deletion)
source_id uuid REFERENCES sources(id) ON DELETE RESTRICT

-- Reference with SET NULL (keep record, remove reference)
user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
```

### Rules
- ✅ **Always specify ON DELETE behavior**
- ✅ **Use CASCADE for dependent data** (e.g., story_articles → stories)
- ✅ **Use RESTRICT for reference data** (e.g., articles → sources)
- ✅ **Use SET NULL for audit trail** (e.g., user who created record)

---

## Indexes

### When to Create Indexes
- ✅ All foreign key columns
- ✅ Columns used in WHERE clauses frequently
- ✅ Columns used in ORDER BY (for pagination)
- ✅ Columns used in JOINs
- ❌ Columns rarely queried
- ❌ Tables with < 1000 rows (premature optimization)

### Standard Index Pattern
```sql
-- Single column
CREATE INDEX idx_stories_created_at ON stories(created_at);

-- Multiple columns (order matters!)
CREATE INDEX idx_story_articles_story_published 
  ON story_articles(story_id, published_at);

-- Partial index (conditional)
CREATE INDEX idx_active_sources 
  ON sources(created_at) 
  WHERE is_active = true;
```

---

## Row Level Security (RLS)

### Standard Pattern
```sql
-- Enable RLS on table
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Public read (most common for TrumpyTracker)
CREATE POLICY "Public read access" ON table_name
  FOR SELECT USING (true);

-- Authenticated users only
CREATE POLICY "Authenticated read" ON table_name
  FOR SELECT USING (auth.role() = 'authenticated');

-- Admin write access
CREATE POLICY "Admin write" ON table_name
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'admin'
  );
```

### TrumpyTracker Default
Most tables are **public read**, no write via API (admin tools only):
```sql
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON stories FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies = only service role can write
```

---

## Migrations

### Naming Convention
- **Format:** `YYYYMMDDHHMMSS_description.sql`
- **Examples:** 
  - `20250101120000_create_stories_table.sql`
  - `20250102150000_add_story_articles_indexes.sql`

### Migration Template
```sql
-- Migration: [Brief description]
-- Created: [Date]
-- Ticket: TTRC-XXX

BEGIN;

-- Schema changes here
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at);

-- RLS
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON stories FOR SELECT USING (true);

COMMIT;
```

### Migration Rules
- ✅ Use transactions (BEGIN/COMMIT)
- ✅ Use `IF NOT EXISTS` for idempotency
- ✅ Test on TEST environment first
- ✅ Never modify existing migrations (create new one)
- ❌ Never hardcode UUIDs or timestamps in migrations
- ❌ Never reference production data in migrations

---

## Data Types Best Practices

### Timestamps
```sql
-- ✅ ALWAYS use timestamptz with timezone
created_at timestamptz DEFAULT now() NOT NULL

-- ❌ NEVER use timestamp without timezone
created_at timestamp DEFAULT now() -- BAD
```

### Text vs Varchar
```sql
-- ✅ Use text for variable length (no max)
content text NOT NULL

-- ✅ Use varchar(n) only with business constraint
status varchar(50) CHECK (status IN ('active', 'inactive', 'pending'))

-- ❌ Don't use varchar without good reason
title varchar(255) -- Arbitrary limit, use text instead
```

### JSON
```sql
-- ✅ Use jsonb (binary, indexable, faster)
metadata jsonb DEFAULT '{}'::jsonb

-- ❌ Don't use json (slower, no indexing)
metadata json -- BAD
```

### Booleans
```sql
-- ✅ Always provide default
is_active boolean DEFAULT true NOT NULL

-- ✅ Use positive naming
is_active boolean  -- Good
is_not_deleted boolean  -- Confusing

-- ❌ Don't allow NULL for boolean
is_active boolean  -- Ambiguous: NULL vs false?
```

---

## Before Creating Any Schema Change

### Checklist
- [ ] Query existing schema: `supabase-test:list_tables`
- [ ] Check `/docs/database-schema.md` for existing tables
- [ ] Verify naming follows conventions above
- [ ] Confirm foreign keys have ON DELETE behavior
- [ ] Add indexes for query performance
- [ ] Enable RLS with appropriate policies
- [ ] Use migration template
- [ ] Test migration on TEST environment
- [ ] Update `/docs/database-schema.md` after success

---

## Common Mistakes to Avoid

❌ Creating table that already exists → Check schema first  
❌ Using camelCase → Always snake_case  
❌ Forgetting indexes on foreign keys → Auto-create them  
❌ Missing ON DELETE for foreign keys → Always specify  
❌ Using timestamp without tz → Always timestamptz  
❌ Hardcoding IDs in migrations → Use SELECT queries  
❌ Skipping RLS → Enable on all tables  
❌ Not testing on TEST first → Always test migrations

---

_Last Updated: October 5, 2025_  
_Maintained by: Claude Desktop + Claude Code_

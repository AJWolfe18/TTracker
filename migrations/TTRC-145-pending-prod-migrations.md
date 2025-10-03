# TTRC-145: Pending Production Migrations - Story View UI

**Card:** TTRC-145 - Story View Frontend Components  
**Purpose:** Track all SQL changes made to TEST that need to be applied to PROD before RSS system launch.

**Status:** TEST only - NONE applied to PROD yet

---

## Migration Checklist

| # | Migration | TEST | PROD | Date Applied |
|---|-----------|------|------|--------------|
| 1 | Add political_entries.archived | ⏳ | ❌ | - |
| 2 | Create dashboard_stats view | ⏳ | ❌ | - |

**Legend:**
- ✅ Applied and verified
- ⏳ Pending application
- ❌ Not applied
- ⚠️ Applied with issues

---

## Migration 1: Add archived Column to political_entries

**Purpose:** Support filtering of archived political entries in dashboard UI

**Applied to TEST:** ⏳ Pending
**Applied to PROD:** ❌ No

**SQL:**
```sql
ALTER TABLE public.political_entries
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
```

**Verification Query:**
```sql
-- Should return 'archived' in the list
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'political_entries'
  AND column_name = 'archived';
```

**Expected Result:**
```
column_name | data_type | is_nullable | column_default
------------|-----------|-------------|---------------
archived    | boolean   | NO          | false
```

**Rollback (if needed):**
```sql
ALTER TABLE public.political_entries DROP COLUMN IF EXISTS archived;
```

**Dependencies:** None

**Risk:** LOW - Adds column with default value, no data loss

---

## Migration 2: Create dashboard_stats View

**Purpose:** Provide summary statistics for dashboard without expensive COUNT queries on every page load

**Applied to TEST:** ⏳ Pending
**Applied to PROD:** ❌ No

**SQL:**
```sql
CREATE OR REPLACE VIEW public.dashboard_stats AS
SELECT
  (SELECT COUNT(*) FROM public.stories WHERE status = 'active') AS stories_total,
  (SELECT COUNT(*) FROM public.political_entries)              AS political_total,
  (SELECT COUNT(*) FROM public.executive_orders)               AS executive_total,
  (SELECT COUNT(*) FROM public.articles)                       AS articles_total,
  now()                                                        AS refreshed_at;

GRANT SELECT ON public.dashboard_stats TO anon, authenticated;
```

**Verification Query:**
```sql
-- Should return 5 columns with current counts
SELECT * FROM public.dashboard_stats;
```

**Expected Result:**
```
stories_total | political_total | executive_total | articles_total | refreshed_at
--------------|-----------------|-----------------|----------------|-------------
86            | 5               | 190             | 180            | 2025-10-03 ...
```

**Rollback (if needed):**
```sql
DROP VIEW IF EXISTS public.dashboard_stats;
```

**Dependencies:** 
- Requires `stories` table (RSS system)
- Requires `articles` table (RSS system)
- PROD doesn't have these tables yet - this migration MUST wait until RSS tables are deployed

**Risk:** LOW - Read-only view, no data modification

**IMPORTANT:** This view will fail in PROD until RSS tables (`stories`, `articles`, `article_story`, etc.) are deployed. Deploy RSS tables first, then this view.

---

## Pre-Production Deployment Checklist

Before deploying RSS system to PROD, complete these steps:

### 1. Database Preparation
- [ ] Review all pending migrations in this document
- [ ] Verify all migrations tested successfully in TEST
- [ ] Confirm migration order and dependencies
- [ ] Create database backup of PROD

### 2. RSS Table Deployment (SEPARATE DOCUMENT - TBD)
- [ ] Deploy all RSS core tables (`stories`, `articles`, `article_story`, `feed_registry`, `job_queue`, `budgets`)
- [ ] Deploy all indexes and constraints
- [ ] Deploy RLS policies
- [ ] Verify table creation successful

### 3. Migration Application
- [ ] Apply Migration 1 (political_entries.archived)
- [ ] Verify Migration 1
- [ ] Apply Migration 2 (dashboard_stats view)
- [ ] Verify Migration 2

### 4. Post-Migration Verification
- [ ] Run all verification queries
- [ ] Check API endpoints respond correctly
- [ ] Test dashboard loads without errors
- [ ] Verify RLS policies working

### 5. Rollback Plan
- [ ] Document exact rollback steps
- [ ] Test rollback procedure in TEST first
- [ ] Keep database backup accessible for 7 days

---

## Notes for Future Migrations

**How to Add a Migration:**

1. Apply SQL change to TEST
2. Add entry to checklist table above
3. Create full migration section with:
   - Purpose
   - SQL statement
   - Verification query
   - Expected result
   - Rollback procedure
   - Dependencies
   - Risk assessment
4. Update this document in git
5. Mark as ✅ when applied to TEST
6. Mark as ✅ when applied to PROD

**Migration Naming Convention:**
- Use descriptive names: `add_table_column`, `create_view_name`, `add_index_name`
- Include table/view name in migration name
- Keep names concise but clear

**Risk Levels:**
- **LOW:** Read-only changes, adds columns with defaults, creates views
- **MEDIUM:** Modifies existing columns, changes constraints, affects data
- **HIGH:** Drops columns/tables, modifies RLS, changes auth

---

## Migration History

**Format:** Date | Migration | Applied By | Environment | Notes

_No migrations applied yet - RSS system still in TEST_

---

**Document Created:** 2025-10-03  
**Last Updated:** 2025-10-03  
**Maintained By:** Development Team  
**Review Before PROD Deploy:** YES - CRITICAL

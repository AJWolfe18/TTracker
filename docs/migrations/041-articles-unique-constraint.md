# Migration 041: Add Articles Unique Constraint

**JIRA:** TTRC-296
**Date:** 2025-11-26
**Status:** Created, needs manual application

---

## Problem

QA tests (`qa:integration`, `qa:concurrency`) fail with:
```
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

The tests use `ON CONFLICT (url_hash, published_date)` but the unique constraint was never applied to the database.

---

## Solution

Add unique constraint on `articles(url_hash, published_date)`:

```sql
ALTER TABLE articles
ADD CONSTRAINT uq_articles_urlhash_day
UNIQUE (url_hash, published_date);
```

---

## How to Apply

### TEST Environment
1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu
2. Navigate to SQL Editor
3. Run the SQL above
4. Verify: `npm run qa:smoke` should pass all tests

### PROD Environment
1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg
2. Navigate to SQL Editor
3. Run the SQL above

---

## Verification

After applying, run:
```bash
npm run qa:smoke
```

Expected: All 4 tests pass (boundaries, integration, idempotency, concurrency)

---

## Risk Assessment

- **Low risk** - Adding a unique constraint on columns that should already be unique
- **Potential issue** - If duplicate `(url_hash, published_date)` rows exist, the constraint will fail
- **Mitigation** - Check for duplicates first:
  ```sql
  SELECT url_hash, published_date, COUNT(*)
  FROM articles
  GROUP BY url_hash, published_date
  HAVING COUNT(*) > 1;
  ```

---

## Related Changes

Also in this session:
- Increased EO enrichment word limit from 160→200 words per section (reduces validation failures)
- Migration file: `migrations/041_add_articles_unique_constraint.sql`

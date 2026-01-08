# Migration 029 Coverage Analysis

## Temp Fixes vs Migration 029

### temp_fix_search_path.sql
**What it did:**
```sql
-- Fixed upsert_article_and_enqueue_jobs RPC
ALTER FUNCTION public.upsert_article_and_enqueue_jobs(...)
SET search_path = 'public, extensions';
```

**In Migration 029?**
❌ **NO** - Only has a comment saying it was already applied
- This means PROD won't get this fix!
- PROD article creation will be broken

---

### temp_cleanup_legacy_jobs.sql
**What it did:**
```sql
UPDATE job_queue
SET processed_at = COALESCE(processed_at, completed_at, NOW())
WHERE processed_at IS NULL
  AND (status IN ('done', 'failed', 'completed') OR completed_at IS NOT NULL);
```

**In Migration 029?**
✅ **YES** - Section 2 has this exact UPDATE

---

### temp_fix_enqueue_fetch_job.sql
**What it did:**
```sql
-- Fixed enqueue_fetch_job with manual SELECT logic
-- But was missing search_path fix
```

**In Migration 029?**
✅ **YES** - Section 3 has improved version with:
- Atomic INSERT ON CONFLICT
- Proper search_path
- Security hardening

---

## ⚠️ CRITICAL ISSUE

**Migration 029 is INCOMPLETE for PROD deployment!**

Missing: Article creation RPC search_path fix

**Impact on PROD:**
- ❌ Articles cannot be created (digest function error)
- ❌ RSS pipeline will break
- ❌ Manual article submission will fail

**Solution Needed:**
Add the article RPC fix to Migration 029 OR recreate temp_fix_search_path.sql for PROD

# Migration 024: Fix Executive Orders Severity Constraint

**Date**: 2025-10-12
**Related**: TTRC-216 (EO Enrichment Schema), TTRC-218 (EO Worker)
**Type**: 🔥 **HOTFIX** - Unblocks TTRC-218
**Status**: ✅ Ready to apply

---

## Purpose

**Fix severity constraint that's blocking the enrichment worker.**

Migration 023 added enrichment fields but didn't update the `severity` CHECK constraint. The old constraint expects old values (`low`, `medium`, `high`) but enrichment uses new values (`critical`, `severe`, `moderate`, `minor`).

**Without this fix, enrichment worker fails with**:
```
new row for relation "executive_orders" violates check constraint "executive_orders_severity_check"
```

---

## What This Migration Does

1. **Drops old severity constraint** (if exists)
2. **Creates new constraint** accepting: `critical`, `severe`, `moderate`, `minor`, or `NULL`
3. **Tests all new values** work correctly
4. **Verifies** constraint definition

---

## Impact Assessment

### Safety
- ✅ **Low Risk** - Only changes constraint definition
- ✅ **No data changes** - Only validation logic
- ✅ **Backward compatible** - Allows NULL (existing records)
- ✅ **Idempotent** - Safe to re-run

### Performance
- ⚡ **Instant** - Constraint change is metadata-only
- 📊 **No table scan** - CHECK constraint doesn't validate existing rows immediately

### Dependencies
- **Requires**: Migration 023 (adds severity column)
- **Unblocks**: TTRC-218 (enrichment worker)

---

## Pre-Flight Checklist

Before applying this migration, verify:

- [ ] Migration 023 has been applied
  ```sql
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'executive_orders'
  AND column_name IN ('severity', 'enriched_at');
  ```
  **Expected**: Both columns exist

- [ ] Current severity values (should all be NULL or old values)
  ```sql
  SELECT severity, COUNT(*)
  FROM executive_orders
  GROUP BY severity;
  ```

- [ ] Backup database (recommended for PROD)
  ```bash
  # Using Supabase CLI
  supabase db dump --file backup-$(date +%Y%m%d).sql
  ```

---

## Application Instructions

### For TEST Environment

```bash
# Option 1: Apply via psql
psql $DATABASE_URL -f migrations/024_eo_severity_constraint_fix.sql

# Option 2: Apply via Supabase Dashboard
# 1. Go to SQL Editor in Supabase Dashboard
# 2. Copy contents of 024_eo_severity_constraint_fix.sql
# 3. Paste and run

# Option 3: Apply via Supabase CLI
supabase db push
```

### For PROD Environment

**⚠️ IMPORTANT: Cherry-pick to main branch before applying to PROD**

```bash
# 1. Ensure this migration is on main branch
git checkout main
git cherry-pick <commit-hash>  # Commit from test branch
git push origin main

# 2. Apply to PROD database
# Same methods as TEST above, but use PROD credentials
```

---

## Verification

After applying, run these checks:

### 1. Constraint Definition
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'executive_orders'::regclass
AND conname = 'executive_orders_severity_check';
```

**Expected output**:
```
executive_orders_severity_check | CHECK ((severity IS NULL OR severity = ANY (ARRAY['critical'::text, 'severe'::text, 'moderate'::text, 'minor'::text])))
```

### 2. Test New Values Work
```sql
-- This should succeed (pick a real EO id)
UPDATE executive_orders
SET severity = 'critical'
WHERE id = (SELECT id FROM executive_orders LIMIT 1)
RETURNING id, order_number, severity;

-- Restore NULL
UPDATE executive_orders
SET severity = NULL
WHERE id = (SELECT id FROM executive_orders LIMIT 1);
```

### 3. Test Worker Runs
```bash
# Test enrichment with 1 EO
node scripts/enrichment/enrich-executive-orders.js 1
```

**Expected**: ✅ Enrichment completes successfully (no constraint error)

---

## Rollback Procedure

If you need to rollback (unlikely):

```sql
-- Drop new constraint
ALTER TABLE executive_orders
DROP CONSTRAINT IF EXISTS executive_orders_severity_check;

-- Restore old constraint (if you had old values)
ALTER TABLE executive_orders
ADD CONSTRAINT executive_orders_severity_check
  CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high'));
```

**NOTE**: Rollback only needed if you want to revert to old severity values. Since old values aren't used anymore, rollback is not recommended.

---

## Post-Application Tasks

After successful application:

1. **Test enrichment worker** with 3 EOs:
   ```bash
   node scripts/enrichment/enrich-executive-orders.js 3
   ```

2. **Verify enriched records**:
   ```sql
   SELECT order_number, severity, enriched_at, prompt_version
   FROM executive_orders
   WHERE enriched_at IS NOT NULL
   ORDER BY enriched_at DESC
   LIMIT 5;
   ```

3. **Check costs**:
   ```sql
   SELECT SUM(usd_estimate) as total_cost, COUNT(*) as enrichments
   FROM eo_enrichment_costs
   WHERE created_at >= CURRENT_DATE;
   ```

4. **Update JIRA**:
   - Mark TTRC-216 as complete
   - Update TTRC-218 status (unblocked)

---

## Common Issues

### Issue: Constraint already exists with correct definition
**Symptom**: Migration runs but says "constraint already exists"
**Solution**: This is fine - migration is idempotent. Verify with:
```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'executive_orders_severity_check';
```

### Issue: Some EOs have old severity values
**Symptom**: Migration fails because existing records have 'low'/'medium'/'high'
**Solution**: Update old values first:
```sql
UPDATE executive_orders
SET severity =
  CASE severity
    WHEN 'low' THEN 'minor'
    WHEN 'medium' THEN 'moderate'
    WHEN 'high' THEN 'severe'
    ELSE NULL
  END
WHERE severity IN ('low', 'medium', 'high');
```

---

## Files

- **SQL**: `migrations/024_eo_severity_constraint_fix.sql`
- **README**: `migrations/README_MIGRATION_024.md` (this file)
- **Related**:
  - `migrations/023_eo_enrichment_schema.sql` (parent migration)
  - `scripts/enrichment/enrich-executive-orders.js` (unblocked by this)

---

## Questions?

- **JIRA**: [TTRC-216](https://ajwolfe37.atlassian.net/browse/TTRC-216)
- **Slack**: #trumpytracker (if you have it)
- **Owner**: Josh Wolfe

---

**Status**: ✅ Ready to apply
**Risk**: 🟢 Low
**Duration**: ⚡ < 1 second
**Rollback**: Easy (but not recommended)

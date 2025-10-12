# Apply Migration 023 - Executive Orders Enrichment Schema

**Migration:** TTRC-216
**Database:** Supabase TEST
**Status:** ✅ Ready to apply (all feedback incorporated)

---

## ✅ All Improvements Applied

### High-Impact Fixes:
1. **Explicit array defaults** - `ARRAY[]::text[]` instead of `'{}'`
2. **action_section nullable** - `DEFAULT NULL` with CHECK constraint enforcing tier rules
3. **Day-one indexes** - 6 indexes (category, enriched_at, prompt_version, + 3 GIN for arrays)
4. **Telemetry FKs** - Dynamic type coercion to match `executive_orders.id` (INTEGER/UUID/TEXT)
5. **Grants** - service_role and authenticated access to new tables/sequences
6. **Hardened trigger** - Prevents prompt_version decreases, uses `IS DISTINCT FROM`

### Critical FK Fix:
- **Issue:** `executive_orders.id` is INTEGER, telemetry tables had TEXT `eo_id`
- **Solution:** Dynamic type detection + coercion before FK creation
- **Benefit:** FKs will work regardless of future schema changes (UUID migration, etc.)

---

## Quick Instructions

1. **Open Supabase SQL Editor:**
   - Go to: https://supabase.com/dashboard
   - Select TEST project: `wnrjrywpcadwutfykflu`
   - Click "SQL Editor" in left sidebar

2. **Open migration file:**
   - File: `migrations/023_eo_enrichment_schema.sql`
   - Copy entire contents (280 lines)

3. **Execute:**
   - Paste into SQL Editor
   - Click "Run" (or press Ctrl+Enter)
   - Wait 30-60 seconds

4. **Verify Success:**
   Look for these messages at bottom:
   ```
   ✅ Created (eo_category enum)
   ✅ Added (enrichment fields)
   ✅ Created (support tables)
   ✅ Created (write-once trigger)
   ✅ Types match (eo_id FK type check)
   ```

5. **Check Results:**
   Should show:
   - Total EOs: ~190
   - Enriched: 0
   - Unenriched: ~190
   - Categories: Distribution of new enum values
   - FK types match: ✅

---

## What This Migration Does

### 1. Creates EO-Specific Category Enum (10 values)
- `immigration_border`
- `environment_energy`
- `health_care`
- `education`
- `justice_civil_rights_voting`
- `natsec_foreign`
- `economy_jobs_taxes`
- `technology_data_privacy`
- `infra_housing_transport`
- `gov_ops_workforce`

### 2. Adds Enrichment Fields to `executive_orders`
**4-Part Analysis:**
- `section_what_they_say` (official language)
- `section_what_it_means` (plain English)
- `section_reality_check` (fact verification)
- `section_why_it_matters` (implications)

**Enhanced Metadata:**
- `regions[]` (geographic impact)
- `policy_areas[]` (policy domains)
- `affected_agencies[]` (implementing agencies)

**Action Framework:**
- `action_tier` (direct/systemic/tracking)
- `action_confidence` (0-10)
- `action_reasoning` (explanation)
- `action_section` (JSONB - NULL for tracking tier, required for others)

**Tracking:**
- `enriched_at` (timestamp)
- `prompt_version` (v1, v2, etc.)

### 3. Creates Support Tables with Auto-Type-Matching FKs
- `eo_enrichment_errors` - Dead-letter queue for failures
- `eo_enrichment_costs` - Telemetry for OpenAI costs
- **Dynamic FK type coercion** - Matches `executive_orders.id` type automatically

### 4. Migrates Legacy Categories
Maps old string categories → new enum:
- `immigration` → `immigration_border`
- `environment` → `environment_energy`
- `healthcare` → `health_care`
- `defense` → `natsec_foreign`
- `trade` → `economy_jobs_taxes`
- etc.

### 5. Adds Hardened Write-Once Trigger
- Prevents `prompt_version` decreases (v2 → v1 blocked)
- Prevents `enriched_at` updates without version increase
- Uses `IS DISTINCT FROM` for NULL safety

### 6. Adds Day-One Indexes
- Btree: `category`, `enriched_at`, `prompt_version`
- GIN: `regions[]`, `policy_areas[]`, `affected_agencies[]`

---

## Safety Features
- ✅ All changes use `IF NOT EXISTS` - safe to re-run
- ✅ All new columns have `NOT NULL DEFAULT` - backward compatible
- ✅ No data loss - only adds fields
- ✅ Category migration preserves all existing data
- ✅ FK types auto-match (INT/UUID/TEXT detection)
- ✅ Grants prevent 403 errors in Edge Functions

---

## After Migration Success

Run this verification query:
```sql
SELECT
  COUNT(*) as total_eos,
  COUNT(CASE WHEN enriched_at IS NOT NULL THEN 1 END) as enriched,
  COUNT(CASE WHEN enriched_at IS NULL THEN 1 END) as unenriched,
  COUNT(CASE WHEN section_what_they_say != '' THEN 1 END) as has_analysis,
  (SELECT data_type FROM information_schema.columns
   WHERE table_name='executive_orders' AND column_name='id') as id_type,
  (SELECT data_type FROM information_schema.columns
   WHERE table_name='eo_enrichment_costs' AND column_name='eo_id') as eo_id_type
FROM executive_orders;
```

Expected results:
- `total_eos`: ~190
- `enriched`: 0
- `unenriched`: 190
- `has_analysis`: 0
- `id_type`: integer
- `eo_id_type`: integer (✅ types match)

---

## Troubleshooting

### Error: "type eo_category already exists"
**Resolution:** Safe to ignore - means enum was created in previous run

### Error: "column already exists"
**Resolution:** Safe to ignore - means fields were added in previous run

### Error: "relation eo_enrichment_errors already exists"
**Resolution:** Safe to ignore - means tables were created in previous run

### Error: "foreign key constraint... column type mismatch"
**Resolution:** Should not occur - migration auto-detects and coerces types. If it does, check `executive_orders.id` type and telemetry table `eo_id` types match.

---

## Post-Backfill Validation

After TTRC-219 (enrichment backfill) completes, run:

```sql
ALTER TABLE executive_orders VALIDATE CONSTRAINT eo_action_tier_chk;
```

This validates the action_tier constraint and catches any violations from backfill.

---

## Next Steps After Success

1. ✅ Mark TTRC-216 as complete
2. → Start TTRC-217 (enrichment prompt)
3. → Start TTRC-218 (worker script)
4. → Run TTRC-219 (backfill ~190 EOs)

---

**Migration File:** `migrations/023_eo_enrichment_schema.sql` (280 lines)
**Created:** 2025-10-12
**Safe to Re-run:** Yes
**Estimated Time:** 30-60 seconds
**All Feedback Incorporated:** ✅

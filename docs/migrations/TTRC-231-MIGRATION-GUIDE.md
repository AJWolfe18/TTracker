# TTRC-231 Migration Guide: Story Lifecycle & Split/Merge System

**Target:** PRODUCTION database (when TEST validation complete)
**Risk Level:** LOW (additive changes only, no data modification)
**Estimated Time:** 5 minutes
**Rollback:** Safe (tables can be dropped without affecting existing data)

---

## Migration Sequence

Apply these migrations **in order** to PRODUCTION:

### 1. Migration 025: Story Merge Audit Trail
**File:** `/migrations/025_story_merge_audit.sql`

**What it does:**
- Creates `story_merge_actions` audit table
- Adds `merged_into` enum value to `story_status`
- Adds `merged_into_story_id` column to `stories` table
- Creates indexes for merge tracking

**How to apply:**
1. Open Supabase Dashboard → SQL Editor (PROD project)
2. Copy entire contents of `migrations/025_story_merge_audit.sql`
3. Paste and click "Run"
4. Verify: `SELECT COUNT(*) FROM story_merge_actions;` (should return 0)

**Rollback (if needed):**
```sql
DROP TABLE IF EXISTS story_merge_actions CASCADE;
ALTER TABLE stories DROP COLUMN IF EXISTS merged_into_story_id;
-- Note: Cannot remove enum value 'merged_into' once added (PostgreSQL limitation)
```

---

### 2. Migration 026: Story Split Audit Trail
**File:** `/migrations/026_story_split_audit.sql`

**What it does:**
- Creates `story_split_actions` audit table
- Adds basic indexes for split tracking

**How to apply:**
1. Open Supabase Dashboard → SQL Editor (PROD project)
2. Copy entire contents of `migrations/026_story_split_audit.sql`
3. Paste and click "Run"
4. Verify: `SELECT COUNT(*) FROM story_split_actions;` (should return 0)

**Rollback (if needed):**
```sql
DROP TABLE IF EXISTS story_split_actions CASCADE;
```

---

### 3. Migration 026.1: Story Split Audit Hardening
**File:** `/migrations/026.1_story_split_audit_hardening.sql`

**What it does:**
- Adds NOT NULL constraints to audit fields
- Adds CHECK constraints for data validity (coherence 0-1, counts non-negative)
- Adds GIN index for array overlap queries
- Enables Row Level Security (read-only for most operations)

**How to apply:**
1. Open Supabase Dashboard → SQL Editor (PROD project)
2. Copy entire contents of `migrations/026.1_story_split_audit_hardening.sql`
3. Paste and click "Run"
4. Verify constraints:
```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'story_split_actions';
```

**Rollback (if needed):**
```sql
-- Remove constraints added in 026.1
ALTER TABLE story_split_actions
  DROP CONSTRAINT IF EXISTS chk_coherence_0_1,
  DROP CONSTRAINT IF EXISTS chk_counts_nonneg;

DROP INDEX IF EXISTS idx_story_split_actions_new_ids_gin;

ALTER TABLE story_split_actions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select_all ON story_split_actions;
DROP POLICY IF EXISTS p_insert_service_role ON story_split_actions;
```

---

## Pre-Migration Checklist

Before applying to PROD:

- [ ] All migrations tested successfully in TEST environment
- [ ] `node scripts/test-ttrc231-manual.js all` passes in TEST
- [ ] Lifecycle transitions working correctly
- [ ] Auto-split detection tested with real data
- [ ] Periodic merge detection tested with duplicates
- [ ] Audit tables receiving data correctly in TEST
- [ ] No breaking changes to existing queries
- [ ] Schema cache refreshed (Supabase auto-refreshes after DDL)

---

## Post-Migration Verification

After applying to PROD:

### 1. Verify Tables Exist
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('story_merge_actions', 'story_split_actions');
```
Expected: 2 rows

### 2. Verify Indexes Created
```sql
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('story_merge_actions', 'story_split_actions')
ORDER BY tablename, indexname;
```
Expected: 7+ indexes

### 3. Verify Enum Value Added
```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'story_status')
ORDER BY enumlabel;
```
Expected: Should include 'merged_into'

### 4. Verify Column Added to Stories
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'stories' AND column_name = 'merged_into_story_id';
```
Expected: 1 row (bigint, nullable)

### 5. Test Read Access
```sql
SELECT COUNT(*) FROM story_merge_actions;
SELECT COUNT(*) FROM story_split_actions;
```
Expected: Both return 0 (empty tables)

---

## Impact Assessment

### What Changes
- **Database schema:** 2 new tables, 1 new column, 1 enum value
- **Indexes:** 7 new indexes (minimal storage impact)
- **RLS policies:** Read-only policies on audit tables

### What Doesn't Change
- **Existing data:** Zero modifications to stories/articles
- **API queries:** No breaking changes (new column is nullable)
- **Frontend:** No changes required (audit tables internal only)
- **Performance:** Negligible (empty tables, indexes on new columns only)

### Cost Impact
- **Storage:** ~10KB for empty tables + indexes
- **Compute:** No impact (tables not queried by frontend yet)
- **Total:** <$0.01/month

---

## Rollback Strategy

If issues arise after migration:

### Option 1: Drop New Tables (Safest)
```sql
DROP TABLE IF EXISTS story_merge_actions CASCADE;
DROP TABLE IF EXISTS story_split_actions CASCADE;
ALTER TABLE stories DROP COLUMN IF EXISTS merged_into_story_id;
```

**Note:** Cannot remove enum value 'merged_into' once added. This is harmless.

### Option 2: Disable Features (Keep Tables)
- Stop job queue worker from processing lifecycle/split/merge jobs
- Tables remain but are not populated
- Can re-enable later without re-running migrations

---

## Testing Plan (POST-PROD Migration)

Once migrations applied to PROD:

### Phase 1: Passive Monitoring (Week 1)
- Watch for schema errors in logs
- Verify no performance degradation
- Confirm audit tables remain empty (features not enabled yet)

### Phase 2: Enable Lifecycle Only (Week 2)
- Deploy code to update `lifecycle_state` field
- Monitor state transitions in PROD stories
- Verify no side effects

### Phase 3: Enable Auto-Split (Week 3)
- Deploy auto-split job to job queue
- Set conservative threshold (0.40 coherence)
- Monitor split actions in audit table
- Manually verify splits are correct

### Phase 4: Enable Periodic Merge (Week 4)
- Deploy merge detection job to job queue
- Set conservative threshold (0.80 similarity)
- Monitor merge actions in audit table
- Manually verify merges are correct

---

## Migration Commands Summary

```bash
# TEST Environment (already applied)
✅ Migration 025 applied
✅ Migration 026 applied
✅ Migration 026.1 applied

# PROD Environment (pending)
⏳ Apply migrations/025_story_merge_audit.sql
⏳ Apply migrations/026_story_split_audit.sql
⏳ Apply migrations/026.1_story_split_audit_hardening.sql
```

---

## Support & Troubleshooting

### Error: "enum value already exists"
**Cause:** Migration 025 was partially applied
**Fix:** Skip the enum addition, continue with rest of migration

### Error: "table already exists"
**Cause:** Migration was already applied
**Fix:** Verify tables exist, skip re-running migration

### Error: "constraint violation"
**Cause:** Data doesn't meet new constraints
**Fix:** Unlikely (tables are empty), but check for existing test data

### Schema Cache Not Refreshing
**Cause:** Supabase PostgREST cache delay
**Fix:** Wait 30 seconds, or restart PostgREST from Supabase Dashboard

---

## Questions?

- **Schema questions:** Check `/docs/database/database-schema.md`
- **TTRC-231 details:** See JIRA ticket or handoff docs
- **Test results:** Review `/docs/handoffs/2025-10-13-ttrc231-testing-results.md`

**Last Updated:** 2025-10-14
**Maintained by:** Josh + Claude Code

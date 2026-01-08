# 🚀 TrumpyTracker RSS Implementation - Action Plan

## Current Status
- ✅ On TEST branch
- ✅ Migration scripts created
- ✅ Verification script ready
- ✅ Test data fixtures prepared
- ✅ Supabase setup guide created
- ⏳ Ready to execute

## Phase 1: Database Migration (You do this now)

### Step 1: Access Supabase Test Database
1. Go to https://app.supabase.com
2. Select project: `wnrjrywpcadwutfykflu` (TEST)
3. Navigate to SQL Editor

### Step 2: Run Migration Script
1. Copy contents of `migrations/001_critical_fixes_v3.1.sql`
2. Paste into SQL Editor
3. Click "Run" 
4. You should see "Success" message

### Step 3: Verify Migration
1. Copy contents of `migrations/migration_verification.sql`
2. Paste into SQL Editor
3. Click "Run"
4. Check all items show ✅ PASS

### Step 4: Load Test Data
1. Copy contents of `migrations/test_data_fixtures.sql`
2. Paste into SQL Editor
3. Click "Run"
4. Verify counts at bottom show data created

## Phase 2: Supabase CLI Setup (We do together)

### Step 1: Install Prerequisites
```bash
# Install Node.js first if needed
# Then install Supabase CLI
npm install -g supabase
```

### Step 2: Initialize Supabase
```bash
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
supabase init
```

### Step 3: Link to Test Project
```bash
supabase link --project-ref wnrjrywpcadwutfykflu
```
You'll need the database password from Supabase dashboard.

## Phase 3: Edge Functions Implementation (I create, you deploy)

I will create these files:
1. `supabase/functions/stories-active/index.ts`
2. `supabase/functions/stories-detail/index.ts`
3. `supabase/functions/stories-search/index.ts`
4. `supabase/functions/articles-manual/index.ts`
5. `supabase/functions/_shared/cors.ts`
6. `supabase/functions/_shared/auth.ts`

## Phase 4: Testing

### Local Testing:
```bash
# Start local Supabase
supabase start

# Serve functions
supabase functions serve

# Test endpoint
curl http://localhost:54321/functions/v1/stories-active
```

### Deploy to Test:
```bash
# Deploy all functions
supabase functions deploy

# Set secrets
supabase secrets set ADMIN_API_KEY=<generate-secure-key>
```

### Test on Live URL:
```bash
curl https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/stories-active \
  -H "apikey: <YOUR_ANON_KEY>"
```

## Phase 5: Integration Tests

I will create:
- `test/edge-functions.test.js` - API endpoint tests
- `test/clustering.test.js` - Clustering algorithm tests
- `test/job-queue.test.js` - Queue processing tests

## Commit Schedule

After each successful phase:

1. **After Migration:**
   ```
   git add migrations/
   git commit -m "TTRC-160: Add database migration scripts for RSS system"
   ```

2. **After Edge Functions:**
   ```
   git add supabase/functions/
   git commit -m "TTRC-135: Implement Edge Functions API endpoints"
   ```

3. **After Job Queue:**
   ```
   git add supabase/functions/job-worker/
   git commit -m "TTRC-137: Add job queue worker implementation"
   ```

4. **After Tests:**
   ```
   git add test/
   git commit -m "TEST: Add integration tests for Edge Functions"
   ```

## Success Checklist

### Phase 1 ✓ Complete when:
- [ ] Migration runs without errors
- [ ] Verification shows all PASS
- [ ] Test data loads successfully

### Phase 2 ✓ Complete when:
- [ ] Supabase CLI installed
- [ ] Project linked to test database
- [ ] Can run `supabase status`

### Phase 3 ✓ Complete when:
- [ ] All 4 endpoints return data
- [ ] Pagination works
- [ ] Search returns results

### Phase 4 ✓ Complete when:
- [ ] Job queue processes enrichment
- [ ] Cost controls enforced
- [ ] Idempotency works

## Next Actions

**YOU DO NOW:**
1. Run the migration script in Supabase SQL Editor
2. Run the verification script
3. Run the test data script
4. Report back with results

**THEN WE DO:**
1. Set up Supabase CLI together
2. I create the Edge Functions
3. We test locally
4. Deploy to test environment

## Questions to Answer:
1. Did the migration run successfully?
2. Did verification show all PASS?
3. How many test records were created?
4. Any errors or warnings?

---
Ready to start! Run the migration and let me know the results. 🚀
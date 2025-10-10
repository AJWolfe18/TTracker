# TTRC-137 Phase 1 Deployment Checklist

## ✅ Files That Should Exist:

### 1. Database Migrations
- [x] `migrations/006_align_job_queue_columns_p1_fixes.sql` - P1 schema fixes

### 2. Edge Functions  
- [x] `supabase/functions/rss-enqueue/index.ts` - RSS job scheduling
- [x] `supabase/functions/queue-stats/index.ts` - Queue monitoring

### 3. Worker & Scripts
- [x] `scripts/job-queue-worker.js` - Main job processor
- [x] `scripts/rss/fetch_feed.js` - RSS feed fetcher
- [x] `scripts/utils/network.js` - Network utilities
- [x] `scripts/utils/security.js` - Security utilities
- [x] `scripts/test-ttrc-137-phase1.js` - Phase 1 test suite

### 4. GitHub Actions
- [x] `.github/workflows/job-scheduler.yml` - Automated scheduling
- [x] `.github/workflows/test-rss-real.yml` - RSS testing workflow

### 5. Deployment Tools
- [x] `deploy-phase1.bat` - Windows deployment script
- [x] `test-edge-deployment.js` - Deployment verification

## 🚀 Deployment Steps:

### Step 1: Deploy Database Migration
```sql
-- Go to: https://app.supabase.com/project/wnrjrywpcadwutfykflu/sql
-- Run the entire contents of: migrations/006_align_job_queue_columns_p1_fixes.sql
```

### Step 2: Deploy Edge Functions
```cmd
deploy-phase1.bat
```
Or manually:
```cmd
npx supabase functions deploy rss-enqueue --project-ref wnrjrywpcadwutfykflu
npx supabase functions deploy queue-stats --project-ref wnrjrywpcadwutfykflu
```

### Step 3: Set GitHub Secrets
Go to: https://github.com/[your-repo]/settings/secrets/actions

Add these secrets:
- `EDGE_CRON_TOKEN` - Generate with: `openssl rand -hex 32` or any secure string
- `SUPABASE_URL` - https://wnrjrywpcadwutfykflu.supabase.co
- `SUPABASE_TEST_SERVICE_KEY` - Your service role key (already in .env)

### Step 4: Test Deployment
```cmd
node test-edge-deployment.js
```

### Step 5: Run Phase 1 Tests
```cmd
SET NODE_ENV=test
node scripts/test-ttrc-137-phase1.js
```

### Step 6: Enable GitHub Actions
The workflow will automatically run when you push to test branch.

## ⚠️ Common Issues:

1. **"column does not exist" errors**
   - Solution: Run migration 006 in Supabase SQL editor

2. **Edge Functions return 404**
   - Solution: Run `deploy-phase1.bat` to deploy them

3. **Auth failures (401)**
   - Solution: Set EDGE_CRON_TOKEN in GitHub Secrets

4. **Test failures**
   - Solution: Check all steps above completed in order

## 📝 Commit & Push:
```cmd
git add .
git commit -m "Deploy TTRC-137 Phase 1 - Job queue infrastructure"
git push origin test
```

## ✅ Success Criteria:
- [ ] Migration applied (no column errors)
- [ ] Edge Functions deployed (no 404s)
- [ ] GitHub Actions running (check Actions tab)
- [ ] All Phase 1 tests passing
- [ ] Job queue processing RSS feeds

## 📊 Monitor:
After deployment, monitor for 48 hours:
- Check Supabase logs for errors
- Verify RSS feeds being fetched
- Watch job_queue table for processing
- Memory usage stays under 512MB
- Error rate stays under 5%

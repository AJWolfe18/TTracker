# RSS E2E Test Setup - Complete Summary

## ✅ Files Created (ALL IN YOUR REPO)

| File | Location | Purpose | Status |
|------|----------|---------|---------|
| `rss-e2e-test.yml` | `.github/workflows/` | Main E2E test workflow | ✅ Created |
| `test-secrets.yml` | `.github/workflows/` | Verify GitHub secrets | ✅ Created |
| `verify-test-schema.js` | `scripts/` | Check database schema locally | ✅ Created |
| `environment-variables-setup.md` | `docs/` | Complete env var documentation | ✅ Created |
| `rss-e2e-test-summary.md` | `docs/` | This file - setup summary | ✅ Creating now |

## 🎯 What These Files Do

### 1. **rss-e2e-test.yml**
- Checks if database migrations are applied
- Seeds RSS feeds (NYT, WaPo)
- Creates job queue entries
- Runs the RSS worker
- Verifies articles are created in `articles` table
- Generates test report

### 2. **test-secrets.yml**
- Quick check that all GitHub secrets exist
- Tests connection to Supabase TEST instance
- Run this FIRST to verify setup

### 3. **verify-test-schema.js**
- Local script to check database schema
- Verifies `articles` table exists (not political_entries)
- Checks all RSS tables
- Tests atomic function exists

### 4. **environment-variables-setup.md**
- Complete documentation of all env variables
- Shows which GitHub secrets are needed
- Has troubleshooting guide

## 🚀 How to Use These Files

### Step 1: Commit to Main Branch
```bash
git add .github/workflows/rss-e2e-test.yml
git add .github/workflows/test-secrets.yml
git add scripts/verify-test-schema.js
git add docs/environment-variables-setup.md
git add docs/rss-e2e-test-summary.md
git commit -m "Add RSS E2E test suite with articles table support"
git push origin main
```

### Step 2: Test GitHub Secrets
1. Go to GitHub → Actions tab
2. Select "Test GitHub Secrets"
3. Click "Run workflow"
4. Verify all show ✅

### Step 3: Run RSS E2E Test
1. Go to Actions tab
2. Select "RSS E2E Test (Articles Table)"
3. Click "Run workflow"
4. Select "test" environment
5. Watch the results!

## 📊 Expected Results

When successful, you should see:
```
✅ articles table exists
✅ RSS feeds seeded
✅ Jobs created
✅ Articles ingested
✅ Test report generated
```

## ⚠️ Common Issues & Solutions

### "Migrations needed"
The workflow will tell you exactly which migrations to run:
1. Go to Supabase Dashboard → SQL Editor
2. Run `migrations/003_atomic_article_upsert_production_ready.sql`
3. Run `migrations/004_fix_generated_columns_and_constraints.sql`

### "No articles created"
- Check worker logs in the workflow output
- Verify RSS feeds are accessible
- Check job_queue for errors

### "political_entries not found"
**GOOD!** This means TEST is using the correct `articles` table.

## 🔍 Database Schema Status

### TEST Environment (Correct)
- ✅ Uses `articles` table
- ✅ Has RSS tables (stories, feed_registry, etc.)
- ✅ No political_entries (legacy)

### PROD Environment (Legacy)
- ⚠️ Still uses `political_entries` table
- Will be migrated later

## 📝 Key Points to Remember

1. **TEST uses `articles`**, PROD uses `political_entries`
2. All workflows must be on **main branch** to run
3. The actual RSS code is on **test branch**
4. GitHub secrets are already configured (verified in screenshot)

## 🚦 Ready to Go!

All files are created in your repository. Just commit and push to main, then run the workflows!

---

**Created**: September 22, 2025
**Purpose**: RSS E2E Testing with correct `articles` table
**Environment**: TEST (wnrjrywpcadwutfykflu)

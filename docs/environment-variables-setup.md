# TrumpyTracker Environment Variables & Secrets Documentation

## ⚠️ CRITICAL DATABASE SCHEMA UPDATE
**As of September 2025:**
- **TEST Environment**: Uses `articles` table (NEW schema)
- **PROD Environment**: Uses `political_entries` table (LEGACY)
- **Never use `political_entries` in TEST environment code!**

## GitHub Secrets Required

These secrets must be set in your GitHub repository for workflows to function.

### Setting GitHub Secrets
1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each secret below

### Required TEST Environment Secrets

| Secret Name | Description | Where to Find | Status |
|------------|-------------|---------------|---------|
| `SUPABASE_TEST_URL` | TEST Supabase instance URL | `.env` file or Supabase dashboard | ✅ Set |
| `SUPABASE_TEST_ANON_KEY` | TEST anonymous/public key | `.env` file or Supabase dashboard → Settings → API | ✅ Set |
| `SUPABASE_TEST_SERVICE_KEY` | TEST service role key (full access) | `.env` file or Supabase dashboard → Settings → API | ✅ Set |
| `OPENAI_API_KEY` | OpenAI API key for clustering | OpenAI dashboard or `.env` file | ✅ Set |
| `ADMIN_API_KEY` | Custom admin key for protected endpoints | `.env` file (default: `my-secure-admin-key-2025`) | Not needed for E2E |

### TEST Environment Values (from .env)

```bash
# These are already in your .env file
SUPABASE_TEST_URL=https://wnrjrywpcadwutfykflu.supabase.co
SUPABASE_TEST_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4
SUPABASE_TEST_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTIyMDczNywiZXhwIjoyMDcwNzk2NzM3fQ.V3dJTwxr7XcoOXk-9P8qrY0McaQ1HfG-yjCdLx-fEuo
```

## GitHub Environments Setup (Optional but Recommended)

### Create a TEST Environment
1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name it: `test`
4. Add the same secrets as above
5. Optional: Add protection rules
   - Required reviewers
   - Deployment branches: `test` only

### Benefits of Using Environments
- Secrets are scoped to specific workflows
- Can add approval requirements
- Better security isolation
- Clear separation between TEST and PROD

## Local Development Setup

Your `.env` file should contain:

```bash
# OpenAI for clustering
OPENAI_API_KEY=your_openai_key_here

# Admin authentication
ADMIN_API_KEY=my-secure-admin-key-2025

# TEST Environment (what we use for development)
SUPABASE_TEST_URL=https://wnrjrywpcadwutfykflu.supabase.co
SUPABASE_TEST_ANON_KEY=eyJhbG...
SUPABASE_TEST_SERVICE_KEY=eyJhbG...

# These are aliases for scripts that expect SUPABASE_URL
SUPABASE_URL=https://wnrjrywpcadwutfykflu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

## Verifying Your Setup

### Check GitHub Secrets
Run the "Test GitHub Secrets" workflow to verify all secrets are configured.

### Check Database Schema
Run this locally:
```bash
node scripts/verify-test-schema.js
```

Or use the RSS E2E test workflow to verify:
1. `articles` table exists (NOT `political_entries`)
2. RSS tables exist (`stories`, `feed_registry`, etc.)
3. Migrations are applied

## Common Issues

### "Cannot find political_entries table"
- **Issue**: Code is using old table name
- **Fix**: Update to use `articles` table
- **Check**: No TEST code should reference `political_entries`

### "GitHub Action can't find secret"
- **Issue**: Secret not set or typo in name
- **Fix**: Check Settings → Secrets → Actions
- **Note**: Secret names are case-sensitive

### "Workflow only runs from main branch"
- **Issue**: GitHub limitation for workflow_dispatch
- **Fix**: Merge workflow to main, but configure to checkout test branch

## Migration Checklist

Before running RSS system:
- [ ] Migration 003 applied (atomic upsert function)
- [ ] Migration 004 applied (fixes)
- [ ] `articles` table exists
- [ ] `feed_registry` has RSS feeds
- [ ] Job queue worker can connect

## Quick Test Commands

```bash
# Test local connection to TEST database
node scripts/verify-test-schema.js

# Run E2E test locally (requires .env)
NODE_ENV=test node scripts/test-rss-pipeline.js

# Check what tables exist
node scripts/check-schema.js
```

## Supabase Dashboard Links

- **TEST Dashboard**: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu
- **PROD Dashboard**: https://supabase.com/dashboard/project/kprtqcdgwgfrzqudbcyz

---

**Document Version**: 2.0  
**Last Updated**: September 2025  
**Critical**: Always use `articles` table in TEST, never `political_entries`

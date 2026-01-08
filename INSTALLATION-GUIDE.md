# TrumpyTracker Installation Guide - TTRC-137 Job Queue System

## Environment Variables Setup

### 1. Create/Update `.env` File

Your `.env` file needs these variables for the RSS system to work:

```env
# Environment variables for local development
# DO NOT COMMIT THIS FILE TO GITHUB

# Your OpenAI API key
OPENAI_API_KEY=your-openai-key-here

# Your Admin API key
ADMIN_API_KEY=my-secure-admin-key-2025

# ===============================================
# SUPABASE TEST ENVIRONMENT
# ===============================================
SUPABASE_TEST_URL=https://wnrjrywpcadwutfykflu.supabase.co
SUPABASE_TEST_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjI4ODM0NTUsImV4cCI6MjAzODQ1OTQ1NX0.VbBpB1E3kxcSfn3PTLRudrfcQUONOjWiTlUJQqF2M9w
SUPABASE_TEST_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMjg4MzQ1NSwiZXhwIjoyMDM4NDU5NDU1fQ.B88ENJM5YQvMWOOvGjG9uHJLH9N3dQUngJglAk_6fac

# TEST Edge Function Auth Token
# This token protects Edge Functions in TEST environment
# Also add this same token to GitHub Secrets as EDGE_CRON_TOKEN
EDGE_CRON_TOKEN=your-secure-token-here

# ===============================================
# SUPABASE PRODUCTION ENVIRONMENT (future)
# ===============================================
# When ready for production, add these (with DIFFERENT tokens!):
# SUPABASE_PROD_URL=https://osjbulmltfpcoldydexg.supabase.co
# SUPABASE_PROD_SERVICE_KEY=your-production-service-key-here
# EDGE_CRON_TOKEN_PROD=different-secure-token-for-prod
```

### 2. Generate Secure Token

In PowerShell, generate a secure token:

```powershell
# Option 1: Using GUIDs
$token = (New-Guid).ToString() + (New-Guid).ToString()
Write-Host $token

# Option 2: Using random hex
$bytes = New-Object byte[] 32
[Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
$token = [BitConverter]::ToString($bytes).Replace('-','').ToLower()
Write-Host $token
```

### 3. Environment Variable Names Explained

| Variable | Environment | Purpose |
|----------|------------|---------|
| `SUPABASE_TEST_URL` | TEST | Test database URL |
| `SUPABASE_TEST_SERVICE_KEY` | TEST | Admin access to test database |
| `EDGE_CRON_TOKEN` | TEST | Protects Edge Functions from unauthorized calls |
| `SUPABASE_PROD_URL` | PROD | Production database URL (future) |
| `SUPABASE_PROD_SERVICE_KEY` | PROD | Admin access to prod database (future) |
| `EDGE_CRON_TOKEN_PROD` | PROD | Different token for production (future) |

### 4. GitHub Secrets Setup

Add these to your GitHub repository secrets:

1. Go to: `https://github.com/[your-username]/[your-repo]/settings/secrets/actions`
2. Add these secrets:
   - `EDGE_CRON_TOKEN` - Same value as in your .env file
   - `SUPABASE_URL` - https://wnrjrywpcadwutfykflu.supabase.co
   - `SUPABASE_TEST_SERVICE_KEY` - Same as in .env file

### 5. Security Best Practices

- **NEVER** commit `.env` to Git (it's in .gitignore)
- **USE DIFFERENT** tokens for TEST vs PROD
- **ROTATE** tokens periodically
- **KEEP** service keys secret - they have admin access

### 6. Testing Your Setup

After setting up environment variables:

```powershell
# Test that variables are loaded
node -e "require('dotenv').config(); console.log('TEST_URL:', process.env.SUPABASE_TEST_URL ? '✅ Set' : '❌ Missing'); console.log('SERVICE_KEY:', process.env.SUPABASE_TEST_SERVICE_KEY ? '✅ Set' : '❌ Missing'); console.log('EDGE_TOKEN:', process.env.EDGE_CRON_TOKEN ? '✅ Set' : '❌ Missing');"
```

### 7. Common Issues

**"Invalid API key" errors:**
- Check `SUPABASE_TEST_SERVICE_KEY` is set correctly
- Make sure you're using the service role key, not the anon key

**"Auth failed" on Edge Functions:**
- Check `EDGE_CRON_TOKEN` is set in both .env and GitHub Secrets
- Make sure the token matches exactly (no extra spaces)

**"Column does not exist" errors:**
- Run migration 006_align_job_queue_columns.sql in Supabase SQL Editor

## Full Installation Checklist

- [ ] `.env` file created with all TEST variables
- [ ] `EDGE_CRON_TOKEN` generated and added to .env
- [ ] GitHub Secrets configured
- [ ] Database migration 006 applied
- [ ] Edge Functions deployed (rss-enqueue, queue-stats)
- [ ] Test script passes: `node scripts/test-ttrc-137-phase1.js`

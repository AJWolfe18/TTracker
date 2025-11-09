# TrumpyTracker Environment Variables & Secrets Documentation

**Last Updated:** November 2025
**Version:** 3.0

## Table of Contents
1. [Critical Database Info](#critical-database-schema-update)
2. [Required Secrets](#github-secrets-required)
3. [Optional Configuration](#optional-configuration-variables)
4. [Local Development Setup](#local-development-setup)
5. [Verification & Testing](#verifying-your-setup)

---

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

---

## Optional Configuration Variables

These environment variables are **optional** and have sensible defaults. Set them only if you need to customize behavior.

### Article Scraping (TTRC-258)

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `SCRAPE_MAX_CHARS` | `5000` | Max characters per scraped article | `SCRAPE_MAX_CHARS=10000` |
| `SCRAPE_MIN_GAP_MS` | `1000` | Min milliseconds between same-host requests | `SCRAPE_MIN_GAP_MS=2000` |
| `SCRAPE_DOMAINS` | `csmonitor.com,pbs.org,...` | Comma-separated allow-list | `SCRAPE_DOMAINS=csmonitor.com,propublica.org` |

**Default allow-list:**
```
csmonitor.com,pbs.org,propublica.org,reuters.com,apnews.com,politico.com
```

**Documentation:** See `docs/architecture/article-scraping.md` for full details

---

### RSS Feed Processing

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `RSS_MAX_BYTES` | `5000000` (5MB) | Max bytes per RSS feed | `RSS_MAX_BYTES=10000000` |
| `RSS_MAX_ITEMS` | `50` | Max items to process per feed | `RSS_MAX_ITEMS=100` |
| `MAX_ARTICLE_AGE_HOURS` | `72` | Skip articles older than this | `MAX_ARTICLE_AGE_HOURS=48` |
| `FETCH_TIMEOUT_MS` | `10000` (10s) | HTTP fetch timeout | `FETCH_TIMEOUT_MS=15000` |
| `FETCH_MAX_RETRIES` | `3` | Max retries for failed fetches | `FETCH_MAX_RETRIES=5` |
| `FETCH_BASE_DELAY_MS` | `1000` (1s) | Base delay between retries | `FETCH_BASE_DELAY_MS=2000` |

---

### Job Queue Worker

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `MAX_EMPTY_POLLS` | `120` | Worker exits after this many empty polls | `MAX_EMPTY_POLLS=240` |
| `STALE_JOB_MINUTES` | `10` | Reclaim jobs stuck in 'claimed' state | `STALE_JOB_MINUTES=15` |
| `LOG_LEVEL` | `info` | Logging verbosity (debug/info/warn/error) | `LOG_LEVEL=debug` |

---

### Executive Orders Tracking

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `EO_LOOKBACK_DAYS` | `7` | How many days to check for new EOs | `EO_LOOKBACK_DAYS=14` |

---

### Duplicate Detection (Advanced)

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `DUPLICATE_SIMILARITY_THRESHOLD` | `0.85` | Cosine similarity threshold (0-1) | `DUPLICATE_SIMILARITY_THRESHOLD=0.90` |
| `DUPLICATE_WORD_THRESHOLD` | `10` | Min word count for comparison | `DUPLICATE_WORD_THRESHOLD=15` |
| `DUPLICATE_COMPARISON_LENGTH` | `500` | Max chars to compare | `DUPLICATE_COMPARISON_LENGTH=1000` |
| `DUPLICATE_SCORE_THRESHOLD` | `0.80` | Overall duplicate score threshold | `DUPLICATE_SCORE_THRESHOLD=0.85` |
| `DUPLICATE_DEBUG_LOG` | `false` | Enable debug logging | `DUPLICATE_DEBUG_LOG=true` |

---

### Testing & Debugging

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `NODE_ENV` | `development` | Environment mode (test/development/production) | `NODE_ENV=test` |
| `DEBUG_COUNTS` | `false` | Log detailed counts in clustering | `DEBUG_COUNTS=true` |
| `DRY_RUN` | `false` | Simulate operations without writing to DB | `DRY_RUN=true` |

---

### System Variables (Auto-Set)

These are typically set automatically by the system or CI/CD:

| Variable | Set By | Description |
|----------|--------|-------------|
| `CI` | GitHub Actions | Indicates running in CI environment |
| `GITHUB_ACTIONS` | GitHub Actions | Indicates running in GitHub Actions |
| `DATABASE_URL` | Supabase | Auto-generated connection string (if needed) |

---

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

---

## Quick Reference: Common Configurations

### Increase Scraping Quality
```bash
# Get more context per article (costs more)
SCRAPE_MAX_CHARS=10000

# Be more polite to servers
SCRAPE_MIN_GAP_MS=2000
```

### Speed Up Development
```bash
# Process fewer articles per feed
RSS_MAX_ITEMS=10

# Shorter timeouts
FETCH_TIMEOUT_MS=5000

# More verbose logging
LOG_LEVEL=debug
```

### Debug Clustering Issues
```bash
# Enable detailed logging
DEBUG_COUNTS=true
DUPLICATE_DEBUG_LOG=true

# Adjust similarity thresholds
DUPLICATE_SIMILARITY_THRESHOLD=0.90
```

### Test Without Writing to DB
```bash
# Dry run mode
DRY_RUN=true
```

---

## All Environment Variables Summary

**Required (must be set in `.env`):**
- `OPENAI_API_KEY` - For AI clustering and enrichment
- `SUPABASE_URL` (or `SUPABASE_TEST_URL`) - Database URL
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_TEST_SERVICE_KEY`) - Database auth

**Optional (have defaults):**
- **Scraping:** `SCRAPE_MAX_CHARS`, `SCRAPE_MIN_GAP_MS`, `SCRAPE_DOMAINS`
- **RSS:** `RSS_MAX_BYTES`, `RSS_MAX_ITEMS`, `MAX_ARTICLE_AGE_HOURS`, `FETCH_TIMEOUT_MS`, `FETCH_MAX_RETRIES`, `FETCH_BASE_DELAY_MS`
- **Worker:** `MAX_EMPTY_POLLS`, `STALE_JOB_MINUTES`, `LOG_LEVEL`
- **EO:** `EO_LOOKBACK_DAYS`
- **Dedup:** `DUPLICATE_*` variables
- **Debug:** `NODE_ENV`, `DEBUG_COUNTS`, `DRY_RUN`

**Total count:** 3 required + 25+ optional

---

**Document Version**: 3.0
**Last Updated**: November 2025
**Critical**: Always use `articles` table in TEST, never `political_entries`

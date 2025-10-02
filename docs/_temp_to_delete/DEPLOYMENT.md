# TrumpyTracker Deployment Guide

## Overview

This guide covers deploying TrumpyTracker from scratch, including database setup, hosting configuration, and automation setup.

## Prerequisites

Before starting, you'll need:
- GitHub account
- Supabase account (free tier)
- Netlify account (free tier)
- OpenAI API key ($5-10/month usage)
- Node.js 16+ installed locally
- Git installed locally

## Table of Contents
1. [Database Setup (Supabase)](#1-database-setup-supabase)
2. [Repository Setup (GitHub)](#2-repository-setup-github)
3. [Edge Functions Setup](#3-edge-functions-setup)
4. [Job Queue Setup](#4-job-queue-setup)
5. [Hosting Setup (Netlify)](#5-hosting-setup-netlify)
6. [Automation Setup (GitHub Actions)](#6-automation-setup-github-actions)
7. [Test Environment Setup](#7-test-environment-setup)
8. [Verification & Testing](#8-verification--testing)
9. [Maintenance](#9-maintenance)

## 1. Database Setup (Supabase)

### Migration Order (CRITICAL)

Migrations MUST be run in this exact order:
1. `001_rss_system_PRODUCTION_READY.sql` - Base RSS tables
2. `002_job_queue_functions.sql` - Database functions
3. `003_atomic_article_upsert_production_ready.sql` - Atomic operations
4. `004_fix_generated_columns_and_constraints.sql` - SR dev fixes
5. `005_queue_stats_function.sql` - Stats monitoring
6. `006_align_job_queue_columns_p1_fixes.sql` - **REQUIRED for TTRC-137**

### Create Supabase Project

1. Go to [app.supabase.com](https://app.supabase.com)
2. Click "New Project"
3. Set up database with migrations (see Migration Order above)

## 2. Repository Setup (GitHub)

[Content continues...]

## 3. Edge Functions Setup

### Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Deploy functions (replace with your project ref)
supabase functions deploy rss-enqueue --project-ref YOUR_PROJECT_REF
supabase functions deploy queue-stats --project-ref YOUR_PROJECT_REF
supabase functions deploy stories-active --project-ref YOUR_PROJECT_REF
supabase functions deploy stories-detail --project-ref YOUR_PROJECT_REF
```

### Configure Edge Function Secrets

```bash
# Set the cron token (generate a secure random token)
supabase secrets set EDGE_CRON_TOKEN=your-secure-token --project-ref YOUR_PROJECT_REF
```

## 4. Job Queue Setup

### Start Job Queue Worker

```bash
# Set environment variables
export NODE_ENV=production
export SUPABASE_URL=your-supabase-url
export SUPABASE_SERVICE_ROLE_KEY=your-service-key
export OPENAI_API_KEY=your-openai-key
export EDGE_CRON_TOKEN=your-edge-token

# Install dependencies
npm install

# Start worker (use PM2 for production)
npm install -g pm2
pm2 start scripts/job-queue-worker.js --name "job-worker"
pm2 save
pm2 startup
```

### Monitor Job Queue

```bash
# Check queue status
curl https://YOUR_PROJECT.supabase.co/functions/v1/queue-stats \
  -H "Authorization: Bearer YOUR_EDGE_TOKEN"

# Check worker logs
pm2 logs job-worker
```

## 5. Hosting Setup (Netlify)

[Original Netlify content continues...]

3. Configure:
   - **Organization**: Your org or create new
   - **Project Name**: `trumpytracker-prod`
   - **Database Password**: Generate strong password (save this!)
   - **Region**: Choose closest to your users
   - **Plan**: Free tier

### Run Database Schema

1. Go to SQL Editor in Supabase dashboard
2. Create new query
3. Copy and run this schema:

```sql
-- Create political_entries table
CREATE TABLE political_entries (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    actor TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT,
    source_url TEXT,
    verified BOOLEAN DEFAULT false,
    severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create executive_orders table
CREATE TABLE executive_orders (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    order_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    federal_register_url TEXT,
    severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
    category TEXT,
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_political_entries_date_actor ON political_entries(date DESC, actor);
CREATE INDEX idx_political_entries_category_severity ON political_entries(category, severity);
CREATE INDEX idx_political_entries_archived_date ON political_entries(archived, date DESC);
CREATE INDEX idx_political_entries_created_at ON political_entries(created_at DESC);

CREATE INDEX idx_executive_orders_date ON executive_orders(date DESC);
CREATE INDEX idx_executive_orders_order_number ON executive_orders(order_number);
CREATE INDEX idx_executive_orders_archived ON executive_orders(archived, date DESC);

-- Enable Row Level Security
ALTER TABLE political_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_orders ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Public can read non-archived political entries" 
ON political_entries FOR SELECT 
USING (archived = false);

CREATE POLICY "Public can read non-archived executive orders" 
ON executive_orders FOR SELECT 
USING (archived = false);

-- Create update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_political_entries_updated_at 
BEFORE UPDATE ON political_entries 
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_executive_orders_updated_at 
BEFORE UPDATE ON executive_orders 
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
```

### Get API Keys

1. Go to Settings → API in Supabase
2. Copy and save:
   - **Project URL**: `https://YOUR_PROJECT.supabase.co`
   - **Anon Key**: For public access (safe to expose)
   - **Service Role Key**: For admin access (keep secret!)

## 2. Repository Setup (GitHub)

### Fork or Clone Repository

**Option A: Fork (Recommended)**
1. Go to [github.com/AJWolfe18/TTracker](https://github.com/AJWolfe18/TTracker)
2. Click "Fork" button
3. Create fork in your account

**Option B: Clone and Create New**
```bash
git clone https://github.com/AJWolfe18/TTracker.git
cd TTracker
rm -rf .git
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_REPO_URL
git push -u origin main
```

### Configure Repository Secrets

1. Go to Settings → Secrets and variables → Actions
2. Add these repository secrets:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_KEY`: Your service role key
   - `GITHUB_TOKEN`: (automatically provided)

### Update Configuration Files

1. Edit `config/supabase-config.js`:
```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

2. Edit `public/supabase-browser-config.js`:
```javascript
window.SUPABASE_CONFIG = {
    url: 'https://YOUR_PROJECT.supabase.co',
    anonKey: 'your-anon-key-here'
};
```

3. Commit and push changes:
```bash
git add .
git commit -m "Update Supabase configuration"
git push
```

## 3. Hosting Setup (Netlify)

### Create Netlify Account

1. Go to [app.netlify.com](https://app.netlify.com)
2. Sign up with GitHub (recommended)

### Deploy Site

1. Click "Add new site" → "Import an existing project"
2. Choose GitHub
3. Select your TTracker repository
4. Configure build settings:
   - **Branch**: `main`
   - **Base directory**: (leave empty)
   - **Build command**: (leave empty)
   - **Publish directory**: `public`
5. Click "Deploy site"

### Configure Custom Domain (Optional)

1. Go to Domain settings
2. Add custom domain
3. Follow DNS configuration instructions
4. Enable HTTPS (automatic)

### Enable Branch Deploys

1. Go to Site settings → Build & deploy
2. Branch deploys → Configure
3. Add branch: `test`
4. Save

## 4. Automation Setup (GitHub Actions)

### Enable GitHub Actions

1. Go to repository Settings → Actions → General
2. Ensure "Actions permissions" is set to "Allow all actions"

### Verify Workflows

Check that these workflows exist in `.github/workflows/`:
- `daily-tracker.yml` - Daily political tracking
- `executive-orders-tracker.yml` - Executive orders monitoring
- `process-manual-article.yml` - Manual article processing

### Test Manual Trigger

1. Go to Actions tab
2. Select "Daily Political Tracker"
3. Click "Run workflow"
4. Check logs for success

### Schedule Verification

Daily trackers run automatically:
- Political Tracker: 9:00 AM EST daily
- Executive Orders: 10:00 AM EST daily

## 5. Test Environment Setup

### Create Test Database

1. Create second Supabase project: `trumpytracker-test`
2. Run same schema as production
3. Save test API keys

### Configure Test Branch

1. Create test branch:
```bash
git checkout -b test
touch TEST_BRANCH_MARKER.md
git add TEST_BRANCH_MARKER.md
git commit -m "Add test branch marker"
git push -u origin test
```

2. Update test configuration in `config/supabase-config-test.js`:
```javascript
const SUPABASE_URL = 'https://YOUR_TEST_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'your-test-anon-key';
```

### Verify Test Deployment

1. Push to test branch
2. Check Netlify for test deployment
3. Access at: `https://test--YOUR-SITE.netlify.app/`

## 6. Verification & Testing

### Production Checklist

- [ ] Database connection works
- [ ] Dashboard loads data
- [ ] Admin panel accessible
- [ ] Manual article submission works
- [ ] GitHub Actions run successfully
- [ ] Daily automation triggers
- [ ] Executive orders tracker works

### Test URLs

**Production:**
- Dashboard: `https://your-site.netlify.app/`
- Admin: `https://your-site.netlify.app/admin-supabase.html`
- Health Check: `https://your-site.netlify.app/check-counts.html`

**Test Environment:**
- Dashboard: `https://test--your-site.netlify.app/`
- Health Check: `https://test--your-site.netlify.app/test-health-check.html`

### Common Issues

**Dashboard shows no data:**
- Check Supabase keys in config
- Verify RLS policies are active
- Check browser console for errors

**GitHub Actions fail:**
- Verify secrets are set correctly
- Check OpenAI API key is valid
- Review action logs for errors

**Manual submission not working:**
- Verify GitHub token permissions
- Check service role key is set
- Ensure workflow is enabled

## 7. Maintenance

### Regular Tasks

**Daily:**
- Monitor GitHub Actions logs
- Check dashboard for new entries

**Weekly:**
- Review failed submissions queue
- Check data quality
- Monitor API usage

**Monthly:**
- Archive old entries (>60 days)
- Review costs and usage
- Update documentation

### Backup Procedures

1. **Database Backup:**
```sql
-- In Supabase SQL editor
COPY political_entries TO '/tmp/political_entries_backup.csv' CSV HEADER;
COPY executive_orders TO '/tmp/executive_orders_backup.csv' CSV HEADER;
```

2. **Code Backup:**
- GitHub automatically maintains history
- Consider tags for major versions

### Monitoring

**Set up alerts for:**
- GitHub Actions failures
- Supabase usage limits
- Netlify build failures
- OpenAI API errors

**Useful monitoring URLs:**
- GitHub Actions: `github.com/YOUR_USER/TTracker/actions`
- Netlify Deploys: `app.netlify.com/sites/YOUR_SITE/deploys`
- Supabase Usage: `app.supabase.com/project/YOUR_PROJECT/settings/billing`

## Deployment Commands Reference

```bash
# Local development
npm install
npm run server

# Test automation locally  
node scripts/daily-tracker-supabase.js

# Deploy to production
git add .
git commit -m "Your changes"
git push origin main

# Deploy to test
git checkout test
git add .
git commit -m "Test changes"
git push origin test

# Cherry-pick from test to production
git checkout main
git cherry-pick COMMIT_HASH
git push origin main
```

## Cost Estimation

**Monthly costs (approximate):**
- Supabase: $0 (free tier)
- Netlify: $0 (free tier)
- GitHub: $0 (public repo)
- OpenAI: $5-10 (API usage)
- **Total: $5-10/month**

## Support Resources

- **Documentation**: See `/docs` folder
- **Confluence**: Internal documentation (if available)
- **GitHub Issues**: Report bugs
- **Email**: contact.trumpytracker@gmail.com

---

*Last Updated: August 17, 2025*
*Deployment Version: 2.0*
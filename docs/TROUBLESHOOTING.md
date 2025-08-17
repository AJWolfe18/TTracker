# TrumpyTracker Troubleshooting Guide

## Overview

This guide helps diagnose and fix common issues with TrumpyTracker. Check here first before reaching out for support.

## Quick Diagnostics

### System Status Check

1. **Dashboard**: https://trumpytracker.com - Should show recent entries
2. **Health Check**: https://trumpytracker.com/check-counts.html - Shows database stats
3. **GitHub Actions**: https://github.com/AJWolfe18/TTracker/actions - Check for failures
4. **Supabase**: https://app.supabase.com - Check database status

## Common Issues & Solutions

### Dashboard Issues

#### Problem: Dashboard shows no data

**Symptoms:**
- Blank dashboard
- "Loading..." stays indefinitely
- No entries displayed

**Solutions:**

1. **Check browser console** (F12 → Console tab):
```javascript
// Look for errors like:
// "Failed to fetch"
// "401 Unauthorized"
// "CORS error"
```

2. **Verify Supabase configuration:**
```javascript
// In browser console, check:
console.log(window.SUPABASE_CONFIG);
// Should show URL and anon key
```

3. **Clear browser cache:**
```javascript
// In console:
localStorage.clear();
location.reload();
```

4. **Check RLS policies** in Supabase:
```sql
-- Should return data
SELECT * FROM political_entries 
WHERE archived = false 
LIMIT 5;
```

#### Problem: Filters not working

**Symptoms:**
- Clicking filters does nothing
- Search returns no results
- Date range broken

**Solutions:**

1. **Check for JavaScript errors:**
```javascript
// Browser console should be error-free
```

2. **Verify filter logic:**
```javascript
// Test in console:
const entries = window.allEntries;
console.log(entries.length); // Should show number
```

3. **Reset filters:**
```javascript
// Click "Show All" button or reload page
```

### Admin Panel Issues

#### Problem: Can't submit articles

**Symptoms:**
- Submit button doesn't work
- Article stays in pending
- Error messages appear

**Solutions:**

1. **Check GitHub token:**
```javascript
// Verify token is set in admin panel
localStorage.getItem('github_token');
```

2. **Test manual submission:**
```bash
# Use cURL to test API
curl -X POST \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"event_type":"process-manual-article","client_payload":{"article_url":"https://test.com"}}' \
  https://api.github.com/repos/AJWolfe18/TTracker/dispatches
```

3. **Check queue status:**
- Go to Queue Management tab
- Look for failed submissions
- Check error messages

#### Problem: Queue not processing

**Symptoms:**
- Articles stuck in pending
- Failed status with no error
- GitHub Action not triggering

**Solutions:**

1. **Check GitHub Actions:**
- Go to Actions tab in GitHub
- Look for failed workflows
- Check logs for errors

2. **Verify service role key:**
```javascript
// Must be set in GitHub Secrets
// SUPABASE_SERVICE_KEY
```

3. **Clear stuck queue:**
```sql
-- In Supabase SQL editor
DELETE FROM pending_submissions 
WHERE status = 'pending' 
AND created_at < NOW() - INTERVAL '1 day';
```

### GitHub Actions Issues

#### Problem: Daily tracker failing

**Error messages:**
- "OpenAI API error"
- "Supabase connection failed"
- "Rate limit exceeded"

**Solutions:**

1. **Check API keys:**
```yaml
# In GitHub Secrets, verify:
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_KEY
```

2. **Test OpenAI API:**
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_OPENAI_KEY"
```

3. **Check OpenAI usage:**
- Go to platform.openai.com
- Check usage and limits
- Verify payment method

#### Problem: Manual trigger not working

**Symptoms:**
- "Run workflow" does nothing
- Workflow queued but doesn't run
- Immediate failure

**Solutions:**

1. **Check workflow file:**
```yaml
# .github/workflows/daily-tracker.yml
on:
  workflow_dispatch: # Must be present
```

2. **Verify permissions:**
- Repository Settings → Actions
- Ensure Actions enabled

3. **Check runner availability:**
- May be GitHub outage
- Check status.github.com

### Database Issues

#### Problem: Duplicate entries

**Symptoms:**
- Same article appears multiple times
- Identical entries with different IDs

**Solutions:**

1. **Find duplicates:**
```sql
-- Find duplicate URLs
SELECT source_url, COUNT(*) as count
FROM political_entries
GROUP BY source_url
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

2. **Remove duplicates:**
```sql
-- Keep only the first entry
DELETE FROM political_entries a
USING political_entries b
WHERE a.id > b.id 
AND a.source_url = b.source_url;
```

3. **Add unique constraint:**
```sql
-- Prevent future duplicates
ALTER TABLE political_entries 
ADD CONSTRAINT unique_source_url 
UNIQUE (source_url);
```

#### Problem: Database full

**Symptoms:**
- "Storage limit exceeded"
- Inserts failing
- Slow queries

**Solutions:**

1. **Check usage:**
```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

2. **Archive old data:**
```sql
-- Archive entries older than 60 days
UPDATE political_entries 
SET archived = true 
WHERE date < CURRENT_DATE - INTERVAL '60 days';
```

3. **Clean up backups:**
```sql
-- Remove old backups
DROP TABLE IF EXISTS political_entries_backup_old;
```

### Deployment Issues

#### Problem: Netlify deploy failing

**Error messages:**
- "Build failed"
- "Deploy did not succeed"
- "Page not found"

**Solutions:**

1. **Check build logs:**
- Go to Netlify dashboard
- Click on failed deploy
- Read error messages

2. **Verify branch settings:**
- Production: main branch
- Test: test branch
- Publish directory: public

3. **Clear cache and retry:**
- In Netlify: Deploy settings
- Click "Clear cache and deploy"

#### Problem: Test environment not updating

**Symptoms:**
- Changes not reflected
- Old version showing
- 404 errors

**Solutions:**

1. **Verify TEST_BRANCH_MARKER.md exists:**
```bash
# On test branch
ls TEST_BRANCH_MARKER.md
```

2. **Check branch deploys enabled:**
- Netlify → Site settings
- Build & deploy → Branches
- Ensure "test" branch listed

3. **Force deploy:**
```bash
git commit --allow-empty -m "Force deploy"
git push origin test
```

### Performance Issues

#### Problem: Slow dashboard loading

**Symptoms:**
- Takes >5 seconds to load
- Freezes browser
- Timeout errors

**Solutions:**

1. **Check data volume:**
```sql
-- Count entries
SELECT COUNT(*) FROM political_entries 
WHERE archived = false;
-- Should be <1000 for good performance
```

2. **Archive old data:**
```javascript
// Run archive function
archiveOldEntries(60); // Archive >60 days
```

3. **Clear cache:**
```javascript
localStorage.clear();
sessionStorage.clear();
```

4. **Optimize queries:**
```sql
-- Add indexes if missing
CREATE INDEX IF NOT EXISTS idx_date_archived 
ON political_entries(date DESC, archived);
```

### API Issues

#### Problem: Rate limiting

**Error messages:**
- "429 Too Many Requests"
- "Rate limit exceeded"
- "Quota exceeded"

**Solutions:**

1. **Implement caching:**
```javascript
// Cache data for 5 minutes
const CACHE_KEY = 'tt_cache_entries';
const CACHE_DURATION = 5 * 60 * 1000;
```

2. **Add retry logic:**
```javascript
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
}
```

3. **Check usage limits:**
- Supabase: 500 req/sec
- GitHub: 5000 req/hour
- OpenAI: Check dashboard

## Error Messages Reference

### JavaScript Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Uncaught ReferenceError: supabase is not defined` | Missing Supabase config | Check config files loaded |
| `Failed to fetch` | Network or CORS issue | Check API keys and URLs |
| `401 Unauthorized` | Invalid API key | Update keys in config |
| `403 Forbidden` | RLS policy blocking | Check database policies |
| `404 Not Found` | Wrong URL or deleted | Verify endpoints |
| `500 Internal Server Error` | Server issue | Check Supabase status |

### GitHub Actions Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Node.js 12 actions are deprecated` | Old Node version | Update to Node 18 |
| `Error: Bad credentials` | Invalid GitHub token | Regenerate token |
| `Error: Resource not accessible` | Permission issue | Check repo settings |
| `OpenAI API error: 429` | Rate limited | Wait or upgrade plan |
| `Cannot find module` | Missing dependency | Run npm install |

### Supabase Errors

| Code | Meaning | Solution |
|------|---------|----------|
| PGRST301 | Invalid query | Check SQL syntax |
| PGRST204 | No rows returned | Normal, not error |
| 42P01 | Table doesn't exist | Run schema creation |
| 23505 | Duplicate key | Remove duplicates |
| 22001 | String too long | Truncate data |
| P0001 | RLS violation | Check policies |

## Debug Commands

### Check Environment

```bash
# Check Node version
node --version  # Should be 16+

# Check npm packages
npm list

# Check git branch
git branch --show-current

# Check remote URL
git remote -v
```

### Test Database Connection

```javascript
// Run in Node.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'YOUR_SUPABASE_URL',
  'YOUR_ANON_KEY'
);

async function test() {
  const { data, error } = await supabase
    .from('political_entries')
    .select('count');
  
  console.log('Result:', data, error);
}

test();
```

### Test API Endpoints

```bash
# Test Supabase
curl -X GET \
  'https://YOUR_PROJECT.supabase.co/rest/v1/political_entries?limit=1' \
  -H 'apikey: YOUR_ANON_KEY'

# Test GitHub
curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/user

# Test OpenAI
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_KEY"
```

## Getting Help

### Before Asking for Help

1. Check this troubleshooting guide
2. Search GitHub issues
3. Check Confluence documentation
4. Review recent commits

### Information to Provide

When requesting help, include:

1. **Error messages** (exact text)
2. **Browser console output**
3. **Steps to reproduce**
4. **Environment** (production/test)
5. **Browser and OS**
6. **Recent changes made**
7. **Screenshots if applicable**

### Support Channels

1. **GitHub Issues**: Bug reports and features
2. **Email**: contact.trumpytracker@gmail.com
3. **Confluence**: Internal documentation
4. **Jira**: TT project for tickets

## Recovery Procedures

### Full System Reset

```bash
# 1. Backup data
pg_dump DATABASE_URL > backup.sql

# 2. Clean database
DROP TABLE political_entries CASCADE;
DROP TABLE executive_orders CASCADE;

# 3. Recreate schema
# Run complete-schema-fix.sql

# 4. Restore data
psql DATABASE_URL < backup.sql

# 5. Clear caches
localStorage.clear();

# 6. Restart services
# Trigger GitHub Action
# Clear Netlify cache
```

### Emergency Contacts

- **Supabase Status**: status.supabase.com
- **GitHub Status**: status.github.com
- **Netlify Status**: netlify.statuspage.io
- **OpenAI Status**: status.openai.com

---

*Last Updated: August 17, 2025*
*Version: 1.0*
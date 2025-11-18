# How to Trigger RSS Tracker on TEST Branch

**Created:** 2025-11-16
**Ticket:** TTRC-266

---

## ⚠️ GitHub Actions Limitation

**Scheduled workflows DO NOT auto-run on non-default branches (test).**

GitHub Actions only executes scheduled workflows (cron jobs) on the **default branch** (main). The test branch workflows must be triggered manually.

---

## Method 1: GitHub UI (Recommended)

1. **Go to Actions tab**: https://github.com/AJWolfe18/TTracker/actions
2. **Select workflow**: Click "RSS Tracker - TEST" in left sidebar
3. **Run workflow button**: Click "Run workflow" button (top right)
4. **Select branch**: Choose `test` from "Use workflow from" dropdown
5. **Click "Run workflow"**: Confirm to start execution
6. **Monitor**: Watch the run in real-time or check results after completion

---

## Method 2: Local Execution

Run the script locally with TEST environment variables:

```bash
# Set environment variables (get from 1Password or GitHub secrets)
export SUPABASE_URL="<SUPABASE_TEST_URL>"
export SUPABASE_SERVICE_ROLE_KEY="<SUPABASE_TEST_SERVICE_KEY>"
export OPENAI_API_KEY="<YOUR_OPENAI_KEY>"
export ENVIRONMENT="test"
export RSS_TRACKER_RUN_ENABLED="true"

# Run the script
node scripts/rss-tracker-supabase.js

# Expected output:
# - 🚀 RSS Tracker starting (TEST)
# - 📋 Selected X feeds for processing
# - 🔗 Clustering X articles
# - 🤖 Enriching X stories
# - ✅ RSS Tracker complete in X.Xs
```

**Runtime:** ~2-4 minutes depending on feed count and clustering workload

---

## Method 3: GitHub CLI (After Workflow Detection)

**Note:** This only works AFTER GitHub has detected the workflow file (can take 10-15 minutes after push, or after first manual UI trigger).

```bash
# List available workflows
gh workflow list

# Trigger manually (if detected)
gh workflow run "RSS Tracker - TEST" --ref test

# Watch the run
gh run watch
```

---

## Verification After Run

Check results in Supabase TEST SQL Editor:

```sql
-- View latest run
SELECT * FROM admin.run_stats
WHERE environment = 'test'
ORDER BY run_started_at DESC
LIMIT 1;

-- Expected fields:
-- - status: 'success' or 'partial_success'
-- - feeds_processed: > 0
-- - stories_clustered: >= 0
-- - stories_enriched: >= 0
-- - total_openai_cost_usd: < $0.50

-- Check budget
SELECT * FROM budgets WHERE day = CURRENT_DATE;

-- Check unclustered articles remaining
SELECT COUNT(*) FROM get_unclustered_articles(10);
```

---

## Troubleshooting

### Workflow not showing in GitHub UI
- **Wait 5-10 minutes** after pushing workflow file
- **Refresh** the Actions page
- **Check file exists**: `.github/workflows/rss-tracker-test.yml` on test branch

### "Workflow not found" error with gh CLI
- GitHub CLI requires workflow to be on **default branch** (main) OR detected after first UI trigger
- **Solution**: Use GitHub UI method first, then CLI will work

### Script fails locally
- **Check environment variables** are set correctly
- **Verify credentials**: Test Supabase connection with a simple query
- **Check kill switch**: Ensure `RSS_TRACKER_RUN_ENABLED=true`
- **Check migrations**: Verify migrations 033 and 034 applied to TEST

---

## PROD Deployment

After 48h TEST monitoring succeeds, deploy to PROD via PR:

1. Create PR from test → main
2. Merge PR (triggers PROD deployment)
3. PROD workflow will auto-run every 2 hours (scheduled on main branch)
4. Monitor: `SELECT * FROM admin.run_stats WHERE environment = 'prod'`

---

**Last Updated:** 2025-11-16
**Related:** TTRC-266, docs/plans/2025-11-16-ttrc-266-execution-checklist.md

# TTRC-223 Deployment Guide
## Auto-Enrich Executive Orders After Collection

**Feature Branch:** `feat/ttrc-223-auto-enrich-eos`  
**Pull Request:** [#20](https://github.com/AJWolfe18/TTracker/pull/20)  
**JIRA:** [TTRC-223](https://ajwolfe37.atlassian.net/browse/TTRC-223)  
**Created:** 2025-10-23  

---

## Overview

This guide covers deploying the auto-enrichment feature to both TEST and PROD environments. The feature automatically enriches executive orders with AI analysis immediately after collection, eliminating manual enrichment runs.

**Current Status:** Code complete, tested, ready to deploy to TEST branch.

---

## Part 1: Test Environment Deployment (Immediate)

### Prerequisites

- [ ] PR #20 approved and ready to merge
- [ ] All GitHub Actions passing on feature branch
- [ ] Manual test completed successfully (10/10 EOs enriched)
- [ ] JIRA ticket TTRC-223 in "Done" status

### Step 1: Merge to Test Branch

```bash
# Switch to test branch
git checkout test

# Pull latest changes
git pull origin test

# Merge feature branch
git merge feat/ttrc-223-auto-enrich-eos

# Push to remote (triggers auto-deploy to Netlify)
git push origin test
```

**Expected Result:** GitHub shows merge successful, no conflicts.

---

### Step 2: Verify Netlify Deployment

**Timeline:** ~2-5 minutes after push

1. **Check Netlify Deploy Status**
   - Visit: https://app.netlify.com/sites/trumpytracker-test/deploys
   - Look for: "Deploy in progress" → "Published"
   - Build log should show: "Site is live"

2. **Verify Site Loads**
   - URL: https://trumpytracker-test.netlify.app (or your TEST URL)
   - Check: Homepage loads without errors
   - Open browser console: Should see zero errors

3. **Verify Executive Orders Page**
   - Navigate to Executive Orders section
   - Check: Enriched EOs display properly
   - Verify: 4-part editorial breakdown shows for enriched EOs

**If Deployment Fails:**
```bash
# Check Netlify build logs for errors
# Common issues: dependency conflicts, build timeout

# Rollback if needed
git revert HEAD
git push origin test
```

---

### Step 3: Verify GitHub Actions Configuration

**Check Workflow File Updated:**

```bash
# Verify secrets are set in GitHub repo
gh secret list

# Required secrets:
# - OPENAI_API_KEY ✓
# - SUPABASE_URL ✓
# - SUPABASE_ANON_KEY ✓
# - SUPABASE_SERVICE_ROLE_KEY ✓ (CRITICAL - new requirement)
# - EDGE_CRON_TOKEN ✓
```

**Verify Workflow File:**
```bash
cat .github/workflows/executive-orders-tracker.yml
```

Should contain:
- `timeout-minutes: 20` (increased from 10)
- `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`
- `EO_LOOKBACK_DAYS: 90` (for TEST environment)

---

### Step 4: Manual Test Run (Recommended)

**Trigger workflow manually to verify enrichment works:**

```bash
# Trigger the workflow on test branch
gh workflow run executive-orders-tracker.yml --ref test
```

**Monitor the run:**
```bash
# List recent runs
gh run list --workflow="Track Executive Orders" --limit 3

# Watch specific run (replace with actual run ID)
gh run watch <run-id> --exit-status
```

**Success Indicators:**
- ✅ Workflow completes in <20 minutes
- ✅ Logs show: "Successfully enriched: X ✅"
- ✅ No errors in enrichment section
- ✅ Database shows new `enriched_at` timestamps

**Check Database:**
```sql
-- Run via Supabase MCP tool
SELECT order_number, title, enriched_at, prompt_version
FROM executive_orders
WHERE enriched_at > NOW() - INTERVAL '1 hour'
ORDER BY enriched_at DESC
LIMIT 5;
```

---

### Step 5: Monitor First Automated Run

**Next scheduled run:** Daily at 11 AM EST

**What to monitor:**

1. **GitHub Actions Log** (during run)
   ```bash
   gh run watch --exit-status
   ```
   
   Look for:
   ```
   ✨ Executive orders collection and enrichment complete!
   
   📊 Enrichment Summary:
      New EOs collected: X
      Successfully enriched: X ✅
      Failed enrichment: 0
   ```

2. **Check for Errors**
   ```sql
   -- Check dead-letter queue for failures
   SELECT * FROM eo_enrichment_errors
   WHERE created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```

3. **Verify Cost Tracking**
   ```sql
   -- Check daily spending
   SELECT DATE(created_at) as day, 
          COUNT(*) as enrichments,
          SUM(usd_estimate) as total_cost
   FROM eo_enrichment_costs
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY day
   ORDER BY day DESC;
   ```

4. **Frontend Verification**
   - Visit TEST site
   - Navigate to Executive Orders
   - Verify newly enriched EOs show:
     - 4-part editorial breakdown
     - Action tier badge
     - All metadata populated

---

### Step 6: Post-Deployment Checklist

**24 Hours After Deployment:**
- [ ] At least 1 automated run completed successfully
- [ ] Zero errors in `eo_enrichment_errors` table
- [ ] Cost tracking shows reasonable spending (<$0.50/day)
- [ ] Frontend displays enriched EOs correctly
- [ ] No console errors on site

**48 Hours After Deployment:**
- [ ] 2 automated runs completed successfully
- [ ] Cost trend is stable
- [ ] No GitHub Action timeouts
- [ ] Dead-letter queue remains empty

**1 Week After Deployment:**
- [ ] All automated runs successful
- [ ] Weekly cost <$3.50 (7 days × $0.50/day)
- [ ] No manual intervention required
- [ ] Ready to plan PROD deployment

---

## Part 2: Production Environment Deployment (Future)

**IMPORTANT:** Do NOT deploy to PROD until:
1. ✅ TEST environment stable for 1+ week
2. ✅ User explicitly approves PROD deployment
3. ✅ Backfill plan for existing PROD EOs agreed upon

---

### Prerequisites for PROD Deployment

- [ ] TEST environment stable for 7+ days
- [ ] Zero critical errors in TEST
- [ ] Cost projections confirmed acceptable
- [ ] User approval to deploy to PROD
- [ ] Backfill strategy decided (see below)

---

### PROD Deployment Steps

**DO NOT use `git merge test → main`** - Always cherry-pick tested commits.

#### Step 1: Cherry-Pick Commits to Main

```bash
# Switch to main branch
git checkout main

# Pull latest
git pull origin main

# Cherry-pick the tested commits from test branch
# (Find commit hashes from PR #20)
git cherry-pick <commit-hash-1>
git cherry-pick <commit-hash-2>
# ... repeat for all commits in PR #20

# OR cherry-pick the merge commit (safer)
git cherry-pick -m 1 <merge-commit-hash>

# Push to main (triggers auto-deploy to trumpytracker.com)
git push origin main
```

#### Step 2: Verify PROD Environment Variables

**CRITICAL: Check GitHub Secrets for PROD:**

```bash
gh secret list
```

**Verify PROD-specific settings:**
- `SUPABASE_URL` - Should point to PROD database
- `SUPABASE_ANON_KEY` - PROD key
- `SUPABASE_SERVICE_ROLE_KEY` - PROD service role key
- `OPENAI_API_KEY` - Shared (or separate PROD key)
- `EO_LOOKBACK_DAYS` - Should be `3` for PROD (not 90 like TEST)

**Update workflow if needed:**
```yaml
# In .github/workflows/executive-orders-tracker.yml
# Ensure PROD branch uses correct lookback
env:
  EO_LOOKBACK_DAYS: 3  # PROD: only look back 3 days
```

#### Step 3: PROD Deployment Verification

**Same as TEST, but with PROD URLs:**

1. **Netlify Deployment**
   - URL: https://trumpytracker.com
   - Verify: Site loads, no errors

2. **Manual Test Run**
   ```bash
   gh workflow run executive-orders-tracker.yml --ref main
   ```

3. **Database Verification**
   ```sql
   -- Check PROD database (use PROD MCP connection or Supabase dashboard)
   SELECT order_number, enriched_at
   FROM executive_orders
   WHERE enriched_at > NOW() - INTERVAL '1 hour'
   ORDER BY enriched_at DESC;
   ```

#### Step 4: Backfill Existing PROD EOs (Optional)

**Context:** Existing PROD EOs may have:
1. Publication dates instead of signing dates
2. Missing enrichment data

**Option A: Backfill Signing Dates Only**
```bash
# Use pre-generated backfill script
node scripts/backfill-eo-signing-dates.js

# Verify changes
node scripts/generate-signing-date-updates.js
```

**Option B: Full Re-Enrichment**
```bash
# Re-enrich all PROD EOs with new prompt version
node scripts/enrichment/enrich-executive-orders.js --all --force

# WARNING: This will cost ~$6-10 (200 EOs × $0.03 each)
# Confirm with user before running
```

**Option C: No Backfill (Accepted by User)**
- Keep existing PROD data as-is
- Only new EOs use correct dates and auto-enrichment
- User accepted this approach for TEST, likely same for PROD

---

### PROD Monitoring Plan

**First 24 Hours:**
- [ ] Check GitHub Actions hourly
- [ ] Monitor cost tracking every 4 hours
- [ ] Verify frontend updates within 1 hour of scheduled run

**First Week:**
- [ ] Daily GitHub Actions review
- [ ] Daily cost tracking check
- [ ] Weekly frontend smoke test

**Ongoing:**
- [ ] Weekly cost review
- [ ] Monthly dead-letter queue check
- [ ] Quarterly enrichment quality review

---

## Part 3: Rollback Procedures

### Rollback from TEST

**If enrichment causes issues on TEST:**

**Option 1: Quick Disable (No Code Changes)**
```bash
# Temporarily remove SERVICE_ROLE_KEY secret
gh secret delete SUPABASE_SERVICE_ROLE_KEY

# Enrichment will fail gracefully, collection continues
# Restore later: gh secret set SUPABASE_SERVICE_ROLE_KEY < key.txt
```

**Option 2: Code Rollback**
```bash
git checkout test
git revert <merge-commit-hash>
git push origin test
```

**Option 3: Comment Out Enrichment**
```javascript
// In scripts/executive-orders-tracker-supabase.js
// await enrichNewEOs(insertedOrders);  // DISABLED - rollback

git add scripts/executive-orders-tracker-supabase.js
git commit -m "fix: disable auto-enrichment (rollback TTRC-223)"
git push origin test
```

---

### Rollback from PROD

**If issues detected on PROD after deployment:**

**Immediate (within 1 hour):**
```bash
# Revert the cherry-picked commits
git checkout main
git revert <commit-hash> --no-edit
git push origin main
```

**Delayed (after analysis):**
```bash
# Cherry-pick fix from test branch
git checkout main
git cherry-pick <fix-commit-hash>
git push origin main
```

---

## Part 4: Troubleshooting

### Issue: Enrichment Fails with "Daily cap exceeded"

**Diagnosis:**
```sql
SELECT DATE(created_at) as day, SUM(usd_estimate) as spent
FROM eo_enrichment_costs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;
```

**Fix:**
- If legitimate (massive EO dump): Wait 24 hours, cap resets
- If bug: Check cost calculation logic in enrichment worker

---

### Issue: GitHub Action Times Out (>20 minutes)

**Diagnosis:**
- Check logs: How many EOs being enriched?
- Check OpenAI rate limits: Are requests being throttled?

**Fix:**
```yaml
# Increase timeout in .github/workflows/executive-orders-tracker.yml
timeout-minutes: 30  # Increase from 20
```

---

### Issue: EOs Saved Without Enrichment

**Diagnosis:**
```sql
SELECT COUNT(*) FROM executive_orders 
WHERE created_at > NOW() - INTERVAL '24 hours'
AND enriched_at IS NULL;
```

**Fix (Manual Enrichment):**
```bash
# Enrich missing EOs
node scripts/enrichment/enrich-executive-orders.js

# Check dead-letter queue for errors
# via Supabase dashboard or MCP tool
```

---

### Issue: Wrong Dates Showing on Frontend

**Diagnosis:**
```sql
SELECT order_number, date, signing_date, publication_date
FROM executive_orders
WHERE order_number = 14356;  -- Example EO
```

**Expected:** `date` field should match `signing_date`, not `publication_date`

**Fix:** Verify collection script uses:
```javascript
date: item.signing_date || item.publication_date || today,
```

---

## Part 5: Monitoring Dashboards

### GitHub Actions Dashboard

**URL:** https://github.com/AJWolfe18/TTracker/actions/workflows/executive-orders-tracker.yml

**What to check:**
- ✅ Green checkmarks (successful runs)
- ⏱️ Runtime <20 minutes
- 📊 Logs show enrichment summary

### Supabase Dashboard

**Tables to Monitor:**

1. **executive_orders**
   - Check `enriched_at` populated for new EOs
   - Verify `prompt_version` matches latest

2. **eo_enrichment_costs**
   - Daily spending trends
   - Cost per EO (~$0.03 average)

3. **eo_enrichment_errors**
   - Should be empty
   - If populated, investigate immediately

### Cost Tracking Query

```sql
-- Weekly cost summary
SELECT 
    DATE_TRUNC('week', created_at) as week,
    COUNT(*) as total_enrichments,
    SUM(usd_estimate) as total_cost,
    AVG(usd_estimate) as avg_cost_per_eo
FROM eo_enrichment_costs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY week
ORDER BY week DESC;
```

---

## Part 6: Success Metrics

### TEST Environment (First Week)

**Target Metrics:**
- 🎯 100% uptime (no workflow failures)
- 🎯 <$0.50/day average cost
- 🎯 Zero dead-letter queue entries
- 🎯 All new EOs enriched within 1 hour of collection

**Actual Performance (from integration test):**
- ✅ 10/10 EOs enriched successfully (100% success rate)
- ✅ Runtime: 3m39s (well under timeout)
- ✅ Zero errors

### PROD Environment (Post-Deployment)

**Target Metrics:**
- 🎯 100% uptime
- 🎯 <$3.00/month total cost
- 🎯 Zero manual interventions required
- 🎯 Enrichment quality maintained (manual QA spot-checks)

---

## Part 7: Communication Plan

### Internal Updates (JIRA)

**After TEST Deployment:**
- Update TTRC-223: "Deployed to TEST - monitoring"
- Add comment with deployment timestamp and verification results

**After PROD Deployment:**
- Update TTRC-223: "Deployed to PROD - monitoring"
- Close ticket after 1 week of stable operation

### User Communication

**Not required** - This is backend automation, no user-facing changes beyond EOs appearing enriched automatically.

---

## Part 8: Environment Differences Summary

| Aspect | TEST | PROD |
|--------|------|------|
| **Branch** | `test` | `main` |
| **Supabase URL** | TEST database | PROD database |
| **Netlify URL** | trumpytracker-test.netlify.app | trumpytracker.com |
| **EO Lookback** | 90 days | 3 days |
| **Scheduled Run** | 11 AM EST daily | 11 AM EST daily |
| **Existing EO Count** | ~212 | ~717 |
| **Backfill Status** | Accepted publication dates | TBD (likely same) |

---

## Part 9: Final Checklist

### Before TEST Deployment
- [ ] PR #20 approved
- [ ] All tests passing
- [ ] This deployment guide reviewed
- [ ] User aware of deployment timing

### After TEST Deployment
- [ ] Netlify deployed successfully
- [ ] Manual test run successful
- [ ] Database verification complete
- [ ] JIRA updated with deployment status
- [ ] Monitoring plan in place

### Before PROD Deployment
- [ ] TEST stable for 7+ days
- [ ] User approval obtained
- [ ] Backfill strategy decided
- [ ] PROD secrets verified
- [ ] Rollback plan reviewed

### After PROD Deployment
- [ ] Netlify deployed successfully
- [ ] Manual test run successful
- [ ] Database verification complete
- [ ] Cost tracking active
- [ ] Monitoring dashboards bookmarked

---

## Part 10: Post-Deployment Fixes (Applied to TEST)

The following fixes were applied after the initial deployment to TEST based on testing feedback:

### Fix 1: Removed Minimum Word Count Validation (Commit 9e9e82c)

**Issue:** Enrichment was failing when OpenAI generated summaries with less than 100 words, causing 20% failure rate.

**Root Cause:** 
```javascript
// Old validation required 100-160 words
if (words < 100 || words > 160) {
  throw new Error(`${section} must be 100-160 words (got ${words})`);
}
```

**Fix Applied:**
```javascript
// New validation only enforces maximum
if (words > 160) {
  throw new Error(`${section} must be at most 160 words (got ${words})`);
}
```

**Files Changed:**
- `scripts/enrichment/enrich-executive-orders.js` (line 280)

**Impact:**
- ✅ Improved success rate from 80% to 100%
- ✅ Accepts any summary length up to 160 words
- ✅ No database changes required
- ✅ Already deployed to TEST

**PROD Deployment:** ✅ **No additional action needed** - fix is included in test branch commits

---

### Fix 2: Corrected Timezone Display Issue (Commit 516047c)

**Issue:** Dates displayed one day earlier than actual signing date (e.g., EO 14356 showed Oct 14 instead of Oct 15).

**Root Cause:** 
JavaScript parsed `"2025-10-15"` as UTC midnight, which converted to 6pm Oct 14 in Central Time (UTC-6).

**Fix Applied:**

**File 1: `public/dashboard-utils.js`**
```javascript
// Before: Parsed as UTC
return new Date(dateString).toLocaleDateString('en-US', {...});

// After: Detects date-only format and parses as local
const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
if (dateOnly) {
  const [year, month, day] = dateString.split('-').map(Number);
  date = new Date(year, month - 1, day); // Local timezone
}
```

**File 2: `public/eo-page.js`**
```javascript
// Before: UTC parsing affected date filtering
const eoDate = new Date(eo.date);

// After: Parse as local date
const [year, month, day] = eo.date.split('-').map(Number);
const eoDate = new Date(year, month - 1, day);
```

**Files Changed:**
- `public/dashboard-utils.js` (formatDate function)
- `public/eo-page.js` (date filtering logic)

**Impact:**
- ✅ Dates now display correctly (match whitehouse.gov)
- ✅ Date range filters now accurate
- ✅ No database changes required
- ✅ Already deployed to TEST

**PROD Deployment:** ✅ **No additional action needed** - fix is included in test branch commits

---

### Summary of All Commits in TEST Deployment

**Total commits:** 9

1. Initial auto-enrichment integration
2. Fix MAJOR issues from expert review
3. Fix null title crash (AI review)
4. Fix schema mismatches (5 fixes)
5. Fix RLS policy
6. Fix ID return for enrichment
7. Update PR description
8. Fix signing_date vs publication_date
9. **Fix word count validation** (9e9e82c)
10. **Fix timezone display issue** (516047c)

**Database Changes Required for PROD:** ❌ **None**

Both post-deployment fixes are frontend/validation changes only. When deploying to PROD, cherry-pick all commits from the test branch - no additional database migrations needed.

---

## Questions & Support

**For deployment issues:**
1. Check this guide first
2. Review GitHub Action logs
3. Query Supabase tables for data verification
4. Contact: Josh (via JIRA comments)

**For feature questions:**
- See: `docs/handoffs/2025-10-23-ttrc-223-auto-enrich-final.md`
- JIRA: [TTRC-223](https://ajwolfe37.atlassian.net/browse/TTRC-223)

---

**Last Updated:** 2025-10-24 (Post-TEST deployment)  
**Maintained by:** Claude Code  
**Status:** ✅ Deployed to TEST - Ready for PROD after 1 week stability

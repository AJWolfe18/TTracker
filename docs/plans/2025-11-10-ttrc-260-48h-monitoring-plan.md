# TTRC-260: 48-Hour Extended TEST Monitoring Plan

**Feature**: Mozilla Readability Scraper with Three-Tier Fallback
**Status**: Ready to Start Monitoring
**Created**: 2025-11-10
**Monitoring Duration**: 48 hours
**Approach**: Option A - Manual RSS Triggers + Continuous Worker

---

## Executive Summary

Mozilla Readability scraper is implemented and working on TEST (7 successful PBS scrapes). However, **limited test data requires 48-hour monitoring** before PROD deployment to validate:
- Success rate >70% across all sources
- Memory stability over 48+ hours
- Cost impact assessment
- Multi-source validation (PBS ✅, need NYT, WaPo, CSM, Reuters, AP)

**Monitoring Approach**: Manual RSS triggers every 2-6 hours + continuous worker with log analysis.

---

## Phase 1: Start Worker & Begin Monitoring ⏱️

**Estimated Time**: 5 minutes

### 1. Start Job Queue Worker
```bash
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
node scripts/job-queue-worker.js > worker-ttrc260.log 2>&1 &
```

### 2. Capture Worker PID
```bash
# Find PID for memory monitoring
ps aux | grep job-queue-worker | grep -v grep
# Record PID in monitoring log
```

### 3. Record Start Timestamp
```bash
echo "Monitoring started: $(date)" >> monitoring-ttrc260.log
```

### 4. Trigger First RSS Fetch
```bash
curl -X POST "https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer d9559916-c428-4767-8cc4-de1b5e7933ec0bfb9919-5113-4e6e-8830-edca4db73035" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

---

## Phase 2: Create Monitoring Scripts 🛠️

**Estimated Time**: 30 minutes

### Script 1: `scripts/monitoring/analyze-scraper-logs.js`

**Purpose**: Parse worker logs for scraper success rates by source

**Features**:
- Success rates by source (PBS, NYT, WaPo, CSM, Reuters, AP, Politico, ProPublica)
- Success rates by method (Readability, Regex fallback, RSS fallback)
- Error patterns and failure reasons
- HTTP status code breakdown (403, 404, 429, timeouts)
- Timeline of scraping events

**Output**: Markdown report with tables

**Usage**:
```bash
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log
```

### Script 2: `scripts/monitoring/check-memory.sh`

**Purpose**: Track worker memory usage over time

**Features**:
- Find worker PID automatically
- Show current memory in MB
- Append to CSV for trend tracking
- Alert if memory >300MB

**Output**: CSV file (`memory-ttrc260.csv`) + console display

**Usage**:
```bash
bash scripts/monitoring/check-memory.sh
```

**CSV Format**:
```csv
timestamp,pid,memory_mb
2025-11-10 10:00:00,12345,156.2
2025-11-10 16:00:00,12345,162.8
```

### Script 3: `scripts/monitoring/check-costs.sql`

**Purpose**: Query Supabase for daily cost tracking

**Features**:
- Daily spend from `budgets` table
- Compare current week vs. previous week
- Calculate daily increase
- Show OpenAI call counts

**Output**: Table with daily costs

**Usage**:
```bash
# Using psql (if configured)
psql -h wnrjrywpcadwutfykflu.supabase.co -U postgres -d postgres -f scripts/monitoring/check-costs.sql

# OR using Supabase MCP tool
# (run queries via Claude's MCP integration)
```

**SQL Query**:
```sql
SELECT
  day,
  spent_usd,
  openai_calls,
  LAG(spent_usd) OVER (ORDER BY day) as prev_day_spend,
  spent_usd - LAG(spent_usd) OVER (ORDER BY day) as daily_increase
FROM budgets
WHERE day >= CURRENT_DATE - 7
ORDER BY day DESC;
```

### Script 4: `scripts/monitoring/trigger-rss.sh`

**Purpose**: One-command RSS trigger helper

**Features**:
- Uses TEST credentials from .env
- Logs trigger timestamp
- Shows response status

**Usage**:
```bash
bash scripts/monitoring/trigger-rss.sh
```

**Content**:
```bash
#!/bin/bash
echo "Triggering RSS fetch at $(date)..."
curl -X POST "https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer d9559916-c428-4767-8cc4-de1b5e7933ec0bfb9919-5113-4e6e-8830-edca4db73035" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}' \
  --fail-with-body
echo "RSS fetch triggered successfully"
echo "$(date) - RSS fetch triggered" >> rss-trigger-log.txt
```

---

## Phase 3: Create Monitoring Documentation 📄

**Estimated Time**: 15 minutes

### Doc 1: `/docs/monitoring/TTRC-260-48h-monitoring-guide.md`

**Contents**:
1. Monitoring schedule (when to run scripts)
2. Commands to run every 6 hours
3. What to look for (red flags, success indicators)
4. Go/no-go checklist with actual values
5. RSS trigger schedule recommendation
6. Troubleshooting common issues

### Doc 2: `/docs/monitoring/TTRC-260-monitoring-log.md`

**Contents**:
1. Template for logging observations every 6 hours
2. Tables for tracking metrics over time
3. Space for notes/observations
4. Timeline of events

**Example Table**:
```markdown
| Time | Success Rate | Memory (MB) | Cost ($/day) | Notes |
|------|--------------|-------------|--------------|-------|
| 10:00 | 85% (12/14) | 156 MB | $0.05 | PBS, NYT working |
| 16:00 | 78% (18/23) | 162 MB | $0.06 | WaPo blocked (403) |
```

---

## Phase 4: JIRA & Initial Check ✅

**Estimated Time**: 10 minutes

### 1. Update JIRA TTRC-260

**Status**: "In Monitoring (48h TEST)"

**Comment to Add**:
```markdown
## 48-Hour Extended TEST Monitoring - STARTED

**Start Time**: [TIMESTAMP]
**Approach**: Option A - Manual RSS Triggers + Continuous Worker
**Monitoring Guide**: /docs/monitoring/TTRC-260-48h-monitoring-guide.md
**Expected Completion**: [TIMESTAMP + 48h]

**Monitoring Checklist**:
- [ ] Worker running with dedicated logging
- [ ] Monitoring scripts created (4 scripts)
- [ ] Initial baseline metrics collected
- [ ] RSS triggers scheduled every 2-6 hours

**Go/No-Go Criteria** (All must pass):
1. Success rate >70% across non-blocking sources
2. Memory stable <300MB for 48h
3. Zero worker crashes
4. Cost increase <$5/month
5. At least 3 sources validated (PBS ✅, need 2 more)
6. Zero HTTP 429 rate limiting errors

Will update every 12 hours with progress.
```

### 2. Run Initial Metrics Collection

**Run these commands**:
```bash
# 1. Scraper log analysis (baseline)
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log

# 2. Memory check
bash scripts/monitoring/check-memory.sh

# 3. Cost check
# (use MCP or psql)

# 4. Document in monitoring log
# (copy results to TTRC-260-monitoring-log.md)
```

### 3. Trigger Second RSS Fetch
**Wait 2 hours after start**, then trigger again to collect more data.

---

## Monitoring Schedule (Next 48 Hours)

### Every 6 Hours (8 checks total)

**Commands to Run**:
```bash
# 1. Analyze scraper logs
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log

# 2. Check memory
bash scripts/monitoring/check-memory.sh

# 3. Check costs (via MCP or SQL)
# Query budgets table

# 4. Trigger RSS (if 2+ hours since last)
bash scripts/monitoring/trigger-rss.sh

# 5. Log results
# Copy metrics to monitoring log
```

**What to Look For**:

✅ **Green Flags** (Good):
- Success rate trending >70%
- Memory stable or growing <5MB/hour
- Multiple sources working (PBS, NYT, CSM, etc.)
- Costs increasing <$0.50/day
- No 429 errors
- Worker still running

🚨 **Red Flags** (Bad):
- Success rate <70%
- Memory growing >10MB/hour
- Worker crashed
- HTTP 429 errors (rate limiting)
- Costs >$2/day increase
- Same source failing repeatedly

### Suggested Check Times

**Option 1: Business Hours** (8 AM - 10 PM):
- 8:00 AM
- 2:00 PM
- 8:00 PM
- (Repeat for 2 days)

**Option 2: Round the Clock** (every 6 hours):
- 12:00 AM / 6:00 AM / 12:00 PM / 6:00 PM
- (Automatic if using cron/Task Scheduler)

### RSS Trigger Frequency

**Recommended**: Every 2-4 hours during monitoring
- More frequent = more data points
- Less frequent = more realistic production load
- **Suggested**: Every 3 hours (16 RSS fetches over 48h)

---

## After 48 Hours: Final Analysis

### 1. Run Final Metrics Collection
```bash
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log --final
bash scripts/monitoring/check-memory.sh
# Check costs one last time
```

### 2. Calculate Overall Results

**Success Rate**:
```
Overall Success Rate = (Readability + Regex successes) / Total scrape attempts * 100
Target: >70%
```

**Memory Stability**:
```
Memory Growth = (Final Memory - Initial Memory) / 48 hours
Target: <5MB/hour (<240MB growth over 48h)
```

**Cost Impact**:
```
Daily Increase = (Current daily spend - Pre-monitoring daily spend)
Target: <$0.20/day (<$6/month increase)
```

### 3. Make Go/No-Go Decision

**Deploy to PROD if ALL true**:
- ✅ Success rate >70%
- ✅ Memory stable <300MB after 48h
- ✅ Zero worker crashes
- ✅ Cost increase <$5/month
- ✅ At least 3 sources validated
- ✅ Zero HTTP 429 errors

**Stay on TEST if ANY true**:
- ❌ Success rate <70%
- ❌ Memory leaks (>10MB/hour growth)
- ❌ Worker crashed
- ❌ Cost >$30/month projected
- ❌ HTTP 429 rate limiting

**Example Decision**:
```markdown
## TTRC-260 Go/No-Go Decision - 2025-11-12

**Monitoring Period**: 2025-11-10 10:00 - 2025-11-12 10:00 (48 hours)

**Results**:
- Success Rate: 82% (65/79 attempts) ✅
- Memory: 156MB → 178MB (stable, +22MB) ✅
- Crashes: 0 ✅
- Cost: $0.08/day increase ($2.40/month) ✅
- Sources Validated: PBS (95%), NYT (75%), CSM (88%), WaPo (60%) ✅
- HTTP 429 Errors: 0 ✅

**Decision**: ✅ APPROVED FOR PROD DEPLOYMENT

**Next Steps**:
1. Create PROD deployment PR
2. Cherry-pick commits from test
3. Deploy to main via PR merge
4. Monitor PROD for 24 hours
```

### 4. Update JIRA with Decision

**Add Final Comment**:
- Monitoring results summary
- Go/no-go decision with rationale
- Link to final metrics report
- Next steps (PROD deployment or stay on TEST)

### 5. Create Handoff (If Approved)

**If APPROVED for PROD**:
- Create `/docs/handoffs/2025-11-12-ttrc260-prod-deployment.md`
- Include monitoring results
- Include PROD deployment steps
- Include rollback plan

**If STAYING on TEST**:
- Create `/docs/handoffs/2025-11-12-ttrc260-monitoring-results.md`
- Include what needs improvement
- Include next steps for fixing issues
- Include re-test timeline

---

## Deliverables Checklist

**Phase 1: Worker Started**:
- [ ] Worker running (`worker-ttrc260.log` being written)
- [ ] Worker PID recorded
- [ ] Start timestamp logged
- [ ] First RSS fetch triggered

**Phase 2: Monitoring Scripts**:
- [ ] `scripts/monitoring/analyze-scraper-logs.js` created
- [ ] `scripts/monitoring/check-memory.sh` created
- [ ] `scripts/monitoring/check-costs.sql` created
- [ ] `scripts/monitoring/trigger-rss.sh` created

**Phase 3: Documentation**:
- [ ] `/docs/monitoring/TTRC-260-48h-monitoring-guide.md` created
- [ ] `/docs/monitoring/TTRC-260-monitoring-log.md` created

**Phase 4: JIRA & Baseline**:
- [ ] JIRA TTRC-260 updated with monitoring status
- [ ] Initial metrics collected (baseline)
- [ ] Results logged in monitoring log

**During Monitoring** (48 hours):
- [ ] Metrics collected every 6 hours (8 times)
- [ ] RSS triggered 12-16 times
- [ ] Observations logged
- [ ] Red flags addressed

**Post-Monitoring**:
- [ ] Final metrics collected
- [ ] Go/no-go decision made
- [ ] JIRA updated with results
- [ ] Handoff created (if proceeding to PROD)

---

## Troubleshooting

### Worker Stopped Running
```bash
# Check if crashed
tail -100 worker-ttrc260.log

# Restart
node scripts/job-queue-worker.js > worker-ttrc260.log 2>&1 &
```

### Memory Growing Rapidly
```bash
# Check memory every 10 minutes
watch -n 600 "ps aux | grep job-queue-worker"

# If >500MB, restart worker and investigate
pkill -f job-queue-worker
# Fix memory leak before restarting
```

### Success Rate Low (<50%)
```bash
# Check which sources failing
grep "scraped_fail" worker-ttrc260.log | grep -o "url=.*" | sort | uniq -c

# Consider removing failing sources from allow-list
```

### HTTP 429 Errors (Rate Limiting)
```bash
# Check for 429s
grep "429" worker-ttrc260.log

# Increase rate limit in scraper.js:
# PER_HOST_MIN_GAP_MS = 2000 (increase to 3000 or 5000)
```

---

## Success Criteria (Detailed)

### 1. Success Rate >70%
**How to Calculate**:
```javascript
const total = readabilitySuccess + regexSuccess + readabilityFail + regexFail;
const successes = readabilitySuccess + regexSuccess;
const successRate = (successes / total) * 100;
// Target: >70%
```

**Notes**:
- Politico blocks expected (403) - exclude from calculation
- ProPublica 404s expected (article removed) - include in calculation
- Paywalled sources (NYT, WaPo) - partial success OK

### 2. Memory Stable <300MB
**How to Measure**:
```bash
# Every 6 hours, log memory
ps aux | grep job-queue-worker | awk '{print $6/1024 " MB"}'

# If steadily increasing >10MB/hour = memory leak
# If stable or <5MB/hour = acceptable
```

### 3. Zero Worker Crashes
**How to Check**:
```bash
# Worker should stay running for full 48 hours
ps aux | grep job-queue-worker  # Should always return process

# Check logs for crashes
grep -i "crash\|error\|exception" worker-ttrc260.log
```

### 4. Cost Increase <$5/month
**How to Calculate**:
```sql
-- Get average daily spend before monitoring (last 7 days)
SELECT AVG(spent_usd) as avg_before
FROM budgets
WHERE day BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 7;

-- Get average during monitoring (current 2 days)
SELECT AVG(spent_usd) as avg_during
FROM budgets
WHERE day >= CURRENT_DATE - 2;

-- Calculate monthly increase
-- Monthly Increase = (avg_during - avg_before) * 30
-- Target: <$5/month
```

### 5. At Least 3 Sources Validated
**How to Check**:
```bash
# Count unique sources with >50% success rate
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log | grep "Source"

# Need at least 3 sources with >50% success:
# - PBS ✅ (already validated)
# - NYT (paywalled, may be partial)
# - WaPo (paywalled, may be partial)
# - CSM (public, should work well)
# - Reuters (public, should work)
# - AP (public, should work)
```

### 6. Zero HTTP 429 Errors
**How to Check**:
```bash
# Check for rate limiting
grep "429" worker-ttrc260.log | wc -l
# Should be: 0

# If >0, rate limiting is kicking in
# Need to increase PER_HOST_MIN_GAP_MS
```

---

## Cost Impact Estimates

**Before Monitoring** (baseline):
- ~$20/month (OpenAI GPT-4o-mini for enrichment)
- ~$0.67/day

**Expected During Monitoring**:
- ~$20-25/month
- ~$0.70-0.85/day
- Additional cost: 2-3 scrapes per enrichment × $0.0001/scrape = minimal

**Projected After PROD**:
- ~$22/month (10% increase)
- Still well under $50/month budget

---

## References

**JIRA**: [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)
**Implementation Plan**: `/docs/plans/2025-11-09-ttrc-260-implementation.md`
**Deployment Guide**: `/docs/deployments/DEPLOYMENT-TTRC-260-mozilla-readability.md`
**PM Concerns**: `/docs/product/TTRC-260-PM-CONCERNS.md`
**Handoff (TEST Complete)**: `/docs/handoffs/2025-11-09-ttrc260-mozilla-readability-test-complete.md`

---

**Last Updated**: 2025-11-10
**Status**: Ready to Start
**Next Review**: After 48h monitoring complete

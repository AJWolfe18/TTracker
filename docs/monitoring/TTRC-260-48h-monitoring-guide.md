# TTRC-260: 48-Hour Monitoring Guide

**Feature**: Mozilla Readability Scraper
**Monitoring Start**: 2025-11-11 02:20 UTC
**Expected End**: 2025-11-13 02:20 UTC
**Environment**: TEST

---

## Quick Reference

### Every 6 Hours - Run These Commands

```bash
# 1. Analyze scraper logs
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log

# 2. Check worker memory
bash scripts/monitoring/check-memory.sh

# 3. Check costs (simplified - via MCP)
# See "Cost Monitoring" section below

# 4. Trigger RSS (if 2+ hours since last)
bash scripts/monitoring/trigger-rss.sh

# 5. Log results
# Update docs/monitoring/TTRC-260-monitoring-log.md
```

---

## Monitoring Schedule

### Recommended Check Times (Every 6 Hours)

**Option 1: Business Hours**
- 8:00 AM
- 2:00 PM
- 8:00 PM
- (Repeat for 2 days = 6 checks)

**Option 2: Round the Clock**
- 12:00 AM / 6:00 AM / 12:00 PM / 6:00 PM
- (8 checks over 48 hours)

### RSS Trigger Frequency

**Recommended**: Every 2-4 hours
- More data points = better validation
- Target: 12-16 RSS fetches over 48 hours

---

## Detailed Monitoring Instructions

### 1. Analyze Scraper Logs

**Command**:
```bash
node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log
```

**What It Shows**:
- Overall success rate (Readability + Regex vs. Total)
- Success rates by source (PBS, NYT, WaPo, CSM, etc.)
- Success rates by method (Readability, Regex, RSS fallback)
- Error patterns and failure reasons
- Recent events timeline

**What to Look For**:

✅ **Green Flags** (Good):
- Success rate >70%
- PBS, CSM showing high success (>80%)
- NYT, WaPo showing partial success (>50%)
- Errors are 403/404 (expected blocking/missing articles)

🚨 **Red Flags** (Bad):
- Success rate <70%
- Multiple sources failing consistently
- HTTP 429 errors (rate limiting)
- Timeout errors
- Memory-related errors

**Action on Red Flags**:
- If success <70%: Identify failing sources, consider removing from allow-list
- If 429 errors: Increase PER_HOST_MIN_GAP_MS in scraper.js
- If timeouts: Investigate slow sources, may need longer timeout

---

### 2. Check Worker Memory

**Command**:
```bash
bash scripts/monitoring/check-memory.sh
```

**What It Shows**:
- Current worker PID
- Current memory usage (MB)
- Recent trend (last 5 measurements)
- Alert if >300MB

**What to Look For**:

✅ **Green Flags** (Good):
- Memory stable (100-250MB)
- Growth <5MB per 6-hour period
- No sudden spikes

🚨 **Red Flags** (Bad):
- Memory >300MB
- Growth >10MB/hour
- Steadily increasing trend
- Memory spikes correlating with enrichment jobs

**Action on Red Flags**:
- If >300MB: Check for memory leaks, review recent code changes
- If growing rapidly: Restart worker, investigate leak source
- If >500MB: STOP monitoring, investigate critical memory issue

---

### 3. Check Costs

**Option A: Via Claude MCP Integration** (Easiest):

Ask Claude to run:
```sql
SELECT day, spent_usd, openai_calls
FROM budgets
WHERE day >= CURRENT_DATE - 7
ORDER BY day DESC;
```

**Option B: Via psql** (If configured):
```bash
psql -h wnrjrywpcadwutfykflu.supabase.co -U postgres -d postgres \
  -f scripts/monitoring/check-costs.sql
```

**What to Look For**:

✅ **Green Flags** (Good):
- Daily spend increase <$0.20/day ($6/month projected)
- OpenAI calls proportional to story count
- Spend consistent day-to-day

🚨 **Red Flags** (Bad):
- Daily spend increase >$0.50/day ($15/month projected)
- Sudden spikes in OpenAI calls
- Daily spend >$2

**Action on Red Flags**:
- If >$0.50/day increase: Review enrichment logic, check for loops
- If >$2/day total: STOP enrichment, investigate runaway costs
- If >$40/month projected: Stay on TEST, do not deploy to PROD

---

### 4. Trigger RSS Fetch

**Command**:
```bash
bash scripts/monitoring/trigger-rss.sh
```

**When to Trigger**:
- Every 2-4 hours during monitoring
- After checking logs/memory/costs
- Ensures continuous data collection

**What It Shows**:
- Number of feeds enqueued
- Success/failure status
- Timestamp logged to rss-trigger-log.txt

**Expected Output**:
```
✅ RSS fetch triggered successfully

📊 Response:
{
  "enqueued": 5,
  "failed": 0,
  "feeds_processed": 5,
  "successful_feeds": ["CSM", "NYT", "PBS", "Politico", "WaPo"]
}
```

**Action on Failures**:
- Check SUPABASE_URL and ANON_KEY in script
- Verify edge function deployed
- Check Supabase dashboard for errors

---

### 5. Log Results

**Document in**: `docs/monitoring/TTRC-260-monitoring-log.md`

**Template Entry**:
```markdown
#### Check #3 - 2025-11-11 14:00

**Success Rate**: 82% (18/22 attempts)
**Memory**: 168 MB (stable, +6MB from last check)
**Cost**: $0.08/day increase ($2.40/month projected)
**RSS Triggered**: Yes (5 feeds enqueued)

**By Source**:
- PBS: 5/5 (100%)
- CSM: 3/3 (100%)
- NYT: 4/6 (67% - paywalls)
- WaPo: 2/4 (50% - paywalls)
- Politico: 0/2 (0% - blocks automation)

**Notes**:
- Politico blocking expected (403)
- NYT/WaPo partial success acceptable
- Memory growth normal for enrichment
- On track for PROD deployment ✅
```

---

## Go/No-Go Criteria

### Must Pass ALL to Deploy to PROD

1. **✅ Success Rate >70%**
   - Calculate: (Readability + Regex successes) / Total attempts × 100
   - Target: >70%
   - Measured by: `analyze-scraper-logs.js`

2. **✅ Memory Stable <300MB**
   - Worker memory after 48 hours
   - Growth <5MB/hour acceptable
   - Measured by: `check-memory.sh`

3. **✅ Zero Worker Crashes**
   - Worker running continuously for 48 hours
   - Check: `ps aux | grep job-queue-worker`

4. **✅ Cost Increase <$5/month**
   - Daily increase <$0.17/day
   - Monthly projection <$5/month
   - Measured by: `check-costs.sql` or MCP query

5. **✅ At Least 3 Sources Validated**
   - Sources with >50% success rate
   - PBS ✅ (already validated)
   - Need 2 more (CSM, NYT, WaPo, Reuters, AP)
   - Measured by: `analyze-scraper-logs.js`

6. **✅ Zero HTTP 429 Errors**
   - No rate limiting detected
   - Check logs for "429" or "rate limit"
   - Measured by: `analyze-scraper-logs.js`

---

## Decision Matrix

### ✅ DEPLOY TO PROD

**If ALL criteria met**:
- Success rate >70%
- Memory stable <300MB
- Zero crashes
- Cost <$5/month increase
- 3+ sources validated
- Zero 429 errors

**Next Steps**:
1. Update JIRA with final metrics
2. Create PROD deployment handoff
3. Create PR to main (cherry-pick commits)
4. Deploy via PR merge
5. Monitor PROD for 24 hours

---

### ⚠️ STAY ON TEST

**If ANY criteria failed**:
- Success rate <70%
- Memory leaks (>5MB/hour growth)
- Worker crashed
- Cost >$30/month projected
- <3 sources validated
- HTTP 429 errors detected

**Next Steps**:
1. Identify root cause of failures
2. Update JIRA with blockers
3. Fix issues on TEST
4. Re-run 48-hour monitoring
5. Reassess go/no-go

---

### 🚨 ROLLBACK (If Already in PROD)

**Triggers**:
- Success rate drops to <50%
- Memory >500MB
- Worker crashes repeatedly
- Cost >$40/month
- HTTP 429 rate limiting

**Rollback Procedure**:
```bash
# Option 1: Revert commits
git revert [commit-hashes]
git push origin main

# Option 2: Emergency disable scraping
# In Supabase env vars:
SCRAPE_DOMAINS=""
# Forces RSS-only mode
```

---

## Troubleshooting

### Worker Stopped Running

**Symptoms**: No new log entries, worker process not found

**Fix**:
```bash
# Check if crashed
tail -100 worker-ttrc260.log

# Restart
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker
node scripts/job-queue-worker.js > worker-ttrc260.log 2>&1 &
```

---

### Memory Growing Rapidly

**Symptoms**: Memory increasing >10MB/hour

**Fix**:
```bash
# Monitor closely
watch -n 600 "ps aux | grep job-queue-worker"

# If >500MB, restart and investigate
pkill -f job-queue-worker

# Check for memory leak in:
# - scripts/enrichment/scraper.js (dom.window.close() in finally)
# - scripts/job-queue-worker.js (cleanup after jobs)
```

---

### Success Rate Low (<50%)

**Symptoms**: Most scrapes failing

**Fix**:
```bash
# Identify failing sources
grep "scraped_fail" worker-ttrc260.log | grep -o "url=.*" | sort | uniq -c

# Consider:
# 1. Removing failing sources from allow-list
# 2. Increasing timeout (FETCH_TIMEOUT_MS)
# 3. Investigating blocking (403/429 errors)
```

---

### HTTP 429 Errors (Rate Limiting)

**Symptoms**: "429" in logs, scrapes failing with rate limit errors

**Fix**:
1. Increase rate limit in `scripts/enrichment/scraper.js`:
   ```javascript
   const PER_HOST_MIN_GAP_MS = 2000; // Increase to 3000 or 5000
   ```
2. Restart worker
3. Monitor for continued 429s
4. If persistent, remove that source from allow-list

---

### No Jobs Being Processed

**Symptoms**: Worker polling but not claiming jobs

**Fix**:
```bash
# Check if jobs exist
# Via Claude MCP:
SELECT COUNT(*) FROM job_queue WHERE status = 'pending';

# If 0, trigger RSS
bash scripts/monitoring/trigger-rss.sh

# If jobs exist but not claimed, check worker logs for errors
tail -50 worker-ttrc260.log
```

---

## End of Monitoring (After 48 Hours)

### Final Analysis Steps

1. **Run Final Metrics Collection**:
   ```bash
   node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log > final-report.txt
   bash scripts/monitoring/check-memory.sh >> final-report.txt
   # Run cost query via MCP
   ```

2. **Calculate Overall Results**:
   - Total success rate
   - Average memory
   - Total cost increase
   - Sources validated
   - Crashes detected

3. **Make Go/No-Go Decision**:
   - Review all 6 criteria
   - Document pass/fail for each
   - Make recommendation (PROD or stay on TEST)

4. **Reset Feed Failure Counts** (Test Backoff Feeds):

   **Why**: 3 sources are in automatic backoff (ProPublica, Reuters, AP News) due to `failure_count ≥ 5`. These weren't tested during monitoring.

   **Action**: Reset failure counts and re-test:
   ```sql
   -- Reset failure counts for backoff feeds
   UPDATE feed_registry
   SET failure_count = 0
   WHERE source_name IN ('ProPublica', 'Reuters Politics', 'AP News US');
   ```

   **Then**:
   - Trigger RSS fetch manually
   - Wait for worker to process
   - Check if these feeds work now
   - If they work: Great, 8 sources total!
   - If they fail again: Investigate feed URLs (may be broken)

   **Note**: This is optional but recommended to validate all 8 sources before PROD.

5. **Update JIRA**:
   - Post final metrics
   - Add go/no-go decision
   - Link to final report
   - Document backoff feed results (if tested)
   - Assign next steps

6. **Create Handoff**:
   - If PROD approved: `/docs/handoffs/2025-11-13-ttrc260-prod-deployment.md`
   - If staying on TEST: `/docs/handoffs/2025-11-13-ttrc260-monitoring-results.md`

---

## Reference Files

**Monitoring Scripts**:
- `scripts/monitoring/analyze-scraper-logs.js` - Log analysis
- `scripts/monitoring/check-memory.sh` - Memory tracking
- `scripts/monitoring/check-costs.sql` - Cost tracking
- `scripts/monitoring/trigger-rss.sh` - RSS trigger helper

**Documentation**:
- `/docs/plans/2025-11-10-ttrc-260-48h-monitoring-plan.md` - Monitoring plan
- `/docs/monitoring/TTRC-260-monitoring-log.md` - Monitoring log (this session)
- `/docs/product/TTRC-260-PM-CONCERNS.md` - PM concerns and criteria

**Worker Logs**:
- `worker-ttrc260.log` - Main worker log (live)
- `monitoring-ttrc260.log` - Monitoring events log
- `rss-trigger-log.txt` - RSS trigger timestamps
- `memory-ttrc260.csv` - Memory tracking data

---

**Last Updated**: 2025-11-11
**Contact**: Josh (PM) + Claude Code
**JIRA**: [TTRC-260](https://ajwolfe37.atlassian.net/browse/TTRC-260)
